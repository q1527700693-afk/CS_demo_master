'use strict';

/**
 * Turn the output of parser/parse_demo.py into the same report shapes the ZIP
 * pipeline already produces, so `/details`, the AI coach and the frontend keep
 * working without a second contract.
 *
 * The parser only extracts measured facts. Every judgement (which deaths are
 * worth reviewing, which rounds are key, what the AI may cite) is made here and
 * stays deterministic and testable.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const formal = require('./replaySchema');

const VERSION = 'demo-rules-1.0.0';
const PARSE_SCHEMA = 'demo-parse-1.0.0';
const SIDES = ['terrorist', 'counter-terrorist'];
const UTILITY_WEAPONS = new Set([
    'hegrenade', 'flashbang', 'smokegrenade', 'molotov', 'incgrenade', 'decoy'
]);
const MAX_FINDINGS = 400;
const MAX_SAMPLES_PER_ROUND = 4000;
const MAX_TRAJECTORY_ROUNDS = 64;

function sideLabel(side) {
    return side === 'counter-terrorist' ? 'CT' : side === 'terrorist' ? 'T' : side || 'unknown';
}

function round(value, digits = 2) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function ratio(numerator, denominator, digits = 3) {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
    return round(numerator / denominator, digits);
}

function sum(list, pick = (value) => value) {
    return list.reduce((total, item) => total + (Number(pick(item)) || 0), 0);
}

function number(value) {
    return Number.isFinite(value) ? value : null;
}

function assertParse(payload) {
    const problems = [];
    if (!payload || typeof payload !== 'object') throw new Error('Parser output must be an object');
    if (payload.schema_version !== PARSE_SCHEMA) problems.push(`schema_version must be ${PARSE_SCHEMA}`);
    for (const key of ['rounds', 'players', 'stats', 'kills', 'damages', 'blinds', 'bomb', 'grenades',
        'smokes', 'fires', 'round_economy', 'target_samples', 'target_death_snapshots']) {
        if (!Array.isArray(payload[key])) problems.push(`${key} must be an array`);
    }
    if (!payload.header || typeof payload.header !== 'object') problems.push('header is required');
    if (payload.rounds?.length > 200) problems.push('too many rounds');
    if (payload.kills?.length > 20000) problems.push('too many kills');
    if (payload.target_samples?.length > 200000) problems.push('too many samples');
    if (problems.length) throw new Error(`Invalid parser output: ${problems.slice(0, 4).join('; ')}`);
}

function matchIdentity(payload) {
    const sha = String(payload.demo?.sha256 || '');
    if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error('Invalid parser output: demo sha256 is required');
    return {
        match_id: `demo-${sha.slice(0, 12)}`,
        demo_sha256: sha,
        file_name: String(payload.demo?.file_name || 'match.dem').slice(0, 120),
        size_bytes: Number(payload.demo?.size_bytes) || 0
    };
}

/** Score each side by counting round winners; a concrete fact, not an estimate. */
function scoreboard(rounds) {
    const score = { terrorist: 0, 'counter-terrorist': 0 };
    for (const round of rounds) {
        if (score[round.winner_side] != null) score[round.winner_side] += 1;
    }
    return score;
}

function buyTypesByRound(roundEconomy) {
    const byRound = new Map();
    for (const row of roundEconomy) {
        if (!Number.isInteger(row.round_num) || !SIDES.includes(row.side)) continue;
        const entry = byRound.get(row.round_num) || {};
        entry[row.side === 'counter-terrorist' ? 'ct' : 't'] = {
            buy_type: row.buy_type ?? null,
            equipment_value: number(row.equipment_value),
            players: number(row.n_players)
        };
        byRound.set(row.round_num, entry);
    }
    return byRound;
}

function targetTeamSide(payload, targetId) {
    const player = (payload.players || []).find((item) => item.steamid === targetId);
    return player?.side ?? null;
}

