'use strict';

/**
 * A small but realistic parser payload (schema demo-parse-1.0.0).
 *
 * It mirrors the shape parser/parse_demo.py emits for a real CS2 demo, so the
 * normalizer, the HTTP layer and the AI facts builder can be tested without a
 * 60 MB demo or a Python installation.
 */

const TARGET = '76561198000000001';
const MATE = '76561198000000002';
const ENEMY_A = '76561198000000003';
const ENEMY_B = '76561198000000004';

function samples(roundNum, startTick, count) {
    const list = [];
    for (let index = 0; index < count; index += 1) {
        list.push({
            tick: startTick + index * 32,
            round_num: roundNum,
            x: -900 + index * 12,
            y: -600 + index * 4,
            z: -160,
            yaw: -90 + index,
            pitch: 0,
            velocity: null,
            velocity_x: null,
            velocity_y: null,
            health: index < count - 2 ? 100 : 25,
            armor: 100,
            active_weapon: index < 10 ? 'ak47' : 'flashbang',
            is_reloading: index === 12,
            is_jumping: index === 20,
            is_crouched: false,
            is_scoped: false,
            flashbangs: index < 15 ? 2 : 1,
            smoke_grenades: index < 5 ? 1 : 0,
            he_grenades: 0,
            fire_grenades: 0,
            equipment_value: 4200,
            money: 800
        });
    }
    return list;
}

