'use strict';

/**
 * Deterministic Dust2 round classifier.
 *
 * This is intentionally a fact extractor, not an LLM. It answers:
 *   - what did this team do this round?
 *   - which known utility was observed?
 *   - did the round satisfy a tactic template's required zones/steps?
 *
 * It does not yet claim that a tactic was optimal or assign blame. Those
 * judgments need economy, opponent tendencies and a validated demo corpus.
 */
const knowledge = require('./dust2Knowledge');

const SUPPORTED_MAP = 'de_dust2';
const EARLY_SECONDS = 12;
const MID_SECONDS = 22;

const A_LONG_APPROACH = new Set(['a_long', 'long_doors', 'a_long_pit']);
const A_SHORT_APPROACH = new Set(['a_short', 'a_short_stairs']);
const B_TUNNEL_APPROACH = new Set(['lower_tunnels', 'b_tunnel', 'upper_tunnels']);
const MID_APPROACH = new Set(['mid', 'mid_doors', 'xbox', 'catwalk']);
const A_SITE_ZONES = new Set(['a_site']);
const B_SITE_ZONES = new Set(['b_site']);

function normalizeSide(value) {
    const side = String(value || '').toLowerCase();
    if (side === 't' || side === 'terrorist' || side === 'terrorists') return 'T';
    if (side === 'ct' || side === 'counter-terrorist' || side === 'counterterrorist' || side === 'counter_terrorist') return 'CT';
    return null;
}

