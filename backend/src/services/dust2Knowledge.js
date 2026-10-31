'use strict';

/**
 * Loads the hand-curated Dust2 knowledge pack. Keep this module read-only: the
 * tactics themselves live in knowledge/dust2/*.json so they can be reviewed and
 * versioned independently from the API implementation.
 */
const fs = require('node:fs');
const path = require('node:path');

const KNOWLEDGE_DIR = path.resolve(__dirname, '../../../knowledge/dust2');
let cached = null;

function read(name) {
    return JSON.parse(fs.readFileSync(path.join(KNOWLEDGE_DIR, name), 'utf8'));
}

function load() {
    if (cached) return cached;
    const meta = read('meta.json');
    const zones = read('zones.json');
    const utilities = read('utility.json');
    const tactics = read('tactics.json');
    const sources = read('sources.json');
    const zoneById = new Map(zones.zones.map((item) => [item.id, item]));
    const spawnById = new Map(zones.spawn_slots.map((item) => [item.id, item]));
    const utilityById = new Map(utilities.utilities.map((item) => [item.id, item]));
    const tacticById = new Map(tactics.tactics.map((item) => [item.id, item]));
    cached = {
        meta, zones, utilities, tactics, sources,
        zoneById, spawnById, utilityById, tacticById
    };
    return cached;
}

function reset() {
    cached = null;
}

function worldToRadar(x, y) {
    const calibration = load().meta.calibration;
    return {
        x: (Number(x) - calibration.pos_x) / calibration.scale,
        y: (calibration.pos_y - Number(y)) / calibration.scale
    };
}

function radarToWorld(x, y) {
    const calibration = load().meta.calibration;
    return {
        x: calibration.pos_x + Number(x) * calibration.scale,
        y: calibration.pos_y - Number(y) * calibration.scale
    };
}

function pointInPolygon(x, y, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];
        const intersects = ((yi > y) !== (yj > y)) &&
            (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
        if (intersects) inside = !inside;
    }
    return inside;
}

/**
 * Return the best zone for a world position. Hand-curated radar polygons take
 * precedence over the approximate center/radius fallback; higher polygon
 * priority wins where rectangles overlap.
 */
function zoneAt(x, y, { toleranceWorld = 0 } = {}) {
    if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return null;
    const px = Number(x);
    const py = Number(y);
    const radar = worldToRadar(px, py);
    const polygonMatches = load().zones.zones
        .filter((zone) => Array.isArray(zone.polygon_radar) && pointInPolygon(radar.x, radar.y, zone.polygon_radar))
        .map((zone) => ({ zone, distance: Math.hypot(radar.x - zone.center_radar[0], radar.y - zone.center_radar[1]) }))
        .sort((a, b) => a.distance - b.distance || (b.zone.polygon_priority || 0) - (a.zone.polygon_priority || 0));
    if (polygonMatches.length) return polygonMatches[0].zone;
    let best = null;
    let bestDistance = Infinity;
    for (const zone of load().zones.zones) {
        const [zx, zy] = zone.center_world;
        const distance = Math.hypot(px - zx, py - zy);
        if (distance < bestDistance) {
            best = zone;
            bestDistance = distance;
        }
    }
    if (!best) return null;
    return bestDistance <= best.radius_world + toleranceWorld ? best : null;
}

function tactic(id) {
    return load().tacticById.get(id) || null;
}

function utility(id) {
    return load().utilityById.get(id) || null;
}

module.exports = {
    KNOWLEDGE_DIR,
    load,
    reset,
    worldToRadar,
    radarToWorld,
    zoneAt,
    tactic,
    utility
};