/** Speed is derived from consecutive position samples when the demo omits velocity. */
function movementSummary(samples) {
    const byRound = new Map();
    let measured = 0, total = 0, peak = 0, jumping = 0, walking = 0, scoped = 0;
    for (const sample of samples) {
        if (sample.round_num == null) continue;
        const list = byRound.get(sample.round_num) || [];
        list.push(sample);
        byRound.set(sample.round_num, list);
        if (sample.is_jumping === true) jumping += 1;
        if (sample.is_crouched === true) walking += 1;
        if (sample.is_scoped === true) scoped += 1;
    }
    for (const list of byRound.values()) {
        list.sort((a, b) => a.tick - b.tick);
        for (let index = 1; index < list.length; index += 1) {
            const previous = list[index - 1], current = list[index];
            if (![previous.x, previous.y, current.x, current.y].every(Number.isFinite)) continue;
            const dt = (current.tick - previous.tick) / 64;
            if (!(dt > 0)) continue;
            let speed = Math.hypot(current.x - previous.x, current.y - previous.y) / dt;
            if (Number.isFinite(current.velocity_x) && Number.isFinite(current.velocity_y)) {
                speed = Math.hypot(current.velocity_x, current.velocity_y);
            }
            measured += 1;
            total += speed;
            peak = Math.max(peak, speed);
        }
    }
    return {
        status: measured > 20 ? 'observed' : 'insufficient_data',
        sampled_positions: samples.length,
        measured_intervals: measured,
        mean_horizontal_speed: measured ? round(total / measured) : null,
        max_horizontal_speed: measured ? round(peak) : null,
        jumping_samples: jumping,
        crouched_samples: walking,
        scoped_samples: scoped,
        interpretation: '由 0.5 秒采样位置推导的水平速度，仅描述移动，不作为急停或身法评分。'
    };
}

function deathFindings(payload, targetId) {
    const findings = [];
    const snapshots = payload.target_death_snapshots || [];
    const kills = payload.kills || [];
    for (const snapshot of snapshots) {
        const held = ['flashbangs', 'smoke_grenades', 'he_grenades', 'fire_grenades']
            .map((key) => Number(snapshot[key]) || 0);
        const utility = held.reduce((total, value) => total + value, 0);
        const base = {
            round_num: snapshot.round_num ?? null,
            tick: snapshot.tick ?? null,
            evidence_ids: [snapshot.event_id],
            classification: 'review_candidate'
        };
        if (snapshot.is_reloading === true) {
            findings.push({
                ...base,
                finding_id: `death_reloading:${snapshot.event_id}`,
                rule_id: 'death_reloading',
                rule_version: VERSION,
                observation: '死亡时武器处于换弹状态',
                review_prompt: '回看换弹前的剩余弹药、掩体与交火时机；换弹是否发生在敌人可能出现的位置。'
            });
        }
        if (UTILITY_WEAPONS.has(String(snapshot.active_weapon || '').replace(/^weapon_/, ''))) {
            findings.push({
                ...base,
                finding_id: `death_holding_utility:${snapshot.event_id}`,
                rule_id: 'death_holding_utility',
                rule_version: VERSION,
                observation: `死亡时手持道具（${snapshot.active_weapon}）`,
                review_prompt: '回看投掷前的掩护、队友位置与是否应该先出枪。'
            });
        }
        if (utility > 0) {
            findings.push({
                ...base,
                finding_id: `death_unused_utility:${snapshot.event_id}`,
                rule_id: 'death_unused_utility',
                rule_version: VERSION,
                observation: `死亡时仍携带 ${utility} 件道具`,
                review_prompt: '携带道具死亡本身不代表失误，需要结合回合阶段、经济与信息判断是否有使用机会。'
            });
        }
        const victimKills = kills.filter((kill) => kill.victim_steamid === targetId && kill.tick === snapshot.tick);
        for (const kill of victimKills) {
            if (kill.victim_traded === false) {
                findings.push({
                    ...base,
                    finding_id: `untraded_death:${kill.event_id}`,
                    rule_id: 'untraded_death',
                    rule_version: VERSION,
                    observation: `被 ${kill.attacker_name || '对手'} 击杀后未被换人（武器 ${kill.weapon || '未知'}）`,
                    review_prompt: '回看死亡位置是否可被队友补枪，或是否应该等队友到位再对枪。'
                });
            }
        }
    }
    return findings;
}

function flashFindings(payload, targetId) {
    const findings = [];
    for (const blind of payload.blinds || []) {
        if (!(Number(blind.duration) > 0)) continue;
        const base = {
            round_num: blind.round_num ?? null,
            tick: blind.tick ?? null,
            evidence_ids: [blind.event_id],
            classification: 'review_candidate'
        };
        if (blind.attacker_steamid === targetId && blind.victim_steamid === targetId) {
            findings.push({
                ...base,
                finding_id: `self_flash:${blind.event_id}`,
                rule_id: 'self_flash',
                rule_version: VERSION,
                observation: `自身被自己的闪光影响 ${round(blind.duration)} 秒`,
                review_prompt: '回看投掷角度、背闪时机与是否站在自己的闪线内。'
            });
        } else if (blind.attacker_steamid === targetId && blind.attacker_side === blind.victim_side) {
            findings.push({
                ...base,
                finding_id: `team_flash:${blind.event_id}`,
                rule_id: 'team_flash',
                rule_version: VERSION,
                observation: `队友 ${blind.victim_name || ''} 被闪光影响 ${round(blind.duration)} 秒`.trim(),
                review_prompt: '回看投掷前的沟通、队友站位与是否应该改为其他道具。'
            });
        }
    }
    return findings;
}

