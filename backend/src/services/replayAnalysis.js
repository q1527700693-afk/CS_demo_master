'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { unpack, streamMap, check, envelope } = require('./replayImport');
const { globalMapValidation } = require('./replayGlobal');
const VERSION = 'rules-1.1.0';
async function analyze(directory, progress = () => {}) {
    const started = performance.now(); progress('validating');
    const data = await unpack(path.join(directory, 'package.zip'), directory);
    const manifest = data['manifest.json'], metrics = data['metrics.json'];
    const rounds = data['rounds.json'].items, events = data['events.json'].items;
    const roundNumbers = new Set(), eventIds = new Set();
    for (const r of rounds) {
        check(Number.isSafeInteger(r.round_num) && r.round_num >= 0 && !roundNumbers.has(r.round_num), 'Invalid or duplicate round');
        check((r.start_tick === null || Number.isSafeInteger(r.start_tick)) && Number.isSafeInteger(r.end_tick) && (r.start_tick === null || r.end_tick >= r.start_tick), 'Invalid round ticks');
        roundNumbers.add(r.round_num);
    }
    for (const e of events) {
        check(typeof e.event_id === 'string' && e.event_id.length <= 128 && !eventIds.has(e.event_id), 'Invalid or duplicate event ID');
        check(typeof e.type === 'string' && Number.isSafeInteger(e.tick) && e.data && typeof e.data === 'object', 'Invalid event');
        check(e.round_num == null || roundNumbers.has(e.round_num), 'Event references unknown round'); eventIds.add(e.event_id);
    }
    progress('analyzing'); const findings = [];
    function finding(rule, e, observation, review_prompt) {
        if (findings.length < 1000) findings.push({ finding_id: `${rule}:${e.event_id}`, rule_id: rule, rule_version: VERSION,
            round_num: e.round_num, tick: e.tick, live_elapsed_seconds: e.live_elapsed_seconds ?? null,
            evidence_ids: [e.event_id], observation, review_prompt, classification: 'review_candidate' });
    }
    for (const e of events) {
        if (e.type === 'death_context') {
            if (e.data.is_reloading === true) finding('death_reloading', e, '死亡时处于换弹状态', '回看换弹前的剩余弹药、掩体和交火时机。');
            if (/^(hegrenade|flashbang|smokegrenade|molotov|incgrenade|decoy)$/.test(e.data.active_weapon)) finding('death_holding_utility', e, '死亡时手持道具', '回看投掷时的掩护与切枪时机。');
            if (['flashbangs','smoke_grenades','he_grenades','fire_grenades'].some(k => e.data[k] > 0)) finding('death_unused_utility', e, '死亡时仍携带道具', '结合局势检查使用机会，携带道具死亡本身不代表失误。');
        }
        if (e.type === 'blind') {
            const r = e.data.record;
            if (r?.attacker_steamid !== manifest.target_player_id || !(r.duration > 0)) continue;
            if (r.victim_steamid === manifest.target_player_id) finding('self_flash', e, `自身受闪 ${r.duration.toFixed(2)} 秒`, '回看投掷角度与躲闪时机。');
            else if (r.attacker_side && r.attacker_side === r.victim_side) finding('team_flash', e, `队友受闪 ${r.duration.toFixed(2)} 秒`, '回看投掷前的沟通与队友位置。');
        }
    }
    const byRound = new Map(rounds.map(r => [r.round_num, { ...r, events: [], finding_ids: [] }]));
    for (const e of events) byRound.get(e.round_num)?.events.push(e);
    for (const f of findings) byRound.get(f.round_num)?.finding_ids.push(f.finding_id);
    const keyRounds = [];
    for (const r of byRound.values()) {
        r.events.sort((a, b) => a.tick - b.tick);
        const kills = r.events.filter(e => e.type === 'kill' && e.data.record?.attacker_side && e.data.record?.victim_side &&
            e.data.record.attacker_side !== e.data.record.victim_side && (e.live_elapsed_seconds == null || e.live_elapsed_seconds >= 0));
        const rec = kills[0]?.data.record, reasons = [];
        if (rec?.attacker_steamid === manifest.target_player_id) reasons.push('opening_kill');
        if (rec?.victim_steamid === manifest.target_player_id) reasons.push('opening_death');
        if (kills.filter(e => e.data.record?.attacker_steamid === manifest.target_player_id).length >= 2) reasons.push('multikill');
        if (r.finding_ids.length) reasons.push('review_candidates');
        if (reasons.length) keyRounds.push({ round_num: r.round_num, reasons, evidence_ids: kills.filter(e => e.data.record?.attacker_steamid === manifest.target_player_id || e.data.record?.victim_steamid === manifest.target_player_id).map(e => e.event_id) });
        await fs.promises.writeFile(path.join(directory, `round-${r.round_num}.json`), JSON.stringify(r));
    }
    const counts = {}, outputs = new Map(), failures = [];
    const fireTicks = new Set(events.filter(e => e.type === 'weapon_fire' && !/knife|grenade|flashbang|molotov|decoy|c4|bayonet/.test(e.data.record?.weapon || '')).map(e => e.tick));
    const measured = new Set(); let speedTotal = 0, speedMax = 0, jumping = 0;
    const allowed = new Set(['player_samples','target_keyframes','combat_participant_states','nearby_context','trajectories','unattributed_trajectories','all_player_samples','all_trajectories']);
    const validateGlobal = globalMapValidation(manifest, rounds);
    let mapMeta;
    try {
        mapMeta = await streamMap(path.join(directory, 'map.json'), async (kind, item) => {
            check(allowed.has(kind) && item && typeof item === 'object' && !Array.isArray(item), 'Invalid map record');
            counts[kind] = (counts[kind] || 0) + 1;
            validateGlobal.item(kind, item);
            // Global data belongs to the package. Do not duplicate it or feed it into target rules.
            if (kind === 'all_player_samples' || kind === 'all_trajectories') return;
            if (['player_samples', 'target_keyframes'].includes(kind)) check(item.state?.steamid === manifest.target_player_id, 'Map target mismatch');
            const round = item.round_num === 0 ? null : item.round_num ?? rounds.find(r => r.start_tick !== null && item.start_tick >= r.start_tick && item.start_tick <= r.end_tick)?.round_num;
            check(round == null || roundNumbers.has(round), 'Unknown map round');
            if (kind === 'target_keyframes' && fireTicks.has(item.tick) && !measured.has(item.tick)) {
                const s = item.state;
                if (Number.isFinite(s.velocity_x) && Number.isFinite(s.velocity_y)) {
                    const speed = Math.hypot(s.velocity_x, s.velocity_y);
                    measured.add(item.tick); speedTotal += speed; speedMax = Math.max(speedMax, speed);
                    if (s.is_jumping === true) jumping++;
                }
            }
            const name = round == null ? 'context' : String(round);
            if (!outputs.has(name)) {
                const out = fs.createWriteStream(path.join(directory, `map-${name}.jsonl`));
                out.on('error', e => failures.push(e)); outputs.set(name, out);
            }
            if (failures.length) throw failures[0];
            if (!outputs.get(name).write(JSON.stringify({ kind, ...item }) + '\n')) await once(outputs.get(name), 'drain');
        }, manifest.schema_version);
        envelope(mapMeta, manifest);
        validateGlobal.finish(mapMeta);
        await Promise.all([...outputs.values()].map(out => new Promise((resolve, reject) => { out.once('error', reject); out.end(resolve); })));
        if (failures.length) throw failures[0];
    } finally { for (const out of outputs.values()) out.destroy(); }
    for (const mod of Object.values(metrics.modules)) check(!mod.evidence_ids || (Array.isArray(mod.evidence_ids) && mod.evidence_ids.every(id => eventIds.has(id))), 'Missing module evidence');
    const report = { schema_version: 'report-1.0.0', analysis_version: VERSION, ai_status: 'not_requested',
        source: { match_id: manifest.match_id, package_id: manifest.package_id, producer: manifest.producer, identity_verified: false },
        target_player_id: manifest.target_player_id, match: manifest.match, analysis_scope: manifest.analysis_scope,
        ...(manifest.export_scope ? { export_scope: manifest.export_scope } : {}),
        data_quality: manifest.data_quality, statistics: metrics, findings, key_rounds: keyRounds,
        rounds: rounds.map(r => ({ round_num: r.round_num, winner_side: r.winner_side, target_summary: r.target_summary })),
        map: { ...mapMeta, counts }, movement: { status: measured.size ? 'observed' : 'insufficient_data', measured_fire_ticks: measured.size,
            eligible_fire_ticks: fireTicks.size, mean_horizontal_speed: measured.size ? speedTotal / measured.size : null,
            max_horizontal_speed: measured.size ? speedMax : null, jumping_fire_ticks: jumping,
            interpretation: '仅描述开火状态；同 tick 多次开火计一个观察点，不作为急停评分。' },
        limitations: ['反应时间、可见性、预瞄质量及道具正确率尚未评估。', '未知归属轨迹只作上下文。', '规则命中表示值得回看，不代表失误或因果关系。', '数据来自用户提交包，摘要校验不证明真实性或账号所有权。'],
        performance: { elapsed_ms: Math.round(performance.now() - started), peak_rss_kib: process.resourceUsage().maxRSS } };
    const evidenceIndex = Object.create(null); let offset = 0;
    const evidenceFile = await fs.promises.open(path.join(directory, 'evidence.bin'), 'w');
    try { for (const event of events) {
        const bytes = Buffer.from(JSON.stringify(event));
        evidenceIndex[event.event_id] = { offset, length: bytes.length };
        await evidenceFile.writeFile(bytes); offset += bytes.length;
    } } finally { await evidenceFile.close(); }
    await fs.promises.writeFile(path.join(directory, 'evidence-index.json'), JSON.stringify(evidenceIndex));
    for (const name of ['manifest.json','metrics.json','rounds.json','events.json','map.json']) await fs.promises.unlink(path.join(directory, name));
    report.performance = { elapsed_ms: Math.round(performance.now() - started), peak_rss_kib: process.resourceUsage().maxRSS };
    await fs.promises.writeFile(path.join(directory, 'report.json'), JSON.stringify(report));
    return report;
}
module.exports = { analyze, VERSION };
