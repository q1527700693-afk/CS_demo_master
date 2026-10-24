'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { unpack, streamMap, envelope, check } = require('./replayImport');
const formal = require('./replaySchema');
async function importPackage(dir) {
    const data = await unpack(path.join(dir, 'package.zip'), dir), m = data['manifest.json'];
    const events = data['events.json'].items;
    const ids = new Set(events.map(e => e.event_id));
    const rounds = new Set(data['rounds.json'].items.map(r => r.round_num));
    const mapFile = await fs.open(path.join(dir, 'compat-trajectories.json'), 'w'); let first = true;
    let meta;
    try {
        await mapFile.writeFile('[');
        meta = await streamMap(path.join(dir, 'map.json'), async (kind, item) => {
            if (kind === 'player_samples' || kind === 'target_keyframes') check(item.state.steamid === m.target_player_id, 'Map target mismatch');
            check(item.round_num == null || item.round_num === 0 || rounds.has(item.round_num), 'Unknown map round');
            if (kind.includes('trajectories')) {
                check(ids.has(item.event_id), 'Missing trajectory evidence');
                if (item.point_ticks) check(item.point_ticks.length === item.points.length, 'Trajectory tick count mismatch');
            }
            if (kind === 'trajectories') {
                check(item.thrower_player_id == null || item.thrower_player_id === m.target_player_id, 'Trajectory owner mismatch');
                await mapFile.writeFile((first ? '' : ',') + JSON.stringify({ event_id: item.event_id, type: item.type, points: item.points })); first = false;
            }
        });
        envelope(meta, m); await mapFile.writeFile(']');
    } finally { await mapFile.close(); }
    const legacyEvents = events.map(({ event_id, type, round_num, tick, data }) => ({ event_id, type, round_num, tick, data }));
    await fs.writeFile(path.join(dir, 'compat-events.json'), JSON.stringify(legacyEvents));
    await fs.writeFile(path.join(dir, 'detailed-events.json'), JSON.stringify(events));
    const signature = crypto.createHash('sha256').update(JSON.stringify(m)).digest('hex');
    await fs.writeFile(path.join(dir, 'validated.json'), JSON.stringify({ manifest: m, signature }));
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
                '兼容证据接口仅提供已归属轨迹；详细状态与未知轨迹可从 evidence?version=1.1 获取。'] } };
    formal.enforce(formal.report, report, 'report');
    await fs.writeFile(path.join(dir, 'cloud-report.json'), JSON.stringify(report));
    await fs.writeFile(path.join(dir, 'report-meta.json'), JSON.stringify({ status,
        summary: { adr: raw.statistics.modules.basic_stats?.metrics?.adr ?? null, rating: null, player_team_id, status } }));
}
module.exports = { importPackage, saveCloudReport };