function build({ sha256 = 'a'.repeat(64), sizeBytes = 1234, fileName = 'fixture.dem' } = {}) {
    return {
        schema_version: 'demo-parse-1.0.0',
        parser: { name: 'awpy', version: '3.1.1', python: '3.13.5', elapsed_ms: 2100 },
        demo: { file_name: fileName, size_bytes: sizeBytes, sha256 },
        header: {
            map_name: 'de_mirage',
            server_name: 'fixture server',
            demo_version_name: 'valve_demo_2',
            playback_time: '640.5',
            playback_ticks: '40992'
        },
        tick_rate: 64,
        rounds: [
            {
                round_num: 1, start_tick: 65, freeze_end_tick: 960, end_tick: 3000,
                official_end_tick: 3200, winner_side: 'terrorist', reason_name: 'target_bombed',
                is_knife_round: false
            },
            {
                round_num: 2, start_tick: 3200, freeze_end_tick: 4100, end_tick: 6400,
                official_end_tick: 6600, winner_side: 'counter-terrorist', reason_name: 'bomb_defused',
                is_knife_round: false
            }
        ],
        players: [
            { steamid: TARGET, name: 'Fixture Target', side: 'terrorist', team_clan_name: 'Fixture' },
            { steamid: MATE, name: 'Fixture Mate', side: 'terrorist', team_clan_name: 'Fixture' },
            { steamid: ENEMY_A, name: 'Fixture Enemy A', side: 'counter-terrorist', team_clan_name: 'Rivals' },
            { steamid: ENEMY_B, name: 'Fixture Enemy B', side: 'counter-terrorist', team_clan_name: 'Rivals' }
        ],
        stats: [
            {
                steamid: TARGET, name: 'Fixture Target', rounds_played: 2, kills: 2, deaths: 1, assists: 0,
                flash_assists: 0, headshot_kills: 1, headshot_pct: 50, opening_kills: 1, opening_deaths: 1,
                traded_deaths: 0, multikill_2k: 0, multikill_3k: 0, multikill_4k: 0, multikill_5k: 0,
                kast: 80, adr: 90.5, clutches_played: 1, clutches_won: 1, clutch_1v1: 1, clutch_1v2: 0,
                clutch_1v3: 0, clutch_1v4: 0, clutch_1v5: 0, utility_damage: 30, flashes_thrown: 2,
                enemies_flashed: 1, flash_duration_dealt: 3.2
            },
            {
                steamid: MATE, name: 'Fixture Mate', rounds_played: 2, kills: 1, deaths: 1, assists: 0,
                flash_assists: 0, headshot_kills: 0, headshot_pct: 0, opening_kills: 0, opening_deaths: 0,
                traded_deaths: 0, multikill_2k: 0, multikill_3k: 0, multikill_4k: 0, multikill_5k: 0,
                kast: 60, adr: 40, clutches_played: 0, clutches_won: 0, clutch_1v1: 0, clutch_1v2: 0,
                clutch_1v3: 0, clutch_1v4: 0, clutch_1v5: 0, utility_damage: 0, flashes_thrown: 1,
                enemies_flashed: 0, flash_duration_dealt: 0
            },
            {
                steamid: ENEMY_A, name: 'Fixture Enemy A', rounds_played: 2, kills: 1, deaths: 1, assists: 0,
                flash_assists: 0, headshot_kills: 0, headshot_pct: 0, opening_kills: 1, opening_deaths: 0,
                traded_deaths: 0, multikill_2k: 0, multikill_3k: 0, multikill_4k: 0, multikill_5k: 0,
                kast: 70, adr: 70, clutches_played: 0, clutches_won: 0, clutch_1v1: 0, clutch_1v2: 0,
                clutch_1v3: 0, clutch_1v4: 0, clutch_1v5: 0, utility_damage: 0, flashes_thrown: 1,
                enemies_flashed: 1, flash_duration_dealt: 0.8
            }
        ],
        target_player_id: TARGET,
        kills: [
            {
                event_id: 'kill_0001', tick: 1000, round_num: 1,
                attacker_steamid: TARGET, attacker_name: 'Fixture Target', attacker_side: 'terrorist',
                attacker_x: -880, attacker_y: -590,
                victim_steamid: ENEMY_B, victim_name: 'Fixture Enemy B', victim_side: 'counter-terrorist',
                victim_x: -1200, victim_y: -200, assister_steamid: null,
                weapon: 'ak47', headshot: true, penetrated: false, noscope: false, thrusmoke: false,
                is_trade: false, victim_traded: true, hitgroup_name: 'head'
            },
            {
                event_id: 'kill_0002', tick: 1500, round_num: 1,
                attacker_steamid: MATE, attacker_name: 'Fixture Mate', attacker_side: 'terrorist',
                attacker_x: -700, attacker_y: -500,
                victim_steamid: ENEMY_A, victim_name: 'Fixture Enemy A', victim_side: 'counter-terrorist',
                victim_x: -800, victim_y: -700, assister_steamid: null,
                weapon: 'glock', headshot: false, penetrated: false, noscope: false, thrusmoke: false,
                is_trade: false, victim_traded: false, hitgroup_name: 'chest'
            },
            {
                event_id: 'kill_0003', tick: 3300, round_num: 2,
                attacker_steamid: ENEMY_A, attacker_name: 'Fixture Enemy A', attacker_side: 'counter-terrorist',
                attacker_x: -300, attacker_y: -900,
                victim_steamid: TARGET, victim_name: 'Fixture Target', victim_side: 'terrorist',
                victim_x: -320, victim_y: -950, assister_steamid: null,
                weapon: 'm4a1', headshot: false, penetrated: false, noscope: false, thrusmoke: false,
                is_trade: false, victim_traded: false, hitgroup_name: 'stomach'
            },
            {
                event_id: 'kill_0004', tick: 5000, round_num: 2,
                attacker_steamid: TARGET, attacker_name: 'Fixture Target', attacker_side: 'terrorist',
                attacker_x: -600, attacker_y: -800,
                victim_steamid: ENEMY_B, victim_name: 'Fixture Enemy B', victim_side: 'counter-terrorist',
                victim_x: -700, victim_y: -900, assister_steamid: null,
                weapon: 'ak47', headshot: false, penetrated: false, noscope: false, thrusmoke: false,
                is_trade: false, victim_traded: false, hitgroup_name: 'chest'
            }
        ],
        damages: [
            {
                event_id: 'hurt_0001', tick: 980, round_num: 1,
                attacker_steamid: TARGET, victim_steamid: ENEMY_B, weapon: 'ak47',
                dmg_health: 100, hitgroup_name: 'head'
            },
            {
                event_id: 'hurt_0002', tick: 1300, round_num: 1,
                attacker_steamid: TARGET, victim_steamid: ENEMY_A, weapon: 'hegrenade',
                dmg_health: 30, hitgroup_name: 'generic'
            },
            {
                event_id: 'hurt_0003', tick: 3950, round_num: 2,
                attacker_steamid: TARGET, victim_steamid: ENEMY_A, weapon: 'ak47',
                dmg_health: 51, hitgroup_name: 'chest'
            }
        ],
        blinds: [
            {
                event_id: 'blind_0001', tick: 900, round_num: 1,
                attacker_steamid: TARGET, attacker_name: 'Fixture Target', attacker_side: 'terrorist',
                victim_steamid: TARGET, victim_name: 'Fixture Target', victim_side: 'terrorist',
                duration: 1.5
            },
            {
                event_id: 'blind_0002', tick: 950, round_num: 1,
                attacker_steamid: TARGET, attacker_name: 'Fixture Target', attacker_side: 'terrorist',
                victim_steamid: MATE, victim_name: 'Fixture Mate', victim_side: 'terrorist',
                duration: 2.0
            },
            {
                event_id: 'blind_0003', tick: 3900, round_num: 2,
                attacker_steamid: ENEMY_A, attacker_name: 'Fixture Enemy A', attacker_side: 'counter-terrorist',
                victim_steamid: TARGET, victim_name: 'Fixture Target', victim_side: 'terrorist',
                duration: 0.8
            }
        ],
        bomb: [
            {
                event_id: 'bomb_0001', tick: 2600, round_num: 1, event: 'finish_plant',
                steamid: MATE, bombsite: 'A', x: -1200, y: -230
            }
        ],
        grenades: [
            {
                event_id: 'grenade_0001', tick: 800, round_num: 1, type: 'flashbang',
                thrower_steamid: TARGET,
                points: [[-900, -600, -160], [-1000, -700, -150], [-1100, -800, -140]],
                point_ticks: [800, 810, 820]
            },
            {
                event_id: 'grenade_0002', tick: 3600, round_num: 2, type: 'smoke',
                thrower_steamid: null,
                points: [[-500, -900, -160], [-600, -1000, -150]],
                point_ticks: [3600, 3610]
            }
        ],
        smokes: [
            {
                event_id: 'smoke_0001', kind: 'smoke', start_tick: 3600, end_tick: 5200, round_num: 2,
                thrower_steamid: null, thrower_side: null, type: null, x: -600, y: -1000, z: -150
            }
        ],
        fires: [],
        round_economy: [
            { round_num: 1, side: 'counter-terrorist', equipment_value: 3800, buy_type: 'eco', n_players: 2 },
            { round_num: 1, side: 'terrorist', equipment_value: 9400, buy_type: 'full', n_players: 2 },
            { round_num: 2, side: 'counter-terrorist', equipment_value: 12000, buy_type: 'full', n_players: 2 },
            { round_num: 2, side: 'terrorist', equipment_value: 2100, buy_type: 'eco', n_players: 2 }
        ],
        target_samples: [...samples(1, 1000, 30), ...samples(2, 3300, 30)],
        target_death_snapshots: [
            {
                event_id: 'death_0001', tick: 3300, round_num: 2,
                x: -320, y: -950, z: -160, yaw: -45, health: 100, armor: 100,
                active_weapon: 'flashbang', is_reloading: true,
                flashbangs: 1, smoke_grenades: 1, he_grenades: 0, fire_grenades: 0,
                inventory: 'ak47,flashbang,smokegrenade,knife', is_scoped: false, equipment_value: 4200
            }
        ],
        truncated: [],
        warnings: []
    };
}

module.exports = { build, TARGET, MATE, ENEMY_A, ENEMY_B };
