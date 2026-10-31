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
const { attributeUtility } = require('./utilityAttribution');

const SUPPORTED_MAP = 'de_dust2';
const EARLY_SECONDS = 12;
const MID_SECONDS = 22;

const A_LONG_APPROACH = new Set(['a_long', 'long_doors', 'a_long_pit']);
const A_SHORT_APPROACH = new Set(['a_short', 'a_short_stairs']);
const B_TUNNEL_APPROACH = new Set(['lower_tunnels', 'b_tunnel', 'upper_tunnels']);
const MID_APPROACH = new Set(['mid', 'mid_doors', 'xbox', 'catwalk', 't_ramp']);
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

/**
 * Group demo players by the team identifier present in the demo. The demo's
 * `team_clan_name` is the user-facing team ID for v0.1; a persistent software
 * account binding is explicitly deferred.
 */
function teamRosters(payload) {
    const groups = new Map();
    for (const player of payload?.players || []) {
        const key = String(player.team_clan_name || player.team || player.side || 'unknown');
        const current = groups.get(key) || { team_clan_name: key, steamids: [], names: [], sides: [] };
        if (player.steamid) current.steamids.push(String(player.steamid));
        if (player.name) current.names.push(player.name);
        const side = normalizeSide(player.side);
        if (side && !current.sides.includes(side)) current.sides.push(side);
        groups.set(key, current);
    }
    return [...groups.values()].map((team) => ({
        ...team,
        steamids: [...new Set(team.steamids)],
        names: [...new Set(team.names)]
    }));
}

/**
 * Accept a side ("T"/"CT"), a demo team name, an array of SteamID64s, or an
 * object such as { teamClanName: "TEAM A" } / { steamIds: [...] }.
 */
