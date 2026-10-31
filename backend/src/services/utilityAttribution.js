'use strict';

/**
 * Recover utility throwers when the demo parser leaves thrower_steamid null.
 *
 * CS2 demos frequently lose the thrower link for smoke/fire entities. The
 * grenade trajectory still starts at the thrower's position, so we can match the
 * first trajectory point and tick against all-player snapshots. This is an
 * attribution candidate, never an unquestioned fact.
 */

const MAX_TICK_DISTANCE = 48;
const MAX_WORLD_DISTANCE = 220;
const MIN_CONFIDENCE_WORLD_DISTANCE = 80;

function number(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function normalizeSide(value) {
    const side = String(value || '').toLowerCase();
    if (side === 't' || side === 'terrorist' || side === 'terrorists') return 'T';
    if (side === 'ct' || side === 'counter-terrorist' || side === 'counterterrorist' || side === 'counter_terrorist') return 'CT';
    return null;
}

function sampleIndex(payload) {
    const byRoundTick = new Map();
    for (const sample of payload?.all_player_samples || []) {
        const round = Number(sample.round_num);
        const tick = number(sample.tick);
        if (!Number.isFinite(round) || tick === null) continue;
        const key = `${round}:${tick}`;
        if (!byRoundTick.has(key)) byRoundTick.set(key, []);
        byRoundTick.get(key).push(sample);
    }
    return byRoundTick;
}

function inferFromTrajectory(payload, event, index = sampleIndex(payload)) {
    if (!event || !Array.isArray(event.points) || !event.points.length) return null;
    const firstPoint = event.points[0];
    const tick = number(event.point_ticks?.[0] ?? event.tick);
    if (tick === null || !Array.isArray(firstPoint)) return null;
    const [x, y] = firstPoint.map(number);
    if (x === null || y === null) return null;
    let best = null;
    for (let delta = -MAX_TICK_DISTANCE; delta <= MAX_TICK_DISTANCE; delta += 1) {
        const samples = index.get(`${event.round_num}:${tick + delta}`) || [];
        for (const sample of samples) {
            const sx = number(sample.x);
            const sy = number(sample.y);
            if (sx === null || sy === null) continue;
            const distance = Math.hypot(sx - x, sy - y);
            if (!best || distance < best.distance) best = { sample, distance };
        }
    }
    if (!best || best.distance > MAX_WORLD_DISTANCE) return null;
    return {
        thrower_steamid: best.sample.steamid ? String(best.sample.steamid) : null,
        thrower_name: best.sample.name || null,
        thrower_side: normalizeSide(best.sample.side),
        distance_world: Math.round(best.distance),
        confidence: best.distance <= MIN_CONFIDENCE_WORLD_DISTANCE ? 'medium' : 'low',
        source: 'trajectory_first_point'
    };
}

function entityKey(event) {
    if (!event || event.entity_id == null || event.entity_serial == null) return null;
    return `${event.entity_id}:${event.entity_serial}`;
}

function trajectoryEndMatch(payload, event, attributed, allowedTypes) {
    const tick = number(event.start_tick ?? event.tick);
    const x = number(event.x);
    const y = number(event.y);
    if (tick === null || x === null || y === null) return null;
    let best = null;
    for (const grenade of payload?.grenades || []) {
        if (Number(grenade.round_num) !== Number(event.round_num)) continue;
        const type = String(grenade.type || '').toLowerCase();
        if (!allowedTypes.some((allowed) => type.includes(allowed))) continue;
        const attribution = attributed.get(grenade.event_id);
        if (!attribution) continue;
        const points = Array.isArray(grenade.points) ? grenade.points : [];
        const ticks = Array.isArray(grenade.point_ticks) ? grenade.point_ticks : [];
        if (!points.length) continue;
        const last = points[points.length - 1];
        const lastTick = number(ticks[ticks.length - 1] ?? grenade.tick);
        if (!Array.isArray(last) || lastTick === null || Math.abs(lastTick - tick) > 96) continue;
        const distance = Math.hypot(Number(last[0]) - x, Number(last[1]) - y);
        if (distance > 160) continue;
        if (!best || distance < best.distance) best = { attribution, distance };
    }
    return best ? { ...best.attribution, distance_world: Math.round(best.distance), confidence: best.distance <= 80 ? 'medium' : 'low', source: 'nearest_trajectory_endpoint' } : null;
}

/**
 * Enrich utility events in memory. Existing thrower fields always win over an
 * inferred candidate.
 */
function attributeUtility(payload) {
    const index = sampleIndex(payload);
    const grenades = payload?.grenades || [];
    const byEntity = new Map();
    const byEventId = new Map();
    for (const grenade of grenades) {
        if (grenade.thrower_steamid) {
            byEventId.set(grenade.event_id, {
                thrower_steamid: String(grenade.thrower_steamid),
                thrower_name: grenade.thrower_name || null,
                thrower_side: normalizeSide(grenade.thrower_side),
                confidence: 'high',
                source: 'parser'
            });
            continue;
        }
        const inferred = inferFromTrajectory(payload, grenade, index);
        if (!inferred) continue;
        byEventId.set(grenade.event_id, inferred);
        const key = entityKey(grenade);
        if (key) byEntity.set(key, inferred);
    }

    for (const kind of ['smokes', 'fires']) {
        for (const event of payload?.[kind] || []) {
            if (event.thrower_steamid) {
                byEventId.set(event.event_id, {
                    thrower_steamid: String(event.thrower_steamid),
                    thrower_name: event.thrower_name || null,
                    thrower_side: normalizeSide(event.thrower_side),
                    confidence: 'high',
                    source: 'parser'
                });
                continue;
            }
            const match = byEntity.get(entityKey(event)) ||
                trajectoryEndMatch(payload, event, byEventId, kind === 'smokes' ? ['smoke'] : ['molotov', 'incendiary', 'inferno']);
            if (match) byEventId.set(event.event_id, { ...match, source: match.source || 'shared_entity_with_trajectory' });
        }
    }
    return byEventId;
}

module.exports = {
    attributeUtility,
    inferFromTrajectory,
    entityKey,
    MAX_TICK_DISTANCE,
    MAX_WORLD_DISTANCE
};
