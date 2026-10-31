'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const knowledge = require('../src/services/dust2Knowledge');
const dust2 = require('../src/services/dust2Tactics');

function pos(zoneId, offset = 0) {
    const zone = knowledge.load().zoneById.get(zoneId);
    assert.ok(zone, `missing zone ${zoneId}`);
    return [zone.center_world[0] + offset, zone.center_world[1] + offset];
}

function sample(steamid, name, side, zoneId, tick = 200, offset = 0) {
    const [x, y] = pos(zoneId, offset);
    return { steamid, name, side, round_num: 1, tick, x, y, z: 0 };
}

function basePayload({ tZones = {}, ctZones = {}, utilities = [], blinds = [], kills = [] } = {}) {
    const tIds = {
        t1: '76561198000000001',
        t2: '76561198000000002',
        t3: '76561198000000003',
        t4: '76561198000000004',
        t5: '76561198000000005'
    };
    const ctIds = {
        ct1: '76561198000000011',
        ct2: '76561198000000012',
        ct3: '76561198000000013',
        ct4: '76561198000000014',
        ct5: '76561198000000015'
    };
    const players = [
        ...Object.entries(tIds).map(([name, steamid]) => ({ steamid, name, side: 'terrorist', team_clan_name: 'T' })),
        ...Object.entries(ctIds).map(([name, steamid]) => ({ steamid, name, side: 'counter-terrorist', team_clan_name: 'CT' }))
    ];
    const samples = [];
    for (const [name, steamid] of Object.entries(tIds)) {
        samples.push(sample(steamid, name, 'terrorist', tZones[name] || 't_spawn'));
    }
    for (const [name, steamid] of Object.entries(ctIds)) {
        samples.push(sample(steamid, name, 'counter-terrorist', ctZones[name] || 'ct_spawn'));
    }
    return {
        header: { map_name: 'de_dust2' },
        tick_rate: 64,
        rounds: [{ round_num: 1, start_tick: 0, end_tick: 10000 }],
        players,
        all_player_samples: samples,
        kills,
        smokes: utilities.filter((item) => item.collection === 'smokes'),
        fires: utilities.filter((item) => item.collection === 'fires'),
        grenades: utilities.filter((item) => item.collection === 'grenades'),
        blinds
    };
}

test('classifies a Dust2 A-long rush from early player positions', () => {
    const payload = basePayload({
        tZones: { t1: 'a_long', t2: 'a_long', t3: 'a_long_pit', t4: 'mid', t5: 't_spawn' },
        ctZones: { ct1: 'a_long', ct2: 'a_site', ct3: 'b_site', ct4: 'mid', ct5: 'ct_spawn' }
    });
    const result = dust2.classifyTactic(payload, 1, 'T');
    assert.equal(result.status, 'classified');
    const primary = result.candidates.find((item) => item.tactic_id === 'dust2_t_a_long_rush');
    assert.ok(primary, 'expected A-long rush candidate');
    assert.equal(result.facts.early_zone_counts.a_long_approach, 3);
});

test('classifies a Dust2 B-tunnel rush and records observed utility', () => {
    const payload = basePayload({
        tZones: { t1: 'b_tunnel', t2: 'b_tunnel', t3: 'lower_tunnels', t4: 't_spawn', t5: 't_spawn' },
        ctZones: { ct1: 'a_long', ct2: 'a_site', ct3: 'b_site', ct4: 'mid', ct5: 'ct_spawn' },
        utilities: [{
            collection: 'smokes',
            event_id: 'smoke_0001',
            round_num: 1,
            start_tick: 100,
            thrower_steamid: '76561198000000001',
            thrower_side: 'terrorist',
            x: pos('b_tunnel')[0],
            y: pos('b_tunnel')[1]
        }]
    });
    const result = dust2.classifyTactic(payload, 1, 'T');
    assert.ok(result.candidates.some((item) => item.tactic_id === 'dust2_t_b_tunnel_rush'));
    assert.ok(result.facts.observed_utilities.some((item) => item.utility_id === 'dust2_util_t_b_tunnel_smoke'));
});

test('classifies a Dust2 A-short split when short and long/mid pressure coexist', () => {
    const payload = basePayload({
        tZones: { t1: 'a_short', t2: 'a_short_stairs', t3: 'a_long', t4: 'mid', t5: 't_spawn' },
        ctZones: { ct1: 'a_long', ct2: 'a_site', ct3: 'b_site', ct4: 'mid', ct5: 'ct_spawn' }
    });
    const result = dust2.classifyTactic(payload, 1, 'T');
    assert.ok(result.candidates.some((item) => item.tactic_id === 'dust2_t_a_short_split'));
});