function openingFinding(payload, targetId) {
    const findings = [];
    const byRound = new Map();
    for (const kill of payload.kills || []) {
        if (!Number.isInteger(kill.round_num)) continue;
        if (!byRound.has(kill.round_num)) byRound.set(kill.round_num, kill);
    }
    for (const kill of byRound.values()) {
        if (kill.victim_steamid !== targetId) continue;
        if (kill.attacker_side && kill.victim_side && kill.attacker_side === kill.victim_side) continue;
        findings.push({
            finding_id: `opening_death:${kill.event_id}`,
            rule_id: 'opening_death',
            rule_version: VERSION,
            round_num: kill.round_num,
            tick: kill.tick,
            evidence_ids: [kill.event_id],
            classification: 'review_candidate',
            observation: `本回合首个击杀由对手 ${kill.attacker_name || ''} 完成，目标玩家阵亡`.trim(),
            review_prompt: '回看进点/架枪前的信息、队友距离与是否暴露了无法撤离的位置。'
        });
    }
    return findings;
}

function economyFindings(payload, rounds, targetSide, buys) {
    const findings = [];
    if (!targetSide) return findings;
    for (const round of rounds) {
        const buy = buys.get(round.round_num)?.[targetSide === 'counter-terrorist' ? 'ct' : 't'];
        if (!buy || !['eco', 'force'].includes(buy.buy_type)) continue;
        if (round.winner_side === targetSide) continue;
        findings.push({
            finding_id: `eco_loss:r${round.round_num}`,
            rule_id: 'eco_loss',
            rule_version: VERSION,
            round_num: round.round_num,
            tick: round.start_tick ?? null,
            evidence_ids: [],
            classification: 'review_candidate',
            observation: `经济局（${buy.buy_type}，装备价值 ${buy.equipment_value ?? '未知'}）失利`,
            review_prompt: '回看这一局的目标：拿分、下包、换人还是保枪，以及是否达成了可接受的结果。'
        });
    }
    return findings;
}

function targetStatLine(payload, targetId) {
    return (payload.stats || []).find((row) => row.steamid === targetId) || {};
}

function teammates(payload, targetSide, targetId) {
    return (payload.players || [])
        .filter((player) => player.steamid !== targetId && player.side === targetSide)
        .map((player) => ({ name: player.name, steamid: player.steamid }));
}

