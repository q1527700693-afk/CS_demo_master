'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractWeaponImpact } = require('../src/services/weaponImpact');

function kill(event_id, round_num, tick, attacker_steamid, attacker_name, attacker_side, weapon, victim_steamid, headshot = false) {
    return {
        event_id,
        round_num,
        tick,
        attacker_steamid,
        attacker_name,
        attacker_side,
        weapon,
        victim_steamid,
        victim_name: victim_steamid,
        victim_side: attacker_side === 'terrorist' ? 'counter-terrorist' : 'terrorist',
        headshot
    };
}

function payload() {
    return {
        header: { map_name: 'de_dust2' },
        demo: { sha256: 'a'.repeat(64) },
        players: [
            { steamid: '1', name: 'T1', side: 'terrorist', team_clan_name: 'TEAM T' },
            { steamid: '2', name: 'T2', side: 'terrorist', team_clan_name: 'TEAM T' },
            { steamid: '3', name: 'T3', side: 'terrorist', team_clan_name: 'TEAM T' },
            { steamid: '4', name: 'CT1', side: 'counter-terrorist', team_clan_name: 'TEAM CT' },
            { steamid: '5', name: 'CT2', side: 'counter-terrorist', team_clan_name: 'TEAM CT' }
        ],
        round_economy: [
            { round_num: 1, side: 'terrorist', buy_type: 'eco', equipment_value: 2500, n_players: 5 },
            { round_num: 1, side: 'counter-terrorist', buy_type: 'full', equipment_value: 24000, n_players: 5 },
            { round_num: 2, side: 'terrorist', buy_type: 'force', equipment_value: 12000, n_players: 5 },
            { round_num: 2, side: 'counter-terrorist', buy_type: 'full', equipment_value: 25000, n_players: 5 }
        ],
        kills: [
            kill('kill_0001', 1, 100, '1', 'T1', 'terrorist', 'revolver', '4'),
            kill('kill_0002', 1, 200, '1', 'T1', 'terrorist', 'revolver', '5'),
            kill('kill_0003', 1, 300, '2', 'T2', 'terrorist', 'ak47', '4'),
            kill('kill_0004', 2, 500, '3', 'T3', 'terrorist', 'deagle', '4', true),
            kill('kill_0005', 2, 510, '3', 'T3', 'terrorist', 'deagle', '5', true)
        ]
    };
}

test('highlights low-cost eco first blood and multi-kill weapons', () => {
    const result = extractWeaponImpact(payload());
    const r8 = result.highlights.find((item) => item.weapon === 'revolver' && item.player_name === 'T1');
    const deagle = result.highlights.find((item) => item.weapon === 'deagle' && item.player_name === 'T3');
    assert.ok(r8);
    assert.equal(r8.kills, 2);
    assert.equal(r8.first_bloods, 1);
    assert.equal(r8.economy_kills, 2);
    assert.ok(deagle);
    assert.equal(deagle.kills, 2);
    assert.match(deagle.reason, /Desert Eagle|冷门|经济|force/);
});

test('does not turn every ordinary rifle kill into a headline', () => {
    const result = extractWeaponImpact(payload());
    assert.equal(result.highlights.some((item) => item.weapon === 'ak47'), false);
    const t2 = result.player_profiles.find((item) => item.name === 'T2');
    assert.ok(t2);
    assert.equal(t2.top_weapons[0].weapon, 'ak47');
});

test('keeps weapon evidence IDs available for AI citation', () => {
    const result = extractWeaponImpact(payload());
    const highlighted = result.highlights.find((item) => item.weapon === 'revolver');
    assert.ok(highlighted.evidence_ids.includes('kill_0001'));
    assert.ok(highlighted.evidence_ids.includes('kill_0002'));
});