function resolveTeam(payload, selection) {
    if (selection && typeof selection === 'object') {
        if (selection.teamClanName || selection.clanName || selection.name) {
            return resolveTeam(payload, selection.teamClanName || selection.clanName || selection.name);
        }
        if (selection.steamIds || selection.steamids) {
            return resolveTeam(payload, selection.steamIds || selection.steamids);
        }
    }
    if (Array.isArray(selection)) {
        const steamIds = new Set(selection.map(String).filter(Boolean));
        return { mode: 'roster', steamIds, label: `${steamIds.size} players`, teamClanName: null };
    }
    if (selection && typeof selection === 'object' && selection instanceof Set) {
        return { mode: 'roster', steamIds: new Set([...selection].map(String)), label: `${selection.size} players`, teamClanName: null };
    }
    if (typeof selection === 'string') {
        const side = normalizeSide(selection);
        if (side) return { mode: 'side', side, label: side, steamIds: null, teamClanName: null };
        const csv = selection.split(',').map((value) => value.trim()).filter(Boolean);
        if (csv.length > 1 || /^\d{8,20}$/.test(selection.trim())) {
            return resolveTeam(payload, csv);
        }
        const roster = teamRosters(payload).find((team) =>
            team.team_clan_name === selection || team.team_clan_name.toLowerCase() === selection.toLowerCase()
        );
        if (roster) {
            return {
                mode: 'roster',
                steamIds: new Set(roster.steamids),
                label: roster.team_clan_name,
                teamClanName: roster.team_clan_name
            };
        }
    }
    return { mode: 'unknown', side: null, label: String(selection || ''), steamIds: null, teamClanName: null };
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

function actionStartTick(samples, round) {
    // Dust2 rounds have a buy/freeze phase. Classifying early movement from
    // round.start_tick would treat every frozen spawn position as a tactic.
    return number(round?.freeze_end_tick) ?? firstTick(samples, round);
}

function sampleZone(sample) {
    const x = number(sample?.x);
    const y = number(sample?.y);
    if (x === null || y === null) return null;
    return knowledge.zoneAt(x, y, { toleranceWorld: 70 });
}

function teamSamples(payload, roundNum, team) {
    const selection = team?.mode ? team : resolveTeam(payload, team);
    return allSamples(payload).filter((sample) => {
        if (Number(sample.round_num) !== Number(roundNum)) return false;
        if (selection.mode === 'roster') return selection.steamIds.has(String(sample.steamid));
        if (selection.mode === 'side') return normalizeSide(sample.side) === selection.side;
        return false;
    });
}

function roundTeamSide(payload, roundNum, team, samples = null) {
    const selection = team?.mode ? team : resolveTeam(payload, team);
    if (selection.mode === 'side') return selection.side;
    const source = samples || teamSamples(payload, roundNum, selection);
    for (const sample of source) {
        const side = normalizeSide(sample.side);
        if (side) return side;
    }
    return null;
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

function isSelectedPlayer(payload, team, steamid) {
    if (team.mode === 'roster') return team.steamIds.has(String(steamid));
    const side = playerSideMap(payload).get(String(steamid));
    return Boolean(side && side === team.side);
}

function firstContact(payload, roundNum, team) {
    const selection = team?.mode ? team : resolveTeam(payload, team);
    const sides = playerSideMap(payload);
    const round = findRound(payload, roundNum) || {};
    const start = number(round.freeze_end_tick) ?? number(round.start_tick) ?? 0;
    const rate = tickRate(payload);
    const kills = (payload?.kills || [])
        .filter((kill) => Number(kill.round_num) === Number(roundNum))
        .sort((a, b) => Number(a.tick) - Number(b.tick));
    const kill = kills.find((item) => isSelectedPlayer(payload, selection, item.attacker_steamid) ||
        isSelectedPlayer(payload, selection, item.victim_steamid));
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

function teamBombSite(payload, roundNum, team) {
    const selection = team?.mode ? team : resolveTeam(payload, team);
    const plants = (payload?.bomb || [])
        .filter((event) => Number(event.round_num) === Number(roundNum) &&
            String(event.event || '').toLowerCase().includes('finish_plant') &&
            event.bombsite)
        .filter((event) => isSelectedPlayer(payload, selection, event.steamid));
    return plants.length ? String(plants.at(-1).bombsite).toUpperCase() : null;
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

function observedUtilities(payload, roundNum, team) {
    const selection = team?.mode ? team : resolveTeam(payload, team);
    const side = roundTeamSide(payload, roundNum, selection);
    if (!side) return { observed: [], unmatched: [], side: null };
    const names = playerNameMap(payload);
    const attributed = attributeUtility(payload);
    const observed = [];
    const unmatched = [];
    const add = (actualType, event, x, y) => {
        const inferred = attributed.get(event.event_id) || null;
        const thrower = String(event.thrower_steamid || inferred?.thrower_steamid || '');
        if (!thrower || !isSelectedPlayer(payload, selection, thrower)) return;
        const throwerSide = normalizeSide(event.thrower_side) || inferred?.thrower_side || playerSideMap(payload).get(thrower) || side;
        if (selection.mode === 'side' && throwerSide !== selection.side) return;
        if (selection.mode === 'roster' && throwerSide !== side) return;
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
            thrower_name: names.get(thrower) || inferred?.thrower_name || null,
            thrower_attribution: inferred || null,
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
            utility_id: entry.utility_id, type: entry.type, events: [], throwers: [], target_zone_ids: []
        };
        current.events.push(entry.event_id);
        if (entry.thrower_steamid) current.throwers.push(entry.thrower_steamid);
        if (entry.target_zone_id) current.target_zone_ids.push(entry.target_zone_id);
        if (entry.effects) current.effects = entry.effects;
        grouped.set(entry.utility_id, current);
    }
    return {
        side,
        observed: [...grouped.values()].map((entry) => ({
            ...entry,
            throwers: [...new Set(entry.throwers)],
            target_zone_ids: [...new Set(entry.target_zone_ids)]
        })),
        unmatched
    };
}

function spawnAssignments(payload, roundNum, team, effectiveSide = null) {
    const selection = team?.mode ? team : resolveTeam(payload, team);
    const side = effectiveSide || roundTeamSide(payload, roundNum, selection);
    if (!side) return [];
    const slots = knowledge.load().zones.spawn_slots.filter((slot) => slot.team === side);
    const samples = teamSamples(payload, roundNum, selection);
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
    return { tactic_id: tacticId, name: def?.name || tacticId, confidence: 'draft', reasons, metrics };
}

function classifyTactic(payload, roundNum, team) {
    if (!isSupported(payload)) {
        return { status: 'unsupported', map: mapName(payload) || null, reason: 'Only de_dust2 is supported by the Dust2 knowledge pack.' };
    }
    const selection = team?.mode ? team : resolveTeam(payload, team);
    if (selection.mode === 'unknown') {
        return { status: 'invalid_team', team: selection.label, reason: 'Pass T/CT, a demo team name, or a SteamID roster.' };
    }
    const round = findRound(payload, roundNum);
    if (!round) return { status: 'round_not_found', round_num: roundNum };
    const samples = teamSamples(payload, roundNum, selection);
    if (!samples.length) {
        return { status: 'insufficient_data', round_num: Number(roundNum), team: selection.label, reason: 'No all-player samples for this team/round.' };
    }
    const side = roundTeamSide(payload, roundNum, selection, samples);
    if (!side) {
        return { status: 'insufficient_data', round_num: Number(roundNum), team: selection.label, reason: 'Could not determine this team side for the round.' };
    }
    const rate = tickRate(payload);
    const start = actionStartTick(samples, round);
    const early = samples.filter((sample) => {
        const tick = number(sample.tick);
        return tick !== null && tick >= start && tick <= start + EARLY_SECONDS * rate;
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
    const contact = firstContact(payload, roundNum, selection);
    const plantSite = side === 'T' ? teamBombSite(payload, roundNum, selection) : null;
    const utility = observedUtilities(payload, roundNum, selection);
    const utilityIds = new Set(utility.observed.map((item) => item.utility_id));
    const candidates = [];
    const common = { early_counts: earlyCounts, first_contact: contact, utilities: [...utilityIds], planted_site: plantSite };

    if (side === 'T') {
        // The bomb site is a strong objective signal. Early B pressure followed
        // by an A plant is a fake/rotate, not a B rush.
        if (plantSite === 'A') {
            if (earlyCounts.a_long_approach >= 2) {
                candidates.push(candidate('dust2_t_a_long_rush', [
                    `${earlyCounts.a_long_approach} 名 T 进入 A 大路线，且最终在 A 下包`,
                    utilityIds.has('dust2_util_t_mid_fast_smoke') ? '观察到中门快烟' : '未观察到中门快烟'
                ], common));
            } else if (earlyCounts.a_short_approach >= 2) {
                candidates.push(candidate('dust2_t_a_short_split', [
                    `${earlyCounts.a_short_approach} 名 T 进入 A 小路线，且最终在 A 下包`
                ], common));
            } else if (earlyCounts.b_tunnel_approach >= 2 || earlyCounts.mid_approach >= 3) {
                candidates.push(candidate('dust2_t_mid_default_fake', [
                    `早期有 ${earlyCounts.b_tunnel_approach} 人走 B 洞路线，但最终在 A 下包`,
                    `中路控制 ${earlyCounts.mid_approach} 人，符合假打/转点特征`
                ], common));
            } else {
                candidates.push(candidate('dust2_t_mid_default_fake', ['最终在 A 下包，但早期没有明确的单一路线 Rush'], common));
            }
        } else if (plantSite === 'B') {
            if (earlyCounts.b_tunnel_approach >= 2 || allCounts.b_site > 0) {
                candidates.push(candidate('dust2_t_b_tunnel_rush', [
                    `${earlyCounts.b_tunnel_approach} 名 T 进入 B 洞路线，且最终在 B 下包`,
                    utilityIds.has('dust2_util_t_b_tunnel_smoke') ? '观察到 B 洞烟' : '未观察到 B 洞烟'
                ], common));
            } else if (earlyCounts.a_long_approach >= 2 || earlyCounts.a_short_approach >= 2) {
                candidates.push(candidate('dust2_t_mid_default_fake', ['早期在 A 侧施压，但最终转 B 下包'], common));
            } else {
                candidates.push(candidate('dust2_t_mid_default_fake', ['最终在 B 下包，但早期没有明确的单一路线 Rush'], common));
            }
        } else {
            if (earlyCounts.b_tunnel_approach >= 3 || (earlyCounts.b_tunnel_approach >= 2 && contact?.victim_zone_id === 'b_tunnel')) {
                candidates.push(candidate('dust2_t_b_tunnel_rush', [
                    `${earlyCounts.b_tunnel_approach} 名 T 在前 ${EARLY_SECONDS} 秒进入 B 洞路线`,
                    utilityIds.has('dust2_util_t_b_tunnel_smoke') ? '观察到 B 洞烟' : '未观察到 B 洞烟'
                ], common));
            }
            if (earlyCounts.a_long_approach >= 3 || (earlyCounts.a_long_approach >= 2 && contact?.victim_zone_id && ['a_long', 'a_long_pit', 'a_site'].includes(contact.victim_zone_id))) {
                candidates.push(candidate('dust2_t_a_long_rush', [
                    `${earlyCounts.a_long_approach} 名 T 在前 ${EARLY_SECONDS} 秒进入 A 大路线`,
                    utilityIds.has('dust2_util_t_mid_fast_smoke') ? '观察到中门快烟' : '未观察到中门快烟'
                ], common));
            }
            if (earlyCounts.a_short_approach >= 2 && (earlyCounts.a_long_approach >= 1 || earlyCounts.mid_approach >= 1)) {
                candidates.push(candidate('dust2_t_a_short_split', [
                    `${earlyCounts.a_short_approach} 名 T 进入 A 小路线`,
                    `${earlyCounts.a_long_approach + earlyCounts.mid_approach} 名 T 在 A 大/中路形成第二压力点`
                ], common));
            }
            if (earlyCounts.mid_approach >= 2 || utilityIds.has('dust2_util_t_mid_fast_smoke')) {
                candidates.push(candidate('dust2_t_mid_default_fake', [
                    `${earlyCounts.mid_approach} 名 T 进入中路控制区`,
                    utilityIds.has('dust2_util_t_mid_fast_smoke') ? '观察到中门快烟' : '中路控制未观察到中门烟'
                ], common));
            }
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
        team: { mode: selection.mode, label: selection.label, team_clan_name: selection.teamClanName || null },
        team_side: side,
        candidates,
        facts: {
            early_seconds: EARLY_SECONDS,
            early_zone_counts: earlyCounts,
            all_zone_counts: allCounts,
            first_contact: contact,
            planted_site: plantSite,
            observed_utilities: utility.observed,
            unmatched_utilities: utility.unmatched,
            spawn_assignments: spawnAssignments(payload, roundNum, selection, side)
        }
    };
}

function evaluateTactic(payload, roundNum, team, tacticId) {
    const def = knowledge.tactic(tacticId);
    if (!def) throw new Error(`Unknown Dust2 tactic: ${tacticId}`);
    const classification = classifyTactic(payload, roundNum, team);
    if (classification.status !== 'classified') return { ...classification, tactic_id: tacticId, checks: [] };
    if (def.side !== classification.team_side) {
        return { ...classification, tactic_id: tacticId, status: 'side_mismatch', checks: [], reason: `Tactic requires ${def.side}, round side is ${classification.team_side}.` };
    }
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

function analyzeTeamRound(payload, roundNum, team) {
    const classification = classifyTactic(payload, roundNum, team);
    if (classification.status !== 'classified') return classification;
    const primary = classification.candidates[0];
    const involvement = new Map();
    const names = playerNameMap(payload);
    const selection = team?.mode ? team : resolveTeam(payload, team);
    for (const sample of teamSamples(payload, roundNum, selection)) {
        const sid = String(sample.steamid);
        const zone = sampleZone(sample);
        if (!involvement.has(sid)) {
            involvement.set(sid, { steamid: sid, name: names.get(sid) || sid, zones: new Set(), sample_count: 0 });
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
        evaluation: primary ? evaluateTactic(payload, roundNum, selection, primary.tactic_id) : null,
        player_involvement: [...involvement.values()]
    };
}

function analyzeTeamMatch(payload, team, options = {}) {
    if (!isSupported(payload)) return { status: 'unsupported', map: mapName(payload) || null, rounds: [] };
    const selection = team?.mode ? team : resolveTeam(payload, team);
    if (selection.mode === 'unknown') return { status: 'invalid_team', team: team || null, rounds: [] };
    const maxRounds = Math.max(1, Math.min(Number(options.maxRounds) || 10, 30));
    const rounds = [...(payload.rounds || [])]
        .sort((a, b) => Number(a.round_num) - Number(b.round_num))
        .slice(0, maxRounds);
    const analyses = rounds.map((round) => analyzeTeamRound(payload, round.round_num, selection));
    return {
        status: 'ok',
        map: mapName(payload),
        team: { mode: selection.mode, label: selection.label, team_clan_name: selection.teamClanName || null, steamids: selection.steamIds ? [...selection.steamIds] : null },
        rounds: analyses,
        summary: {
            rounds_analyzed: analyses.length,
            classified_rounds: analyses.filter((item) => item.status === 'classified').length,
            insufficient_data_rounds: analyses.filter((item) => item.status === 'insufficient_data').length,
            primary_tactics: analyses.filter((item) => item.primary_tactic_id).reduce((counts, item) => {
                counts[item.primary_tactic_id] = (counts[item.primary_tactic_id] || 0) + 1;
                return counts;
            }, {})
        }
    };
}

module.exports = {
    SUPPORTED_MAP,
    EARLY_SECONDS,
    normalizeSide,
    isSupported,
    teamRosters,
    resolveTeam,
    teamSamples,
    roundTeamSide,
    sampleZone,
    allZoneCounts,
    eventZone,
    playerSideMap,
    playerNameMap,
    classifyTactic,
    evaluateTactic,
    analyzeTeamRound,
    analyzeTeamMatch,
    observedUtilities,
    spawnAssignments,
    firstContact,
    teamBombSite
};