function buildModules({ payload, targetId, targetSide, stats, finds, samples, targetSamples, buys, rounds }) {
    const deaths = payload.target_death_snapshots || [];
    const reloading = finds.filter((finding) => finding.rule_id === 'death_reloading').length;
    const holdingUtility = finds.filter((finding) => finding.rule_id === 'death_holding_utility').length;
    const unusedUtility = finds.filter((finding) => finding.rule_id === 'death_unused_utility').length;
    const untraded = finds.filter((finding) => finding.rule_id === 'untraded_death').length;
    const selfFlashes = finds.filter((finding) => finding.rule_id === 'self_flash').length;
    const teamFlashes = finds.filter((finding) => finding.rule_id === 'team_flash').length;
    const targetKills = (payload.kills || []).filter((kill) => kill.attacker_steamid === targetId);
    const targetDeaths = (payload.kills || []).filter((kill) => kill.victim_steamid === targetId);
    const targetDamage = (payload.damages || []).filter((damage) => damage.attacker_steamid === targetId);
    const damageTotal = sum(targetDamage, (damage) => damage.dmg_health);
    const roundsPlayed = number(stats.rounds_played) ?? rounds.length;
    const sideBuys = rounds
        .map((round) => buys.get(round.round_num)?.[targetSide === 'counter-terrorist' ? 'ct' : 't'])
        .filter(Boolean);

    const modules = {
        basic_stats: {
            module_version: VERSION,
            status: 'completed',
            reason: null,
            sample_count: roundsPlayed,
            metrics: {
                rounds_played: roundsPlayed,
                kills: targetKills.length,
                deaths: targetDeaths.length,
                assists: number(stats.assists) ?? 0,
                kd_ratio: ratio(targetKills.length, Math.max(1, targetDeaths.length), 3),
                adr: number(stats.adr),
                kast: number(stats.kast),
                headshot_pct: number(stats.headshot_pct),
                headshot_kills: number(stats.headshot_kills) ?? 0,
                total_damage: round(damageTotal, 0),
                team: targetSide
            },
            evidence_ids: [...targetKills.slice(0, 8).map((kill) => kill.event_id),
                ...targetDeaths.slice(0, 8).map((kill) => kill.event_id)]
        },
        opening_duels: {
            module_version: VERSION,
            status: 'completed',
            reason: null,
            sample_count: (number(stats.opening_kills) ?? 0) + (number(stats.opening_deaths) ?? 0),
            metrics: {
                opening_kills: number(stats.opening_kills) ?? 0,
                opening_deaths: number(stats.opening_deaths) ?? 0,
                opening_win_rate: ratio(number(stats.opening_kills) ?? 0,
                    (number(stats.opening_kills) ?? 0) + (number(stats.opening_deaths) ?? 0), 3)
            },
            evidence_ids: finds.filter((finding) => finding.rule_id === 'opening_death')
                .slice(0, 8).map((finding) => finding.evidence_ids[0])
        },
        utility: {
            module_version: VERSION,
            status: payload.blinds?.length ? 'completed' : 'insufficient_data',
            reason: payload.blinds?.length ? null : 'Demo 中没有可归属的闪光事件',
            sample_count: number(stats.flashes_thrown) ?? 0,
            metrics: {
                flashes_thrown: number(stats.flashes_thrown) ?? 0,
                enemies_flashed: number(stats.enemies_flashed) ?? 0,
                flash_duration_dealt: number(stats.flash_duration_dealt),
                utility_damage: number(stats.utility_damage) ?? 0,
                self_flashes: selfFlashes,
                team_flashes: teamFlashes
            },
            evidence_ids: (payload.blinds || []).filter((blind) => blind.attacker_steamid === targetId)
                .slice(0, 8).map((blind) => blind.event_id)
        },
        death_context: {
            module_version: VERSION,
            status: deaths.length ? 'completed' : 'insufficient_data',
            reason: deaths.length ? null : '没有采集到目标玩家的死亡快照',
            sample_count: deaths.length,
            metrics: {
                deaths: targetDeaths.length,
                reloading_deaths: reloading,
                holding_utility_deaths: holdingUtility,
                unused_utility_deaths: unusedUtility,
                untraded_deaths: untraded
            },
            evidence_ids: deaths.slice(0, 8).map((snapshot) => snapshot.event_id)
        },
        economy: {
            module_version: VERSION,
            status: sideBuys.length ? 'completed' : 'insufficient_data',
            reason: sideBuys.length ? null : 'Demo 中没有目标阵营的经济数据',
            sample_count: sideBuys.length,
            metrics: {
                rounds_with_economy: sideBuys.length,
                average_equipment_value: sideBuys.length
                    ? round(sum(sideBuys, (buy) => buy.equipment_value) / sideBuys.length, 0) : null,
                buy_types: sideBuys.reduce((counts, buy) => {
                    const key = buy.buy_type || 'unknown';
                    counts[key] = (counts[key] || 0) + 1;
                    return counts;
                }, {})
            },
            evidence_ids: []
        },
        movement: {
            module_version: VERSION,
            status: samples.measured_intervals > 20 ? 'completed' : 'insufficient_data',
            reason: samples.measured_intervals > 20 ? null : '可用的位置采样不足',
            sample_count: targetSamples.length,
            metrics: {
                measured_intervals: samples.measured_intervals,
                mean_horizontal_speed: samples.mean_horizontal_speed,
                max_horizontal_speed: samples.max_horizontal_speed,
                jumping_samples: samples.jumping_samples,
                crouched_samples: samples.crouched_samples,
                scoped_samples: samples.scoped_samples
            },
            evidence_ids: []
        },
        clutch: number(stats.clutches_played) ? {
            module_version: VERSION,
            status: 'completed',
            reason: null,
            sample_count: number(stats.clutches_played) ?? 0,
            metrics: {
                clutches_played: number(stats.clutches_played) ?? 0,
                clutches_won: number(stats.clutches_won) ?? 0
            },
            evidence_ids: []
        } : null
    };
    // A demo without clutches is not degraded data: drop the module instead of
    // turning every ordinary match into a "partial" report.
    for (const [name, module] of Object.entries(modules)) {
        if (!module) delete modules[name];
    }
    return modules;
}

