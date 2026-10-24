'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { unpack, streamMap, envelope, check } = require('./replayImport');
const formal = require('./replaySchema');
const { createGlobalWriter, globalMapValidation } = require('./replayGlobal');
const { createWriteStream } = require('node:fs');
const { once } = require('node:events');
const { finished } = require('node:stream/promises');
async function importPackage(dir) {
    const global = createGlobalWriter(dir);
    let mapFile, projection, projectionError;
    try {
        const data = await unpack(path.join(dir, 'package.zip'), dir, event => global.append('events', event, event.round_num ? [event.round_num] : []));
        const m = data['manifest.json'], events = data['events.json'].items;
        const roundList = data['rounds.json'].items, ids = new Set(events.map(e => e.event_id));
        const rounds = new Set(roundList.map(r => r.round_num)), validateGlobal = globalMapValidation(m, roundList);
        mapFile = await fs.open(path.join(dir, 'compat-trajectories.json'), 'w'); let first = true;
        // A v1.1 projection keeps existing detailed clients independent of global fields.
        projection = createWriteStream(path.join(dir, 'target-map.json'));
        projection.on('error', error => { projectionError = error; });
        async function project(bytes) { if (projectionError) throw projectionError; if (!projection.write(bytes)) await once(projection, 'drain'); }
        let currentKind = null; const projected = new Set();
        await project('{');
        await mapFile.writeFile('[');
        const meta = await streamMap(path.join(dir, 'map.json'), async (kind, item) => {
            if (kind === 'player_samples' || kind === 'target_keyframes') check(item.state.steamid === m.target_player_id, 'Map target mismatch');
            check(item.round_num == null || item.round_num === 0 || rounds.has(item.round_num), 'Unknown map round');
            validateGlobal.item(kind, item);
            if (kind === 'all_player_samples') { await global.append('samples', item, item.round_num ? [item.round_num] : []); return; }
            if (kind === 'all_trajectories') {
                const touched = roundList.filter(r => r.start_tick !== null && item.end_tick >= r.start_tick && item.start_tick <= r.end_tick).map(r => r.round_num);
                await global.append('trajectories', item, touched); return;
            }
            if (currentKind !== kind) {
                await project((currentKind ? '],' : '') + JSON.stringify(kind) + ':['); currentKind = kind; projected.add(kind);
            } else await project(',');
            await project(JSON.stringify(item));
            if (kind === 'trajectories' || kind === 'unattributed_trajectories') {
                check(ids.has(item.event_id), 'Missing trajectory evidence');
                if (item.point_ticks) check(item.point_ticks.length === item.points.length, 'Trajectory tick count mismatch');
            }
            if (kind === 'trajectories') {
                check(item.thrower_player_id == null || item.thrower_player_id === m.target_player_id, 'Trajectory owner mismatch');
                await mapFile.writeFile((first ? '' : ',') + JSON.stringify({ event_id: item.event_id, type: item.type, points: item.points })); first = false;
            }
        }, m.schema_version);
        envelope(meta, m); validateGlobal.finish(meta); await mapFile.writeFile(']');
        const { global_sampling, ...targetMeta } = meta;
        targetMeta.schema_version = '1.1.0';
        for (const kind of Object.keys(formal.forVersion('1.1.0').arrays.map)) if (!projected.has(kind)) targetMeta[kind] = [];
        await project((currentKind ? '],' : '') + JSON.stringify(targetMeta).slice(1));
        const done = finished(projection); projection.end(); await done;
        await global.finish();
        if (m.schema_version === '1.2.0') await fs.writeFile(path.join(dir, 'global-summary.json'), JSON.stringify({
            schema_version: m.schema_version, match_id: m.match_id, package_id: m.package_id,
            target_player_id: m.target_player_id, match: m.match, players: m.players, export_scope: m.export_scope,
            global_sampling, global_coverage: data['events.json'].global_coverage,
            all_player_stats: data['metrics.json'].all_player_stats, rounds: roundList,
            counts: Object.fromEntries(Object.entries(global.counts).map(([kind, values]) => [kind, values.all])),
        }));
        const legacyEvents = events.map(({ event_id, type, round_num, tick, data }) => ({ event_id, type, round_num, tick, data }));
        await fs.writeFile(path.join(dir, 'compat-events.json'), JSON.stringify(legacyEvents));
        await fs.writeFile(path.join(dir, 'detailed-events.json'), JSON.stringify(events));
        const signature = crypto.createHash('sha256').update(JSON.stringify(m)).digest('hex');
        await fs.writeFile(path.join(dir, 'validated.json'), JSON.stringify({ manifest: m, signature }));
    } finally { await mapFile?.close(); projection?.destroy(); global.abort(); }
}
async function saveCloudReport(dir, raw, task) {
    const m = task.manifest;
    const status = Object.values(raw.statistics.modules).every(v => v.status === 'completed') ? 'completed' : 'partial';
    const player_team_id = m.players.find(p => p.player_id === m.target_player_id)?.team_id ?? null;
    const report = { report_schema_version: '1.0.0', match_id: m.match_id, package_id: m.package_id,
        analysis_id: task.analysis_id, target_player_id: m.target_player_id, status, match: m.match,
        perspective: { player_team_id }, is_fixture: m.is_fixture ?? false, uploaded_at: task.uploaded_at,
        analyzed_at: new Date().toISOString(), versions: { evaluation: raw.analysis_version, prompt: 'not_configured' },
        report: { modules: raw.statistics.modules, scores: {},
            findings: raw.findings.map(f => ({ finding_id: f.finding_id, module: f.rule_id.includes('flash') ? 'utility' : 'death_context',
                description: `第 ${f.round_num ?? '未知'} 回合：${f.observation}。${f.review_prompt}`, evidence_ids: f.evidence_ids, package_id: m.package_id })),
            training_suggestions: [], ai_status: 'not_configured', warnings: [...(m.data_quality.warnings || []), ...raw.limitations,
                m.schema_version === '1.2.0'
                    ? '单人分析未合并全场事件；全员数据请使用包的 global 分页接口，未知或冲突归属轨迹不能算作目标玩家投掷。'
                    : '兼容证据接口仅提供已归属轨迹；详细状态与未知轨迹可从 evidence?version=1.1 获取。'] } };
    formal.enforce(formal.report, report, 'report');
    await fs.writeFile(path.join(dir, 'cloud-report.json'), JSON.stringify(report));
    await fs.writeFile(path.join(dir, 'report-meta.json'), JSON.stringify({ status,
        summary: { adr: raw.statistics.modules.basic_stats?.metrics?.adr ?? null, rating: null, player_team_id, status } }));
}
module.exports = { importPackage, saveCloudReport };
