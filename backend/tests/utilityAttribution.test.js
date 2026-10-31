'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { attributeUtility } = require('../src/services/utilityAttribution');

function basePayload() {
    return {
        all_player_samples: [{
            steamid: '76561198000000001',
            name: 'thrower',
            side: 'terrorist',
            round_num: 1,
            tick: 100,
            x: 100,
            y: 100
        }],
        grenades: [],
        smokes: [],
        fires: []
    };
}

test('attributes a thrower from the first grenade trajectory point', () => {
    const payload = basePayload();
    payload.grenades.push({
        event_id: 'grenade_0001',
        round_num: 1,
        tick: 99,
        type: 'smoke',
        entity_id: 7,
        entity_serial: 12,
        points: [[104, 102, 0]],
        point_ticks: [100]
    });
    payload.smokes.push({
        event_id: 'smoke_0001',
        round_num: 1,
        start_tick: 140,
        entity_id: 7,
        entity_serial: 12,
        x: 300,
        y: 300
    });
    const attributed = attributeUtility(payload);
    assert.equal(attributed.get('grenade_0001').thrower_steamid, '76561198000000001');
    assert.equal(attributed.get('smoke_0001').thrower_side, 'T');
});

test('falls back to the nearest trajectory endpoint for fire entities', () => {
    const payload = basePayload();
    payload.grenades.push({
        event_id: 'grenade_0002',
        round_num: 1,
        tick: 90,
        type: 'molotov',
        points: [[100, 100, 0], [500, 500, 0]],
        point_ticks: [90, 100]
    });
    payload.fires.push({
        event_id: 'fire_0001',
        round_num: 1,
        start_tick: 100,
        x: 501,
        y: 500
    });
    const attributed = attributeUtility(payload);
    assert.equal(attributed.get('fire_0001').thrower_steamid, '76561198000000001');
    assert.match(attributed.get('fire_0001').source, /endpoint/);
});