function roundSummaries(payload, targetId, buys) {
    const byRound = new Map();
    for (const round of payload.rounds || []) byRound.set(round.round_num, {
        round_num: round.round_num,
        start_tick: round.start_tick ?? null,
        end_tick: round.end_tick ?? null,
        winner_side: round.winner_side ?? null,
        reason: round.reason_name ?? null,
        is_knife_round: round.is_knife_round === true,
        buy: buys.get(round.round_num) || {},
        target: { kills: 0, deaths: 0, damage: 0, equipment_value: null, buy_type: null }
    });
    for (const kill of payload.kills || []) {
        const entry = byRound.get(kill.round_num);
        if (!entry) continue;
        if (kill.attacker_steamid === targetId) entry.target.kills += 1;
        if (kill.victim_steamid === targetId) entry.target.deaths += 1;
    }
    for (const damage of payload.damages || []) {
        const entry = byRound.get(damage.round_num);
        if (entry && damage.attacker_steamid === targetId) entry.target.damage += Number(damage.dmg_health) || 0;
    }
    return [...byRound.values()].map((entry) => ({
        ...entry,
        target: { ...entry.target, damage: round(entry.target.damage, 0) }
    }));
}

function keyRounds(rounds, findings, targetId) {
    const byRound = new Map();
    for (const finding of findings) {
        if (!Number.isInteger(finding.round_num)) continue;
        const list = byRound.get(finding.round_num) || [];
        list.push(finding.finding_id);
        byRound.set(finding.round_num, list);
    }
    const picks = [];
    for (const round of rounds) {
        const reasons = [];
        if (round.target.kills > 0) reasons.push('target_kills');
        if (round.target.deaths > 0 && round.target.kills === 0) reasons.push('target_death_no_kill');
        if (byRound.has(round.round_num)) reasons.push('review_candidates');
        if (round.target.buy_type && ['eco', 'force'].includes(round.target.buy_type) &&
            round.winner_side && round.winner_side !== round.targetSide) reasons.push('economy_round');
        if (!reasons.length) continue;
        picks.push({
            round_num: round.round_num,
            reasons,
            evidence_ids: (byRound.get(round.round_num) || []).slice(0, 6)
                .map((findingId) => findingId.split(':')[1])
        });
    }
    return picks.slice(0, 30);
}

function evidenceOf(payload, targetId) {
    const events = [];
    const push = (eventId, type, tick, roundNum, data) => {
        events.push({ event_id: eventId, type, round_num: roundNum ?? null, tick: tick ?? null, target: true, data });
    };
    for (const kill of payload.kills || []) push(kill.event_id, 'kill', kill.tick, kill.round_num, kill);
    for (const damage of payload.damages || []) push(damage.event_id, 'damage', damage.tick, damage.round_num, damage);
    for (const blind of payload.blinds || []) push(blind.event_id, 'blind', blind.tick, blind.round_num, blind);
    for (const bomb of payload.bomb || []) push(bomb.event_id, 'bomb', bomb.tick, bomb.round_num, bomb);
    for (const snapshot of payload.target_death_snapshots || []) {
        push(snapshot.event_id, 'death_context', snapshot.tick, snapshot.round_num, snapshot);
    }
    for (const grenade of payload.grenades || []) {
        push(grenade.event_id, 'grenade', grenade.tick, grenade.round_num,
            { ...grenade, points: undefined, point_ticks: undefined });
    }
    for (const smoke of payload.smokes || []) push(smoke.event_id, 'smoke', smoke.start_tick, smoke.round_num, smoke);
    for (const fire of payload.fires || []) push(fire.event_id, 'fire', fire.start_tick, fire.round_num, fire);
    return events;
}

function limitations(payload) {
    const list = [
        '本报告完全来自上传的 Demo 文件解析结果，不包含玩家可见性、语音沟通和客户端画面。',
        '规则命中表示值得回看，不代表失误或因果关系。',
        '速度与位置来自 0.5 秒采样，不足以判断急停、预瞄或反应时间。'
    ];
    const noThrower = (payload.grenades || []).filter((item) => !item.thrower_steamid).length;
    if (noThrower) list.push(`${noThrower} 条道具轨迹缺少投掷者归属，只作上下文，不计入个人道具统计。`);
    if (payload.truncated?.length) list.push(`解析结果在 ${[...new Set(payload.truncated)].join('、')} 上被截断。`);
    if (!(payload.blinds || []).length) list.push('Demo 中没有可归属的闪光事件，道具相关结论有限。');
    return list;
}

