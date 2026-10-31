'use strict';
const MIN_BLIND_SECONDS = 0.5;
function relation(r = {}) {
    if (r.attacker_steamid && r.attacker_steamid === r.victim_steamid) return 'self';
    const sides = ['terrorist', 'counter-terrorist'];
    if (!sides.includes(r.attacker_side) || !sides.includes(r.victim_side)) return 'unknown';
    return r.attacker_side === r.victim_side ? 'team' : 'enemy';
}
function applyCombatFacts(metrics, rounds, events, target) {
    const kills = events.filter(e => e.type === 'kill');
    const hostile = kills.filter(e => relation(e.data.record) === 'enemy' && (e.live_elapsed_seconds == null || e.live_elapsed_seconds >= 0));
    const own = hostile.filter(e => e.data.record.attacker_steamid === target);
    const team = kills.filter(e => relation(e.data.record) === 'team' && e.data.record.attacker_steamid === target);
    if (kills.length) {
        const basic = metrics.modules.basic_stats?.metrics;
        if (basic) { basic.kills = own.length; basic.team_kills = team.length; basic.headshot_pct = own.every(e => typeof e.data.record.headshot === 'boolean') ? (own.length ? own.filter(e => e.data.record.headshot === true).length / own.length * 100 : 0) : null; }
        for (const row of metrics.tables?.per_round || []) {
            row.kills = own.filter(e => e.round_num === row.round_num).length;
            row.team_kills = team.filter(e => e.round_num === row.round_num).length;
            row.assists = hostile.filter(e => e.round_num === row.round_num && e.data.record.assister_steamid === target && e.data.record.attacker_steamid !== target).length;
        }
        for (const r of rounds) if (r.target_summary) {
            r.target_summary.kills = own.filter(e => e.round_num === r.round_num).length;
            r.target_summary.team_kills = team.filter(e => e.round_num === r.round_num).length;
        }
        for (const row of metrics.tables?.by_weapon || []) row.kills = own.filter(e => String(e.data.record.weapon).replace(/^weapon_/, '') === row.weapon).length;
    }
    const utility = metrics.modules.utility?.metrics;
    if (utility) {
        const blinds = events.filter(e => e.type === 'blind' && e.data.record?.attacker_steamid === target);
        if (blinds.length) {
            for (const key of ['enemies_blinded', 'teammates_blinded', 'self_blinds', 'unclassified_blinds', 'enemy_blind_seconds']) utility[key] = 0;
            const ticks = new Set();
            for (const e of blinds) {
                const r = e.data.record;
                if (!Number.isFinite(r.duration) || r.duration < MIN_BLIND_SECONDS) continue;
                const rel = relation(r), key = { enemy: 'enemies_blinded', team: 'teammates_blinded', self: 'self_blinds', unknown: 'unclassified_blinds' }[rel];
                utility[key]++;
                if (rel === 'enemy') utility.enemy_blind_seconds += r.duration;
                if (rel === 'team') ticks.add(e.tick);
            }
            utility.team_blinding_events = ticks.size;
        }
        utility.he_damage = 0; utility.fire_damage = 0; utility.utility_team_damage = 0;
        for (const e of events) {
            const r = e.data.record;
            if (e.type !== 'damage' || r?.attacker_steamid !== target) continue;
            const weapon = String(r.weapon).replace(/^weapon_/, '');
            const key = ['hegrenade', 'he'].includes(weapon) ? 'he_damage' : ['inferno', 'molotov', 'incgrenade', 'fire', 'incendiary'].includes(weapon) ? 'fire_damage' : null;
            const damage = r.dmg_health_real ?? r.dmg_health;
            if (!key || !Number.isFinite(damage) || damage < 0) continue;
            if (relation(r) === 'enemy') utility[key] += damage;
            if (relation(r) === 'team') utility.utility_team_damage += damage;
        }
        utility.min_effective_blind_seconds = MIN_BLIND_SECONDS;
    }
    metrics.definitions = { ...metrics.definitions, combat_policy: 'web-v1.1.0: hostile kills only; TK separate; effective blinds >= 0.5s; HE/fire enemy damage separated from team damage' };
}
module.exports = { applyCombatFacts, relation, MIN_BLIND_SECONDS };
