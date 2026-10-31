'use strict';

/**
 * Structural validation for the hand-curated Dust2 knowledge base.
 * This deliberately does not pretend to validate tactical truth; it validates
 * references, uniqueness and the minimum fields the future rule engine needs.
 */
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '../../knowledge/dust2');
const read = (name) => JSON.parse(fs.readFileSync(path.join(base, name), 'utf8'));
const meta = read('meta.json');
const zonesDoc = read('zones.json');
const utilityDoc = read('utility.json');
const tacticsDoc = read('tactics.json');
const sourcesDoc = read('sources.json');

const errors = [];
const fail = (message) => errors.push(message);
const unique = (items, label) => {
    const seen = new Set();
    for (const item of items) {
        if (!item || typeof item.id !== 'string' || !item.id) {
            fail(`${label}: missing id`);
            continue;
        }
        if (seen.has(item.id)) fail(`${label}: duplicate id ${item.id}`);
        seen.add(item.id);
    }
    return seen;
};

if (meta.map !== 'de_dust2' || zonesDoc.map !== 'de_dust2' || utilityDoc.map !== 'de_dust2' || tacticsDoc.map !== 'de_dust2') {
    fail('all documents must target de_dust2');
}
if (meta.schema_version !== zonesDoc.schema_version ||
    meta.schema_version !== utilityDoc.schema_version ||
    meta.schema_version !== tacticsDoc.schema_version) {
    fail('schema_version mismatch across Dust2 documents');
}

const zoneIds = unique(zonesDoc.zones, 'zones');
const spawnIds = unique(zonesDoc.spawn_slots, 'spawn_slots');
const utilityIds = unique(utilityDoc.utilities, 'utilities');
const tacticIds = unique(tacticsDoc.tactics, 'tactics');
const sourceIds = unique(sourcesDoc.sources, 'sources');

for (const [label, ids] of [
    ['meta.calibration.source', [meta.calibration?.source]],
    ['zones.calibration_source', [zonesDoc.calibration_source]]
]) {
    for (const sourceId of ids.filter(Boolean)) {
        if (!sourceIds.has(sourceId)) fail(`${label}: unknown source ${sourceId}`);
    }
}

for (const slot of zonesDoc.spawn_slots) {
    if (!zoneIds.has(slot.anchor_zone_id)) fail(`spawn_slot ${slot.id}: unknown anchor_zone_id ${slot.anchor_zone_id}`);
    if (!zoneIds.has(slot.target_zone_id)) fail(`spawn_slot ${slot.id}: unknown target_zone_id ${slot.target_zone_id}`);
    if (!['T', 'CT'].includes(slot.team)) fail(`spawn_slot ${slot.id}: invalid team ${slot.team}`);
}

for (const utility of utilityDoc.utilities) {
    if (!['T', 'CT'].includes(utility.side)) fail(`utility ${utility.id}: invalid side ${utility.side}`);
    if (!['smoke', 'flash', 'fire', 'he'].includes(utility.type)) fail(`utility ${utility.id}: invalid type ${utility.type}`);
    if (!utility.origin || !zoneIds.has(utility.origin.zone_id)) {
        fail(`utility ${utility.id}: unknown origin zone`);
    }
    if (utility.origin?.spawn_slot && !spawnIds.has(utility.origin.spawn_slot)) {
        fail(`utility ${utility.id}: unknown origin spawn slot ${utility.origin.spawn_slot}`);
    }
    if (!Array.isArray(utility.target?.zone_ids) || utility.target.zone_ids.length === 0) {
        fail(`utility ${utility.id}: target.zone_ids must not be empty`);
    } else {
        for (const zoneId of utility.target.zone_ids) {
            if (!zoneIds.has(zoneId)) fail(`utility ${utility.id}: unknown target zone ${zoneId}`);
        }
    }
    if (!Array.isArray(utility.used_by)) fail(`utility ${utility.id}: used_by must be an array`);
    for (const tacticId of utility.used_by || []) {
        if (!tacticIds.has(tacticId)) fail(`utility ${utility.id}: used_by unknown tactic ${tacticId}`);
    }
    if (!utility.confidence) fail(`utility ${utility.id}: missing confidence`);
    for (const sourceId of utility.source_refs || []) {
        if (!sourceIds.has(sourceId)) fail(`utility ${utility.id}: unknown source ${sourceId}`);
    }
}

const utilityById = new Map(utilityDoc.utilities.map((item) => [item.id, item]));
for (const tactic of tacticsDoc.tactics) {
    if (!['T', 'CT'].includes(tactic.side)) fail(`tactic ${tactic.id}: invalid side ${tactic.side}`);
    for (const zoneId of tactic.required_zone_presence || []) {
        if (!zoneIds.has(zoneId)) fail(`tactic ${tactic.id}: unknown required zone ${zoneId}`);
    }
    for (const slotId of tactic.required_spawn_slots || []) {
        if (!spawnIds.has(slotId)) fail(`tactic ${tactic.id}: unknown required spawn slot ${slotId}`);
    }
    const refs = [...(tactic.required_utility || []), ...(tactic.optional_utility || [])];
    for (const utilityId of refs) {
        const utility = utilityById.get(utilityId);
        if (!utility) {
            fail(`tactic ${tactic.id}: unknown utility ${utilityId}`);
            continue;
        }
        if (utility.side !== tactic.side) {
            fail(`tactic ${tactic.id}: utility ${utilityId} has side ${utility.side}, expected ${tactic.side}`);
        }
        if (!utility.used_by.includes(tactic.id)) {
            fail(`utility ${utilityId}: used_by does not include ${tactic.id}`);
        }
    }
    for (const sourceId of tactic.source_refs || []) {
        if (!sourceIds.has(sourceId)) fail(`tactic ${tactic.id}: unknown source ${sourceId}`);
    }
    for (const step of tactic.steps || []) {
        if (step.zone_id && !zoneIds.has(step.zone_id)) fail(`tactic ${tactic.id}: step ${step.order} unknown zone ${step.zone_id}`);
        if (step.utility_id) {
            if (!utilityIds.has(step.utility_id)) fail(`tactic ${tactic.id}: step ${step.order} unknown utility ${step.utility_id}`);
            if (utilityById.get(step.utility_id)?.side !== tactic.side) {
                fail(`tactic ${tactic.id}: step ${step.order} utility side mismatch`);
            }
        }
    }
}

// Every utility used by a tactic should be declared by that tactic either as
// required or optional. This catches typos in either direction.
for (const utility of utilityDoc.utilities) {
    for (const tacticId of utility.used_by) {
        const tactic = tacticsDoc.tactics.find((item) => item.id === tacticId);
        if (!tactic) continue;
        const declared = [...(tactic.required_utility || []), ...(tactic.optional_utility || [])];
        if (!declared.includes(utility.id)) fail(`utility ${utility.id}: ${tacticId} does not declare it in required/optional utility`);
    }
}

if (errors.length) {
    console.error(`Dust2 knowledge validation failed (${errors.length} error(s)):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
}

console.log('Dust2 knowledge OK');
console.log(`  zones: ${zoneIds.size}`);
console.log(`  spawn slots: ${spawnIds.size}`);
console.log(`  utilities: ${utilityIds.size}`);
console.log(`  tactics: ${tacticIds.size}`);
console.log(`  sources: ${sourceIds.size}`);