/**
 * Build the full analysis artifact set for a parsed demo.
 */
function normalize(payload, options = {}) {
    assertParse(payload);
    const identity = matchIdentity(payload);
    const analysisId = options.analysisId;
    if (!analysisId) throw new Error('analysisId is required');
    const uploadedAt = options.uploadedAt || new Date().toISOString();
    const targetId = String(payload.target_player_id || '');
    if (!/^\d{1,20}$/.test(targetId)) throw new Error('Parser output has no usable target player');
    const targetSide = targetTeamSide(payload, targetId);
    const rounds = payload.rounds || [];
    const score = scoreboard(rounds);
    const buys = buyTypesByRound(payload.round_economy || []);
    const samples = movementSummary(payload.target_samples || []);
    const snapshotEvents = payload.target_death_snapshots || [];
    const findings = [
        ...deathFindings(payload, targetId),
        ...flashFindings(payload, targetId),
        ...openingFinding(payload, targetId),
        ...economyFindings(payload, rounds, targetSide, buys)
    ].slice(0, MAX_FINDINGS);
    const stats = targetStatLine(payload, targetId);
    const modules = buildModules({
        payload, targetId, targetSide, stats, finds: findings, samples,
        targetSamples: payload.target_samples || [], buys, rounds
    });
    const summaries = roundSummaries(payload, targetId, buys);
    for (const summary of summaries) {
        const buy = buys.get(summary.round_num)?.[targetSide === 'counter-terrorist' ? 'ct' : 't'];
        summary.targetSide = targetSide;
        summary.target.buy_type = buy?.buy_type ?? null;
        summary.target.equipment_value = buy?.equipment_value ?? null;
    }
    const complete = rounds.length > 0 && rounds.every((round) => round.winner_side) &&
        !/surrender/.test(String(rounds.at(-1)?.reason_name || ''));
    const startedAt = null;
    const teams = [
        { team_id: 'terrorist', name: 'Terrorist', score: score.terrorist },
        { team_id: 'counter_terrorist', name: 'Counter-Terrorist', score: score['counter-terrorist'] }
    ];
    const keyRoundList = keyRounds(summaries, findings, targetId);
    const demoWarnings = [
        ...(payload.warnings || []),
        ...(payload.truncated?.length ? [`解析截断: ${[...new Set(payload.truncated)].join(', ')}`] : [])
    ];
    const details = {
        schema_version: 'report-1.0.0',
        analysis_version: VERSION,
        ai_status: 'not_requested',
        source: {
            kind: 'demo_file',
            match_id: identity.match_id,
            package_id: `demo-${analysisId.slice(0, 8)}`,
            producer: { name: 'awpy', version: String(payload.parser?.version || 'unknown') },
            demo: {
                file_name: identity.file_name,
                size_bytes: identity.size_bytes,
                sha256: identity.demo_sha256
            },
            identity_verified: false
        },
        target_player_id: targetId,
        target_selection: options.targetSelection || 'auto_top_fragger',
        match: {
            map: String(payload.header?.map_name || 'unknown'),
            server_name: String(payload.header?.server_name || '').slice(0, 200),
            demo_version: String(payload.header?.demo_version_name || ''),
            tick_rate: Number(payload.tick_rate) || 64,
            duration_seconds: number(Number(payload.header?.playback_time)) ?? null,
            rounds_played: rounds.length,
            score: { terrorist: score.terrorist, 'counter-terrorist': score['counter-terrorist'] },
            complete,
            teams
        },
        analysis_scope: {
            scope: 'demo_file',
            target_player_id: targetId,
            target_selection: options.targetSelection || 'auto_top_fragger',
            identity_verified: false
        },
        data_quality: {
            warnings: demoWarnings,
            demo_sha256: identity.demo_sha256,
            target_team_side: targetSide,
            counts: {
                rounds: rounds.length,
                players: payload.players?.length || 0,
                kills: payload.kills?.length || 0,
                damages: payload.damages?.length || 0,
                blinds: payload.blinds?.length || 0,
                grenades: payload.grenades?.length || 0,
                death_snapshots: snapshotEvents.length,
                samples: payload.target_samples?.length || 0
            }
        },
        statistics: { modules },
        findings: findings.map((finding) => ({
            finding_id: finding.finding_id,
            rule_id: finding.rule_id,
            rule_version: finding.rule_version,
            round_num: finding.round_num,
            tick: finding.tick,
            evidence_ids: finding.evidence_ids,
            observation: finding.observation,
            review_prompt: finding.review_prompt,
            classification: finding.classification
        })),
        key_rounds: keyRoundList,
        rounds: summaries.map((summary) => ({
            round_num: summary.round_num,
            winner_side: summary.winner_side,
            reason: summary.reason,
            buy: summary.buy,
            target: summary.target
        })),
        movement: samples,
        limitations: limitations(payload),
        target_player: {
            steamid: targetId,
            name: stats.name || null,
            team: targetSide,
            teammates: teammates(payload, targetSide, targetId),
            opponents: (payload.players || []).filter((player) => player.side && player.side !== targetSide)
                .map((player) => ({ name: player.name, steamid: player.steamid }))
        }
    };
    return {
        details,
        identity,
        evidence: evidenceOf(payload, targetId),
        samples: payload.target_samples || [],
        grenades: payload.grenades || [],
        keyframes: buildKeyframes(payload, targetId)
    };
}