test('classifies CT A-long pressure only with the push flash and early contact area', () => {
    const payload = basePayload({
        tZones: { t1: 'a_long', t2: 't_spawn', t3: 't_spawn', t4: 't_spawn', t5: 't_spawn' },
        ctZones: { ct1: 'a_long', ct2: 'a_site', ct3: 'b_site', ct4: 'mid', ct5: 'ct_spawn' },
        utilities: [{
            collection: 'grenades',
            event_id: 'grenade_0001',
            round_num: 1,
            tick: 100,
            thrower_steamid: '76561198000000011',
            thrower_side: 'counter-terrorist',
            type: 'Flashbang',
            points: [pos('ct_spawn'), pos('a_long')]
        }],
        blinds: [{
            event_id: 'blind_0001',
            round_num: 1,
            tick: 110,
            attacker_steamid: '76561198000000011',
            attacker_side: 'counter-terrorist',
            victim_steamid: '76561198000000001',
            victim_side: 'terrorist',
            duration: 1.4
        }]
    });
    const result = dust2.classifyTactic(payload, 1, 'CT');
    assert.ok(result.candidates.some((item) => item.tactic_id === 'dust2_ct_a_long_pressure'));
    const flash = result.facts.observed_utilities.find((item) => item.utility_id === 'dust2_util_ct_a_long_push_flash');
    assert.ok(flash);
    assert.equal(flash.effects.enemy_blinds, 1);
});

test('evaluates template checks without claiming plan quality', () => {
    const payload = basePayload({
        tZones: { t1: 'a_long', t2: 'a_long', t3: 'a_long', t4: 't_spawn', t5: 't_spawn' },
        ctZones: { ct1: 'a_long', ct2: 'a_site', ct3: 'b_site', ct4: 'mid', ct5: 'ct_spawn' }
    });
    const result = dust2.evaluateTactic(payload, 1, 'T', 'dust2_t_a_long_rush');
    assert.equal(result.tactic_id, 'dust2_t_a_long_rush');
    assert.ok(Array.isArray(result.checks));
    assert.match(result.note, /does not yet judge/);
});

test('rejects other maps instead of pretending the Dust2 rules apply', () => {
    const payload = basePayload();
    payload.header.map_name = 'de_mirage';
    const result = dust2.classifyTactic(payload, 1, 'T');
    assert.equal(result.status, 'unsupported');
});

test('summarizes primary tactics across rounds', () => {
    const payload = basePayload({
        tZones: { t1: 'a_long', t2: 'a_long', t3: 'a_long', t4: 'mid', t5: 't_spawn' },
        ctZones: { ct1: 'a_long', ct2: 'a_site', ct3: 'b_site', ct4: 'mid', ct5: 'ct_spawn' }
    });
    const result = dust2.analyzeTeamMatch(payload, 'T', { maxRounds: 10 });
    assert.equal(result.status, 'ok');
    assert.equal(result.summary.rounds_analyzed, 1);
    assert.equal(result.summary.primary_tactics.dust2_t_a_long_rush, 1);
});

test('a demo team roster stays selected across halftime', () => {
    const payload = basePayload({
        tZones: { t1: 'a_long', t2: 'a_long', t3: 'a_long', t4: 't_spawn', t5: 't_spawn' },
        ctZones: { ct1: 'a_long', ct2: 'a_site', ct3: 'b_site', ct4: 'mid', ct5: 'ct_spawn' }
    });
    const roster = ['76561198000000001', '76561198000000002', '76561198000000003', '76561198000000004', '76561198000000005'];
    payload.rounds.push({ round_num: 2, start_tick: 10000, end_tick: 20000 });
    // The same roster has switched to CT in the second round.
    for (const steamid of roster) {
        const [x, y] = pos('ct_spawn');
        payload.all_player_samples.push({ steamid, name: steamid, side: 'counter-terrorist', round_num: 2, tick: 10100, x, y, z: 0 });
    }
    const result = dust2.analyzeTeamMatch(payload, roster, { maxRounds: 2 });
    assert.equal(result.status, 'ok');
    assert.equal(result.rounds.length, 2);
    assert.equal(result.rounds[0].team_side, 'T');
    assert.equal(result.rounds[1].team_side, 'CT');
    assert.equal(result.team.mode, 'roster');
    assert.deepEqual(result.team.steamids.sort(), [...roster].sort());
});


test('uses the planted bombsite to distinguish B pressure from a B rush', () => {
    const payload = basePayload({
        tZones: { t1: 'b_tunnel', t2: 'b_tunnel', t3: 'lower_tunnels', t4: 'mid', t5: 't_spawn' },
        ctZones: { ct1: 'a_long', ct2: 'a_site', ct3: 'b_site', ct4: 'mid', ct5: 'ct_spawn' }
    });
    payload.bomb = [{ round_num: 1, tick: 5000, event: 'finish_plant', bombsite: 'A', steamid: '76561198000000001' }];
    const result = dust2.classifyTactic(payload, 1, 'T');
    assert.equal(result.facts.planted_site, 'A');
    assert.equal(result.candidates[0].tactic_id, 'dust2_t_mid_default_fake');
});
