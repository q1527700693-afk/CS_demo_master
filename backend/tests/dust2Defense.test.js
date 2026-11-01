'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const knowledge = require('../src/services/dust2Knowledge');
const defense = require('../src/services/dust2Defense');

const T = ['76561198000000001', '76561198000000002', '76561198000000003', '76561198000000004', '76561198000000005'];
const CT = ['76561198000000011', '76561198000000012', '76561198000000013', '76561198000000014', '76561198000000015'];

function center(zoneId) {
    return knowledge.load().zoneById.get(zoneId).center_world;
}

function sample(steamid, side, round, tick, zoneId, name) {
    const [x, y] = center(zoneId);
    return {
        steamid, side, round_num: round, tick, x, y, z: 0, name,
        flashbangs: 1, smoke_grenades: 1, he_grenades: 0, fire_grenades: 0
    };
}

function makePayload() {
    const players = [
        ...T.map((steamid, index) => ({ steamid, name: `t${index + 1}`, side: 'terrorist', team_clan_name: 'TEAM T' })),
        ...CT.map((steamid, index) => ({ steamid, name: `ct${index + 1}`, side: 'counter-terrorist', team_clan_name: 'TEAM CT' }))
    ];
    const samples = [];
    const ctZones = ['a_site', 'a_site', 'b_site', 'mid_doors', 'ct_spawn'];
    const tZones = ['t_spawn', 't_spawn', 't_spawn', 't_spawn', 't_spawn'];
    for (let round = 1; round <= 3; round += 1) {
        const base = (round - 1) * 5000;
        for (let index = 0; index < CT.length; index += 1) {
            samples.push(sample(CT[index], 'counter-terrorist', round, base + 100, ctZones[index], `ct${index + 1}`));
        }
        for (let index = 0; index < T.length; index += 1) {
            samples.push(sample(T[index], 'terrorist', round, base + 100, tZones[index], `t${index + 1}`));
        }
    }
    const rounds = [
        { round_num: 1, start_tick: 0, freeze_end_tick: 0, end_tick: 5000, winner_side: 'terrorist', reason_name: 'target_bombed' },
        { round_num: 2, start_tick: 5000, freeze_end_tick: 5000, end_tick: 10000, winner_side: 'counter-terrorist', reason_name: 'bomb_defused' },
        { round_num: 3, start_tick: 10000, freeze_end_tick: 10000, end_tick: 15000, winner_side: 'terrorist', reason_name: 'target_bombed' }
    ];
    return {
        header: { map_name: 'de_dust2' },
        tick_rate: 64,
        players,
        rounds,
        all_player_samples: samples,
        kills: [],
        smokes: [],
        fires: [],
        grenades: [],
        blinds: [],
        bomb: [
            { round_num: 1, tick: 4000, event: 'finish_plant', bombsite: 'A', steamid: T[0] },
            { round_num: 2, tick: 9000, event: 'finish_plant', bombsite: 'B', steamid: T[0] }
        ],
        round_economy: [
            { round_num: 3, side: 'terrorist', buy_type: 'full', equipment_value: 24000, n_players: 5 },
            { round_num: 3, side: 'counter-terrorist', buy_type: 'force', equipment_value: 11000, n_players: 5 }
        ]
    };
}

test('builds an explainable CT defense profile from early rounds', () => {
    const payload = makePayload();
    const profile = defense.buildCtDefenseProfile(payload, { teamClanName: 'TEAM CT' }, { scoutRounds: 6, throughRound: 3 });
    assert.equal(profile.status, 'ok');
    assert.equal(profile.rounds_observed, 2);
    assert.equal(profile.weaker_site, undefined);
    assert.equal(profile.weaknesses.weaker_site, 'A');
    assert.equal(profile.initial.A, 2);
    assert.equal(profile.initial.B, 1);
    assert.ok(profile.rotation);
    assert.ok(profile.signals.length > 0);
});

test('recommends a site for an upcoming T round without using future rounds', () => {
    const payload = makePayload();
    const result = defense.recommendSite(payload, { teamClanName: 'TEAM T' }, 3, { scoutRounds: 6 });
    assert.equal(result.status, 'ok');
    assert.equal(result.round_num, 3);
    assert.ok(['A', 'B'].includes(result.primary_site));
    assert.ok(result.site_scores.A > 0 && result.site_scores.B > 0);
    assert.ok(result.recommended_tactic_id.startsWith('dust2_t_'));
    assert.equal(result.economy.own.buy_type, 'full');
    assert.equal(result.economy.own.buy_label, '长枪局');
    assert.ok(result.spawn_labels.includes('A 大第一身位'));
    assert.ok(result.risks.every((risk) => !risk.includes('对手可能已经意识到')));
    assert.equal(result.profile.rounds_observed, 2);
});

test('builds a match summary with per-round site recommendations', () => {
    const payload = makePayload();
    const summary = defense.buildMatchSummary(payload, { teamClanName: 'TEAM T' }, { maxRounds: 10 });
    assert.equal(summary.status, 'ok');
    assert.ok(summary.scout_defense_profile);
    assert.ok(summary.round_recommendations.length >= 1);
    assert.ok(summary.round_recommendations[0].review);
    assert.match(summary.limitations.join(' '), /win probability/);
});