function buildKeyframes(payload, targetId) {
    const samples = (payload.target_samples || []).filter((sample) => sample.round_num != null);
    const keyframes = [];
    for (const kill of payload.kills || []) {
        const participant = kill.attacker_steamid === targetId || kill.victim_steamid === targetId;
        if (!participant) continue;
        const nearest = nearestSample(samples, kill.tick);
        if (!nearest) continue;
        keyframes.push({
            round_num: kill.round_num ?? nearest.round_num,
            tick: kill.tick,
            state: {
                steamid: targetId,
                x: nearest.x, y: nearest.y, z: nearest.z, yaw: nearest.yaw,
                health: nearest.health, armor: nearest.armor,
                active_weapon: nearest.active_weapon
            }
        });
    }
    return keyframes;
}

function nearestSample(samples, tick) {
    let best = null, distance = Infinity;
    for (const sample of samples) {
        const delta = Math.abs(sample.tick - tick);
        if (delta < distance) { distance = delta; best = sample; }
    }
    return distance <= 128 ? best : null;
}

/** Items shaped like the ZIP pipeline's per-round JSONL, for the existing map view. */
function mapItems(analysis) {
    const byRound = new Map();
    const push = (round, item) => {
        const list = byRound.get(round) || [];
        if (list.length < MAX_SAMPLES_PER_ROUND) list.push(item);
        byRound.set(round, list);
    };
    for (const sample of analysis.samples) {
        if (!Number.isInteger(sample.round_num)) continue;
        push(sample.round_num, {
            kind: 'player_samples',
            round_num: sample.round_num,
            tick: sample.tick,
            state: {
                steamid: analysis.details.target_player_id,
                x: sample.x, y: sample.y, z: sample.z, yaw: sample.yaw,
                health: sample.health, armor: sample.armor,
                velocity_x: sample.velocity_x, velocity_y: sample.velocity_y,
                active_weapon: sample.active_weapon,
                is_reloading: sample.is_reloading,
                is_jumping: sample.is_jumping,
                is_crouched: sample.is_crouched,
                is_scoped: sample.is_scoped
            }
        });
    }
    for (const keyframe of analysis.keyframes) {
        if (!Number.isInteger(keyframe.round_num)) continue;
        push(keyframe.round_num, { kind: 'target_keyframes', ...keyframe });
    }
    for (const grenade of analysis.grenades) {
        if (!Number.isInteger(grenade.round_num) || !grenade.points?.length) continue;
        const owned = grenade.thrower_steamid === analysis.details.target_player_id;
        push(grenade.round_num, {
            kind: owned ? 'trajectories' : 'unattributed_trajectories',
            event_id: grenade.event_id,
            round_num: grenade.round_num,
            tick: grenade.tick,
            type: grenade.type,
            ownership: owned ? 'known' : 'unknown',
            thrower_player_id: grenade.thrower_steamid ?? null,
            points: grenade.points.map(([x, y, z]) => ({ x, y, z })),
            point_ticks: grenade.point_ticks
        });
    }
    return byRound;
}