function number(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function mapName(payload) {
    return String(payload?.header?.map_name || payload?.match?.map || '');
}

function isSupported(payload) {
    return mapName(payload).toLowerCase() === SUPPORTED_MAP;
}

function allSamples(payload) {
    if (Array.isArray(payload?.all_player_samples)) return payload.all_player_samples;
    return Array.isArray(payload?.target_samples) ? payload.target_samples : [];
}

function playerSideMap(payload) {
    const result = new Map();
    for (const player of payload?.players || []) {
        const side = normalizeSide(player.side);
        if (player.steamid && side) result.set(String(player.steamid), side);
    }
    for (const sample of allSamples(payload)) {
        const side = normalizeSide(sample.side);
        if (sample.steamid && side && !result.has(String(sample.steamid))) result.set(String(sample.steamid), side);
    }
    return result;
}

function playerNameMap(payload) {
    const result = new Map();
    for (const player of payload?.players || []) {
        if (player.steamid) result.set(String(player.steamid), player.name || String(player.steamid));
    }
    for (const sample of allSamples(payload)) {
        if (sample.steamid && !result.has(String(sample.steamid)) && sample.name) result.set(String(sample.steamid), sample.name);
    }
    return result;
}

function findRound(payload, roundNum) {
    return (payload?.rounds || []).find((round) => Number(round.round_num) === Number(roundNum)) || null;
}

function tickRate(payload) {
    return number(payload?.tick_rate) || 64;
}

function firstTick(samples, round) {
    const values = samples.map((sample) => number(sample.tick)).filter((value) => value !== null);
    const fallback = values.length ? Math.min(...values) : 0;
    return number(round?.start_tick) ?? fallback;
}

function sampleZone(sample) {
    const x = number(sample?.x);
    const y = number(sample?.y);
    if (x === null || y === null) return null;
    return knowledge.zoneAt(x, y, { toleranceWorld: 70 });
}

function teamSamples(payload, roundNum, side) {
    const sides = playerSideMap(payload);
    return allSamples(payload).filter((sample) => {
        if (Number(sample.round_num) !== Number(roundNum)) return false;
        return normalizeSide(sample.side) === side || sides.get(String(sample.steamid)) === side;
    });
}

function sampleWindow(samples, round, maxSeconds) {
    if (!samples.length) return [];
    const rate = tickRate(round?.payload || { tick_rate: round?.tick_rate });
    const start = firstTick(samples, round);
    const end = start + maxSeconds * rate;
    return samples.filter((sample) => {
        const tick = number(sample.tick);
        return tick !== null && tick >= start && tick <= end;
    });
}

function uniquePlayersInZones(samples, zones) {
    const players = new Set();
    for (const sample of samples) {
        const zone = sampleZone(sample);
        if (zone && zones.has(zone.id)) players.add(String(sample.steamid));
    }
    return players.size;
}

function allZoneCounts(samples) {
    const counts = {};
    for (const sample of samples) {
        const zone = sampleZone(sample);
        if (!zone) continue;
        const id = String(sample.steamid);
        counts[zone.id] ||= new Set();
        counts[zone.id].add(id);
    }
    return Object.fromEntries(Object.entries(counts).map(([zone, players]) => [zone, players.size]));
}

function eventZone(x, y) {
    const zone = knowledge.zoneAt(x, y);
    return zone ? zone.id : null;
}

function firstContact(payload, roundNum, side) {
    const sides = playerSideMap(payload);
    const round = findRound(payload, roundNum) || {};
    const start = number(round.start_tick) ?? 0;
    const rate = tickRate(payload);
    const kills = (payload?.kills || [])
        .filter((kill) => Number(kill.round_num) === Number(roundNum))
        .sort((a, b) => Number(a.tick) - Number(b.tick));
    const kill = kills.find((item) => {
        const attackerSide = normalizeSide(item.attacker_side) || sides.get(String(item.attacker_steamid));
        const victimSide = normalizeSide(item.victim_side) || sides.get(String(item.victim_steamid));
        return attackerSide === side || victimSide === side;
    });
    if (!kill) return null;
    const victimZone = eventZone(kill.victim_x, kill.victim_y);
    const attackerZone = eventZone(kill.attacker_x, kill.attacker_y);
    return {
        event_id: kill.event_id || null,
        tick: number(kill.tick),
        seconds: number(kill.tick) === null ? null : Math.max(0, (Number(kill.tick) - start) / rate),
        victim_zone_id: victimZone,
        attacker_zone_id: attackerZone,
        victim_side: normalizeSide(kill.victim_side) || sides.get(String(kill.victim_steamid)) || null,
        attacker_side: normalizeSide(kill.attacker_side) || sides.get(String(kill.attacker_steamid)) || null
    };
}

function utilityTypeMatches(actual, expected) {
    const value = String(actual || '').toLowerCase();
    if (expected === 'smoke') return value.includes('smoke');
    if (expected === 'flash') return value.includes('flash');
    if (expected === 'fire') return value.includes('fire') || value.includes('molotov') || value.includes('incendiary');
    return false;
}

function matchingUtility(side, actualType, zoneId) {
    for (const candidate of knowledge.load().utilities.utilities) {
        if (candidate.side !== side) continue;
        if (!utilityTypeMatches(actualType, candidate.type)) continue;
        if ((candidate.target.zone_ids || []).includes(zoneId)) return candidate;
    }
    return null;
}

function observedUtilities(payload, roundNum, side) {
    const sides = playerSideMap(payload);
    const names = playerNameMap(payload);
    const observed = [];
    const unmatched = [];
    const add = (actualType, event, x, y) => {
        const thrower = String(event.thrower_steamid || '');
        const throwerSide = normalizeSide(event.thrower_side) || sides.get(thrower);
        if (throwerSide !== side) return;
        const zoneId = eventZone(x, y);
        if (!zoneId) {
            unmatched.push({ type: actualType, event_id: event.event_id, reason: 'no_zone', x, y });
            return;
        }
        const def = matchingUtility(side, actualType, zoneId);
        if (!def) {
            unmatched.push({ type: actualType, event_id: event.event_id, reason: 'no_known_utility_for_zone', zone_id: zoneId });
            return;
        }
        observed.push({
            utility_id: def.id,
            type: def.type,
            event_id: event.event_id || null,
            thrower_steamid: thrower || null,
            thrower_name: names.get(thrower) || null,
            tick: number(event.start_tick ?? event.tick),
            target_zone_id: zoneId
        });
    };

    for (const smoke of payload?.smokes || []) {
        if (Number(smoke.round_num) !== Number(roundNum)) continue;
        add('smoke', smoke, smoke.x, smoke.y);
    }
    for (const fire of payload?.fires || []) {
        if (Number(fire.round_num) !== Number(roundNum)) continue;
        add('fire', fire, fire.x, fire.y);
    }
    for (const grenade of payload?.grenades || []) {
        if (Number(grenade.round_num) !== Number(roundNum)) continue;
        const type = String(grenade.type || '').toLowerCase();
        if (!type.includes('flash')) continue;
        const points = Array.isArray(grenade.points) ? grenade.points : [];
        const last = points.length ? points[points.length - 1] : null;
        if (!last) {
            unmatched.push({ type: 'flash', event_id: grenade.event_id, reason: 'no_detonation_point' });
            continue;
        }
        add('flash', { ...grenade, start_tick: grenade.tick }, last[0], last[1]);
    }

    // Attach blind outcomes to observed flash utilities when the demo has them.
    for (const entry of observed) {
        if (entry.type !== 'flash') continue;
        const blinds = (payload?.blinds || []).filter((blind) =>
            Number(blind.round_num) === Number(roundNum) &&
            String(blind.attacker_steamid || '') === String(entry.thrower_steamid || '') &&
            (number(blind.duration) === null || Number(blind.duration) >= 0.5)
        );
        entry.effects = {
            enemy_blinds: blinds.filter((blind) => normalizeSide(blind.victim_side) && normalizeSide(blind.victim_side) !== side).length,
            teammate_blinds: blinds.filter((blind) => normalizeSide(blind.victim_side) === side && String(blind.victim_steamid) !== String(entry.thrower_steamid)).length,
            self_blinds: blinds.filter((blind) => String(blind.victim_steamid) === String(entry.thrower_steamid)).length
        };
    }

    const grouped = new Map();
    for (const entry of observed) {
        const current = grouped.get(entry.utility_id) || {
            utility_id: entry.utility_id,
            type: entry.type,
            events: [],
            throwers: [],
            target_zone_ids: []
        };
        current.events.push(entry.event_id);
        if (entry.thrower_steamid) current.throwers.push(entry.thrower_steamid);
        if (entry.target_zone_id) current.target_zone_ids.push(entry.target_zone_id);
        if (entry.effects) current.effects = entry.effects;
        grouped.set(entry.utility_id, current);
    }
    return {
        observed: [...grouped.values()].map((entry) => ({
            ...entry,
            throwers: [...new Set(entry.throwers)],
            target_zone_ids: [...new Set(entry.target_zone_ids)]
        })),
        unmatched
    };
}

function spawnAssignments(payload, roundNum, side) {
    const slots = knowledge.load().zones.spawn_slots.filter((slot) => slot.team === side);
    const samples = teamSamples(payload, roundNum, side);
    if (!samples.length) return [];
    const firstByPlayer = new Map();
    for (const sample of samples) {
        const id = String(sample.steamid);
        if (!firstByPlayer.has(id)) firstByPlayer.set(id, sample);
    }
    const assignments = [];
    const used = new Set();
    const orderedSlots = [...slots].sort((a, b) => a.id.localeCompare(b.id));
    for (const slot of orderedSlots) {
        const target = knowledge.load().zoneById.get(slot.target_zone_id);
        if (!target) continue;
        let best = null;
        let bestDistance = Infinity;
        for (const [steamid, sample] of firstByPlayer) {
            if (used.has(steamid)) continue;
            const x = number(sample.x);
            const y = number(sample.y);
            if (x === null || y === null) continue;
            const distance = Math.hypot(x - target.center_world[0], y - target.center_world[1]);
            if (distance < bestDistance) {
                best = steamid;
                bestDistance = distance;
            }
        }
        if (best) {
            used.add(best);
            assignments.push({ slot_id: slot.id, steamid: best, distance_to_target: Math.round(bestDistance) });
        }
    }
    return assignments;
}

function candidate(tacticId, reasons, metrics) {
    const def = knowledge.tactic(tacticId);
    return {
        tactic_id: tacticId,
        name: def?.name || tacticId,
        confidence: 'draft',
        reasons,
        metrics
    };
}

function classifyTactic(payload, roundNum, side) {
    if (!isSupported(payload)) {
        return {
            status: 'unsupported',
            map: mapName(payload) || null,
            reason: 'Only de_dust2 is supported by the Dust2 knowledge pack.'
        };
    }
    const normalizedSide = normalizeSide(side);
    if (!normalizedSide) return { status: 'invalid_side', side };
    const round = findRound(payload, roundNum);
    if (!round) return { status: 'round_not_found', round_num: roundNum };
    const samples = teamSamples(payload, roundNum, normalizedSide);
    if (!samples.length) {
        return { status: 'insufficient_data', round_num: Number(roundNum), team_side: normalizedSide, reason: 'No all-player samples for this team/round.' };
    }
    const rate = tickRate(payload);
    const start = firstTick(samples, round);
    const early = samples.filter((sample) => {
        const tick = number(sample.tick);
        return tick !== null && tick >= start && tick <= start + EARLY_SECONDS * rate;
    });
    const late = samples.filter((sample) => {
        const tick = number(sample.tick);
        return tick !== null && tick >= start && tick <= start + MID_SECONDS * rate;
    });
    const earlyCounts = {
        a_long_approach: uniquePlayersInZones(early, A_LONG_APPROACH),
        a_short_approach: uniquePlayersInZones(early, A_SHORT_APPROACH),
        b_tunnel_approach: uniquePlayersInZones(early, B_TUNNEL_APPROACH),
        mid_approach: uniquePlayersInZones(early, MID_APPROACH),
        a_site: uniquePlayersInZones(early, A_SITE_ZONES),
        b_site: uniquePlayersInZones(early, B_SITE_ZONES)
    };
    const allCounts = allZoneCounts(samples);
    const contact = firstContact(payload, roundNum, normalizedSide);
    const utility = observedUtilities(payload, roundNum, normalizedSide);
    const utilityIds = new Set(utility.observed.map((item) => item.utility_id));
    const candidates = [];

    if (normalizedSide === 'T') {
        if (earlyCounts.b_tunnel_approach >= 3 || (earlyCounts.b_tunnel_approach >= 2 && contact?.victim_zone_id === 'b_tunnel')) {
            candidates.push(candidate('dust2_t_b_tunnel_rush', [
                `${earlyCounts.b_tunnel_approach} 名 T 在前 ${EARLY_SECONDS} 秒进入 B 洞路线`,
                utilityIds.has('dust2_util_t_b_tunnel_smoke') ? '观察到 B 洞烟' : '未观察到 B 洞烟'
            ], { early_counts: earlyCounts, first_contact: contact, utilities: [...utilityIds] }));
        }
        if (earlyCounts.a_long_approach >= 3 || (earlyCounts.a_long_approach >= 2 && contact?.victim_zone_id && ['a_long', 'a_long_pit', 'a_site'].includes(contact.victim_zone_id))) {
            candidates.push(candidate('dust2_t_a_long_rush', [
                `${earlyCounts.a_long_approach} 名 T 在前 ${EARLY_SECONDS} 秒进入 A 大路线`,
                utilityIds.has('dust2_util_t_mid_fast_smoke') ? '观察到中门快烟' : '未观察到中门快烟'
            ], { early_counts: earlyCounts, first_contact: contact, utilities: [...utilityIds] }));
        }
        if (earlyCounts.a_short_approach >= 2 && (earlyCounts.a_long_approach >= 1 || earlyCounts.mid_approach >= 1)) {
            candidates.push(candidate('dust2_t_a_short_split', [
                `${earlyCounts.a_short_approach} 名 T 进入 A 小路线`,
                `${earlyCounts.a_long_approach + earlyCounts.mid_approach} 名 T 在 A 大/中路形成第二压力点`
            ], { early_counts: earlyCounts, first_contact: contact, utilities: [...utilityIds] }));
        }
        if (earlyCounts.mid_approach >= 2 || utilityIds.has('dust2_util_t_mid_fast_smoke')) {
            candidates.push(candidate('dust2_t_mid_default_fake', [
                `${earlyCounts.mid_approach} 名 T 进入中路控制区`,
                utilityIds.has('dust2_util_t_mid_fast_smoke') ? '观察到中门快烟' : '中路控制未观察到中门烟'
            ], { early_counts: earlyCounts, first_contact: contact, utilities: [...utilityIds] }));
        }
    } else {
        if (earlyCounts.a_long_approach >= 1 && utilityIds.has('dust2_util_ct_a_long_push_flash') &&
            (!contact || ['a_long', 'long_doors', 'a_long_pit'].includes(contact.victim_zone_id))) {
            candidates.push(candidate('dust2_ct_a_long_pressure', [
                'CT 进入 A 大前压路线',
                '观察到 CT A 大前压闪',
                contact ? '前压期间发生 A 大方向交火' : '暂无 A 大方向交火'
            ], { early_counts: earlyCounts, first_contact: contact, utilities: [...utilityIds] }));
        }
        if (earlyCounts.a_site >= 1 || earlyCounts.b_site >= 1 || earlyCounts.mid_approach >= 1 || earlyCounts.a_long_approach >= 1) {
            candidates.push(candidate('dust2_ct_default', [
                'CT 保持包点/中路/回防站位，没有形成明确的多人前压'
            ], { early_counts: earlyCounts, first_contact: contact, utilities: [...utilityIds] }));
        }
    }

    return {
        status: candidates.length ? 'classified' : 'unclassified',
        map: mapName(payload),
        round_num: Number(roundNum),
        team_side: normalizedSide,
        candidates,
        facts: {
            early_seconds: EARLY_SECONDS,
            early_zone_counts: earlyCounts,
            all_zone_counts: allCounts,
            first_contact: contact,
            observed_utilities: utility.observed,
            unmatched_utilities: utility.unmatched,
            spawn_assignments: spawnAssignments(payload, roundNum, normalizedSide)
        }
    };
}

function evaluateTactic(payload, roundNum, side, tacticId) {
    const def = knowledge.tactic(tacticId);
    if (!def) throw new Error(`Unknown Dust2 tactic: ${tacticId}`);
    const classification = classifyTactic(payload, roundNum, side);
    if (classification.status !== 'classified') return { ...classification, tactic_id: tacticId, checks: [] };
    const facts = classification.facts;
    const observed = new Set((facts.observed_utilities || []).map((item) => item.utility_id));
    const zones = facts.all_zone_counts || {};
    const spawns = new Map((facts.spawn_assignments || []).map((item) => [item.slot_id, item]));
    const checks = [];

    for (const zoneId of def.required_zone_presence || []) {
        checks.push({
            id: `zone:${zoneId}`,
            kind: 'required_zone',
            passed: Number(zones[zoneId] || 0) > 0,
            detail: `${zones[zoneId] || 0} 名队伍玩家到达 ${zoneId}`
        });
    }
    for (const slotId of def.required_spawn_slots || []) {
        checks.push({
            id: `spawn:${slotId}`,
            kind: 'required_spawn_slot',
            passed: spawns.has(slotId),
            detail: spawns.get(slotId)?.steamid || '未匹配到出生位'
        });
    }
    for (const utilityId of def.required_utility || []) {
        checks.push({
            id: `utility:${utilityId}`,
            kind: 'required_utility',
            passed: observed.has(utilityId),
            detail: observed.has(utilityId) ? '观察到该道具事件' : '未观察到该道具事件'
        });
    }
    const primary = classification.candidates.find((item) => item.tactic_id === tacticId) || null;
    return {
        ...classification,
        tactic_id: tacticId,
        tactic_name: def.name,
        classification_match: Boolean(primary),
        checks,
        missing_checks: checks.filter((check) => !check.passed).map((check) => check.id),
        note: 'This evaluates observed execution and template fit; it does not yet judge economy or opponent counterplay.'
    };
}

function analyzeTeamRound(payload, roundNum, side) {
    const classification = classifyTactic(payload, roundNum, side);
    if (classification.status !== 'classified') return classification;
    const primary = classification.candidates[0];
    const involvement = new Map();
    const names = playerNameMap(payload);
    const sides = playerSideMap(payload);
    for (const sample of teamSamples(payload, roundNum, normalizeSide(side))) {
        const sid = String(sample.steamid);
        const zone = sampleZone(sample);
        if (!involvement.has(sid)) {
            involvement.set(sid, {
                steamid: sid,
                name: names.get(sid) || sid,
                zones: new Set(),
                sample_count: 0
            });
        }
        const entry = involvement.get(sid);
        entry.sample_count += 1;
        if (zone) entry.zones.add(zone.id);
    }
    for (const entry of involvement.values()) entry.zones = [...entry.zones];
    return {
        ...classification,
        primary_tactic_id: primary?.tactic_id || null,
        primary_tactic_name: primary?.name || null,
        evaluation: primary ? evaluateTactic(payload, roundNum, side, primary.tactic_id) : null,
        player_involvement: [...involvement.values()],
        player_sides: Object.fromEntries(sides)
    };
}

function analyzeTeamMatch(payload, side, options = {}) {
    if (!isSupported(payload)) {
        return { status: 'unsupported', map: mapName(payload) || null, rounds: [] };
    }
    const maxRounds = Math.max(1, Math.min(Number(options.maxRounds) || 10, 30));
    const rounds = [...(payload.rounds || [])]
        .sort((a, b) => Number(a.round_num) - Number(b.round_num))
        .slice(0, maxRounds);
    const analyses = rounds.map((round) => analyzeTeamRound(payload, round.round_num, side));
    return {
        status: 'ok',
        map: mapName(payload),
        team_side: normalizeSide(side),
        rounds: analyses,
        summary: {
            rounds_analyzed: analyses.length,
            classified_rounds: analyses.filter((item) => item.status === 'classified').length,
            insufficient_data_rounds: analyses.filter((item) => item.status === 'insufficient_data').length,
            primary_tactics: analyses
                .filter((item) => item.primary_tactic_id)
                .reduce((counts, item) => {
                    counts[item.primary_tactic_id] = (counts[item.primary_tactic_id] || 0) + 1;
                    return counts;
                }, {})
        }
    };
}

module.exports = {
    SUPPORTED_MAP,
    normalizeSide,
    isSupported,
    classifyTactic,
    evaluateTactic,
    analyzeTeamRound,
    analyzeTeamMatch,
    observedUtilities,
    spawnAssignments,
    firstContact
};