/** report.schema.json needs the standard report; the AI and details keep the extended one. */
function cloudReport(analysis, options = {}) {
    const { details } = analysis;
    const aiConfigured = options.aiConfigured === true;
    const modules = {};
    for (const [name, module] of Object.entries(details.statistics.modules)) {
        modules[name] = {
            module_version: module.module_version,
            status: module.status === 'completed' ? 'completed' : 'insufficient_data',
            reason: module.reason ?? null,
            sample_count: Math.max(0, Number(module.sample_count) || 0),
            metrics: module.metrics ?? null,
            evidence_ids: (module.evidence_ids || []).filter((id) => /^[a-zA-Z0-9_-]{1,80}$/.test(id))
        };
    }
    const status = Object.values(modules).every((module) => module.status === 'completed')
        ? 'completed' : 'partial';
    const report = {
        report_schema_version: '1.0.0',
        match_id: details.source.match_id,
        package_id: details.source.package_id,
        analysis_id: options.analysisId,
        target_player_id: details.target_player_id,
        status,
        match: {
            started_at: details.match.started_at ?? null,
            started_at_source: 'demo',
            map: details.match.map,
            tick_rate: details.match.tick_rate,
            complete: details.match.complete,
            teams: details.match.teams
        },
        perspective: { player_team_id: details.data_quality.target_team_side ? `team-${details.data_quality.target_team_side}` : null },
        is_fixture: false,
        uploaded_at: options.uploadedAt,
        analyzed_at: new Date().toISOString(),
        versions: { evaluation: VERSION, prompt: aiConfigured ? 'coach-demo-1.0.0' : 'not_configured' },
        report: {
            modules,
            scores: {},
            findings: details.findings.map((finding) => ({
                finding_id: finding.finding_id,
                module: finding.rule_id.startsWith('death_') || finding.rule_id === 'untraded_death'
                    ? 'death_context'
                    : finding.rule_id.startsWith('self_flash') || finding.rule_id.startsWith('team_flash')
                        ? 'utility' : finding.rule_id,
                description: `第 ${finding.round_num ?? '未知'} 回合：${finding.observation}。${finding.review_prompt}`,
                evidence_ids: finding.evidence_ids,
                package_id: details.source.package_id
            })),
            training_suggestions: [],
            ai_status: aiConfigured ? 'completed' : 'not_configured',
            warnings: details.data_quality.warnings
        }
    };
    formal.enforce(formal.report, report, 'report');
    return report;
}

/** Persist the artifact set the HTTP layer and the AI queue read back. */
async function writeArtifacts(directory, analysis, options = {}) {
    await fs.mkdir(directory, { recursive: true });
    const report = cloudReport(analysis, options);
    await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(analysis.details));
    await fs.writeFile(path.join(directory, 'cloud-report.json'), JSON.stringify(report));

    const byRound = mapItems(analysis);
    for (const [round, items] of byRound) {
        const file = path.join(directory, `map-${round}.jsonl`);
        await fs.writeFile(file, items.map((item) => JSON.stringify(item)).join('\n') + '\n');
    }
    for (const summary of analysis.details.rounds) {
        const events = analysis.evidence.filter((event) => event.round_num === summary.round_num);
        const findings = analysis.details.findings.filter((finding) => finding.round_num === summary.round_num);
        await fs.writeFile(path.join(directory, `round-${summary.round_num}.json`),
            JSON.stringify({ ...summary, events, finding_ids: findings.map((finding) => finding.finding_id) }));
    }

    const offsets = Object.create(null);
    const chunks = [];
    let offset = 0;
    for (const event of analysis.evidence) {
        const bytes = Buffer.from(JSON.stringify(event));
        offsets[event.event_id] = { offset, length: bytes.length };
        chunks.push(bytes);
        offset += bytes.length;
    }
    await fs.writeFile(path.join(directory, 'evidence.bin'), Buffer.concat(chunks));
    await fs.writeFile(path.join(directory, 'evidence-index.json'), JSON.stringify(offsets));

    const summary = {
        status: report.status,
        summary: {
            adr: analysis.details.statistics.modules.basic_stats.metrics.adr ?? null,
            rating: null,
            player_team_id: report.perspective.player_team_id,
            status: report.status,
            map: analysis.details.match.map,
            score: analysis.details.match.score,
            target_player_id: analysis.details.target_player_id,
            target_selection: analysis.details.target_selection,
            demo_sha256: analysis.identity.demo_sha256,
            rounds: analysis.details.match.rounds_played
        }
    };
    await fs.writeFile(path.join(directory, 'report-meta.json'), JSON.stringify(summary));
    return { report, details: analysis.details, summary };
}

module.exports = {
    VERSION,
    PARSE_SCHEMA,
    normalize,
    mapItems,
    cloudReport,
    writeArtifacts,
    assertParse,
    movementSummary
};
