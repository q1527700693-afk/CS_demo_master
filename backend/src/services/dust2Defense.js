'use strict';

/**
 * Dust2 CT defense profile and site recommendation.
 *
 * This layer is intentionally explainable:
 *   1. observe initial CT setups and responses in the first few rounds;
 *   2. aggregate site pressure, hold/retake outcomes and first-death signals;
 *   3. recommend a site using only information available before the target round.
 *
 * It is not a win-probability model. It returns scores, reasons, risks and a
 * confidence label so the AI can narrate facts without inventing them.
 */
const tactics = require('./dust2Tactics');
const knowledge = require('./dust2Knowledge');

const SITE_GROUPS = {
    A: new Set(['a_site', 'a_long', 'long_doors', 'a_long_pit', 'a_short', 'a_short_stairs', 'catwalk']),
    B: new Set(['b_site', 'b_tunnel', 'lower_tunnels', 'upper_tunnels', 'b_window', 'ct_ramp']),
    MID: new Set(['mid', 'mid_doors', 'xbox', 'ct_spawn'])
};

const BUY_LABELS = {
    pistol: '手枪局',
    eco: '经济局',
    force: '强起/半起',
    full: '长枪局',
    unknown: '经济未知'
};

function buyLabel(value) {
    return BUY_LABELS[String(value || '').toLowerCase()] || (value ? String(value) : '经济未知');
}

function spawnLabel(slotId) {
    return knowledge.load().spawnById.get(slotId)?.name || slotId;
}

function rotationSpeedLabel(seconds) {
    if (!Number.isFinite(seconds)) return '未观察到有效转点';
    if (seconds <= 5) return '快';
    if (seconds <= 10) return '中等';
    return '慢';
}

function avg(values) {
    const usable = values.filter((value) => Number.isFinite(value));
    return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function roundFor(payload, roundNum) {
    return (payload?.rounds || []).find((round) => Number(round.round_num) === Number(roundNum)) || null;
}

function actionStart(round) {
    return Number(round?.freeze_end_tick ?? round?.start_tick) || 0;
}

function sideForZone(zoneId) {
    for (const [site, zones] of Object.entries(SITE_GROUPS)) {
        if (zones.has(zoneId)) return site;
    }
    return null;
}

function bombSiteAny(payload, roundNum) {
    const plants = (payload?.bomb || [])
        .filter((event) => Number(event.round_num) === Number(roundNum) &&
            String(event.event || '').toLowerCase().includes('finish_plant') &&
            event.bombsite)
        .sort((a, b) => Number(a.tick) - Number(b.tick));
    const plant = plants.at(-1);
    return plant ? { site: String(plant.bombsite).toUpperCase(), tick: Number(plant.tick) || null } : { site: null, tick: null };
}

function economyFor(payload, roundNum, side) {
    const row = (payload?.round_economy || []).find((event) =>
        Number(event.round_num) === Number(roundNum) &&
        tactics.normalizeSide(event.side) === side
    );
    return row ? {
        buy_type: row.buy_type || null,
        buy_label: buyLabel(row.buy_type),
        equipment_value: Number.isFinite(Number(row.equipment_value)) ? Number(row.equipment_value) : null,
        players: Number(row.n_players) || null
    } : { buy_type: null, buy_label: '经济未知', equipment_value: null, players: null };
}

function teamUtility(payload, roundNum, team) {
    const selection = team?.mode ? team : tactics.resolveTeam(payload, team);
    const samples = tactics.teamSamples(payload, roundNum, selection);
    const firstByPlayer = new Map();
    for (const sample of samples) {
        const id = String(sample.steamid);
        if (!firstByPlayer.has(id)) firstByPlayer.set(id, sample);
    }
    const totals = { flashbangs: 0, smoke_grenades: 0, he_grenades: 0, fire_grenades: 0 };
    for (const sample of firstByPlayer.values()) {
        for (const key of Object.keys(totals)) totals[key] += Math.max(0, Number(sample[key]) || 0);
    }
    return {
        ...totals,
        total: Object.values(totals).reduce((sum, value) => sum + value, 0),
        players_with_samples: firstByPlayer.size
    };
}

function opponentRoster(payload, ownTeam) {
    const own = ownTeam?.mode ? ownTeam : tactics.resolveTeam(payload, ownTeam);
    if (own.mode !== 'roster') return { mode: 'unknown', label: 'unknown', steamIds: null };
    return tactics.teamRosters(payload)
        .filter((team) => team.team_clan_name !== own.teamClanName)
        .map((team) => tactics.resolveTeam(payload, { teamClanName: team.team_clan_name }))
        .find((team) => team.mode === 'roster' && [...team.steamIds].some((id) => !own.steamIds.has(id))) || { mode: 'unknown', label: 'unknown', steamIds: null };
}

function initialLayout(payload, roundNum, ctTeam, seconds = 8) {
    const round = roundFor(payload, roundNum);
    if (!round) return { A: 0, B: 0, MID: 0, UNKNOWN: 0, players: [] };
    const samples = tactics.teamSamples(payload, roundNum, ctTeam);
    const start = actionStart(round);
    const rate = Number(payload?.tick_rate) || 64;
    const early = samples.filter((sample) => {
        const tick = Number(sample.tick);
        return Number.isFinite(tick) && tick >= start && tick <= start + seconds * rate;
    });
    const lastByPlayer = new Map();
    for (const sample of early) {
        const id = String(sample.steamid);
        lastByPlayer.set(id, sample);
    }
    const counts = { A: 0, B: 0, MID: 0, UNKNOWN: 0 };
    const players = [];
    for (const [steamid, sample] of lastByPlayer) {
        const zone = tactics.sampleZone(sample);
        const site = zone ? sideForZone(zone.id) : null;
        counts[site || 'UNKNOWN'] += 1;
        players.push({ steamid, zone_id: zone?.id || null, site: site || null });
    }
    return { ...counts, players };
}

function ctRoundFeatures(payload, roundNum, ctTeam) {
    const round = roundFor(payload, roundNum);
    if (!round) return null;
    const side = tactics.roundTeamSide(payload, roundNum, ctTeam);
    if (side !== 'CT') return null;
    const layout = initialLayout(payload, roundNum, ctTeam);
    const contact = tactics.firstContact(payload, roundNum, ctTeam);
    const plant = bombSiteAny(payload, roundNum);
    const winner = tactics.normalizeSide(round.winner_side);
    const rate = Number(payload?.tick_rate) || 64;
    const allCtSamples = tactics.teamSamples(payload, roundNum, ctTeam)
        .sort((a, b) => Number(a.tick) - Number(b.tick));
    const contactSite = contact ? sideForZone(contact.victim_zone_id || contact.attacker_zone_id) : null;
    const targetSite = plant.site || contactSite;
    const oppositeSite = targetSite === 'A' ? 'B' : targetSite === 'B' ? 'A' : null;
    const eventTick = Number(plant.tick ?? contact?.tick);
    const initialOpposite = oppositeSite
        ? layout.players.filter((player) => player.site === oppositeSite)
        : [];
    const rotationSeconds = [];
    const rotatedPlayers = [];
    if (Number.isFinite(eventTick) && targetSite && oppositeSite) {
        const targetZones = SITE_GROUPS[targetSite];
        const oppositeZones = SITE_GROUPS[oppositeSite];
        for (const initialPlayer of initialOpposite) {
            const samplesAfter = allCtSamples.filter((sample) =>
                String(sample.steamid) === initialPlayer.steamid && Number(sample.tick) >= eventTick
            );
            const firstTarget = samplesAfter.find((sample) => {
                const zone = tactics.sampleZone(sample);
                return zone && targetZones.has(zone.id);
            });
            if (firstTarget) {
                const seconds = Math.max(0, (Number(firstTarget.tick) - eventTick) / rate);
                rotationSeconds.push(seconds);
                rotatedPlayers.push({ steamid: initialPlayer.steamid, seconds });
            }
        }
    }
    const oppositePlayersStillThere = oppositeSite && Number.isFinite(eventTick)
        ? allCtSamples.some((sample) => {
            if (Number(sample.tick) < eventTick) return false;
            if (!initialOpposite.some((player) => player.steamid === String(sample.steamid))) return false;
            const zone = tactics.sampleZone(sample);
            return zone && SITE_GROUPS[oppositeSite].has(zone.id);
        })
        : false;
    const retakeSeconds = rotationSeconds.length ? avg(rotationSeconds) : null;
    const rotation = targetSite ? {
        target_site: targetSite,
        opposite_site: oppositeSite,
        initial_opposite_count: initialOpposite.length,
        rotated_count: rotatedPlayers.length,
        rotation_seconds: rotationSeconds,
        average_seconds: retakeSeconds,
        speed: rotationSpeedLabel(retakeSeconds),
        abandoned_opposite_site: initialOpposite.length > 0 && !oppositePlayersStillThere,
        sampled_rounds: Number.isFinite(eventTick) ? 1 : 0
    } : null;
    const ctVictim = (payload?.kills || [])
        .filter((kill) => Number(kill.round_num) === Number(roundNum) &&
            tactics.normalizeSide(kill.victim_side) === 'CT')
        .sort((a, b) => Number(a.tick) - Number(b.tick))[0];
    let untraded = null;
    let firstDeathSite = null;
    if (ctVictim) {
        firstDeathSite = sideForZone(tactics.eventZone(ctVictim.victim_x, ctVictim.victim_y));
        const avenged = (payload?.kills || []).some((kill) =>
            Number(kill.round_num) === Number(roundNum) &&
            String(kill.victim_steamid || '') === String(ctVictim.attacker_steamid || '') &&
            Number(kill.tick) >= Number(ctVictim.tick) &&
            Number(kill.tick) <= Number(ctVictim.tick) + 5 * rate
        );
        untraded = !avenged;
    }
    return {
        round_num: Number(roundNum),
        initial: layout,
        contact_site: contactSite,
        planted_site: plant.site,
        target_site: targetSite,
        ct_win: winner === 'CT',
        retake_seconds: retakeSeconds,
        rotation,
        first_death_site: firstDeathSite,
        untraded_first_death: untraded,
        economy: {
            ct: economyFor(payload, roundNum, 'CT'),
            t: economyFor(payload, roundNum, 'T')
        }
    };
}

function buildCtDefenseProfile(payload, ctTeam, options = {}) {
    const selection = ctTeam?.mode ? ctTeam : tactics.resolveTeam(payload, ctTeam);
    if (selection.mode === 'unknown') return { status: 'invalid_team', team: ctTeam || null, rounds_observed: 0 };
    const throughRound = Number.isFinite(Number(options.throughRound)) ? Number(options.throughRound) : Infinity;
    const scoutRounds = Math.max(1, Math.min(Number(options.scoutRounds) || 6, 20));
    const rounds = [...(payload?.rounds || [])]
        .sort((a, b) => Number(a.round_num) - Number(b.round_num))
        .filter((round) => Number(round.round_num) < throughRound);
    const features = rounds
        .map((round) => ctRoundFeatures(payload, round.round_num, selection))
        .filter(Boolean)
        .slice(0, scoutRounds);
    if (!features.length) return { status: 'insufficient_data', team: selection.label, rounds_observed: 0 };

    const aInitial = avg(features.map((item) => item.initial.A));
    const bInitial = avg(features.map((item) => item.initial.B));
    const midInitial = avg(features.map((item) => item.initial.MID));
    const aPlants = features.filter((item) => item.planted_site === 'A');
    const bPlants = features.filter((item) => item.planted_site === 'B');
    const aHoldRate = aPlants.length ? aPlants.filter((item) => item.ct_win).length / aPlants.length : null;
    const bHoldRate = bPlants.length ? bPlants.filter((item) => item.ct_win).length / bPlants.length : null;
    const rotations = features.map((item) => item.rotation).filter((item) => item && item.sampled_rounds);
    const aRotations = rotations.filter((item) => item.target_site === 'A');
    const bRotations = rotations.filter((item) => item.target_site === 'B');
    const aRetake = avg(aRotations.flatMap((item) => item.rotation_seconds));
    const bRetake = avg(bRotations.flatMap((item) => item.rotation_seconds));
    const rotatedTargetRounds = rotations.filter((item) => item.rotated_count > 0).length;
    const abandonedOppositeRounds = rotations.filter((item) => item.abandoned_opposite_site).length;
    const avgRotation = avg(rotations.flatMap((item) => item.rotation_seconds));
    const untradedA = features.filter((item) => item.first_death_site === 'A' && item.untraded_first_death).length;
    const untradedB = features.filter((item) => item.first_death_site === 'B' && item.untraded_first_death).length;
    const aScore = (bInitial - aInitial) * 10 + ((bHoldRate ?? 0.5) - (aHoldRate ?? 0.5)) * 30 + ((bRetake ?? 0) - (aRetake ?? 0)) * 2;
    const bScore = (aInitial - bInitial) * 10 + ((aHoldRate ?? 0.5) - (bHoldRate ?? 0.5)) * 30 + ((aRetake ?? 0) - (bRetake ?? 0)) * 2;
    const weakSite = aScore > bScore + 5 ? 'A' : bScore > aScore + 5 ? 'B' : null;
    const confidence = features.length >= 4 ? 'medium' : 'low';
    const signals = [];
    if (Number.isFinite(aInitial) && Number.isFinite(bInitial)) {
        signals.push(`CT 初始站位：A ${aInitial.toFixed(1)} 人，B ${bInitial.toFixed(1)} 人，中路 ${midInitial.toFixed(1)} 人。`);
    }
    if (aHoldRate !== null || bHoldRate !== null) {
        signals.push(`CT 面对包点压力：A 守住 ${aHoldRate === null ? '无样本' : `${Math.round(aHoldRate * 100)}%`}，B 守住 ${bHoldRate === null ? '无样本' : `${Math.round(bHoldRate * 100)}%`}。`);
    }
    if (rotations.length) {
        signals.push(`CT 转点行为：观察到 ${rotatedTargetRounds}/${rotations.length} 个目标回合有人从反向包点转到目标点，平均 ${avgRotation === null ? '无有效样本' : `${avgRotation.toFixed(1)} 秒`}（${rotationSpeedLabel(avgRotation)}）。`);
        if (abandonedOppositeRounds) signals.push(`反向包点被放空：${abandonedOppositeRounds} 个回合没有初始反向防守者留在原点。`);
        if (!rotatedTargetRounds) signals.push('没有观察到明确的反向包点转点，不能仅凭回防时间判断对面转点速度。');
    }
    if (weakSite) signals.push(`初步判断 ${weakSite} 点更容易被打开。`);
    return {
        status: 'ok',
        team: { label: selection.label, team_clan_name: selection.teamClanName || null },
        rounds_observed: features.length,
        scout_rounds: features.map((item) => item.round_num),
        initial: {
            A: aInitial,
            B: bInitial,
            MID: midInitial
        },
        plant_rounds: { A: aPlants.length, B: bPlants.length },
        hold_rate: { A: aHoldRate, B: bHoldRate },
        retake_seconds: { A: aRetake, B: bRetake },
        rotation: {
            sampled_rounds: rotations.length,
            rotated_rounds: rotatedTargetRounds,
            average_seconds: avgRotation,
            speed: rotationSpeedLabel(avgRotation),
            abandoned_opposite_rounds: abandonedOppositeRounds,
            by_site: {
                A: { sampled_rounds: aRotations.length, average_seconds: aRetake },
                B: { sampled_rounds: bRotations.length, average_seconds: bRetake }
            }
        },
        untraded_first_death: { A: untradedA, B: untradedB },
        weaknesses: {
            A: Math.round(aScore * 10) / 10,
            B: Math.round(bScore * 10) / 10,
            weaker_site: weakSite
        },
        confidence,
        signals,
        features
    };
}

function ownSiteHistory(payload, ownTeam, beforeRound, maxRounds = 20) {
    const selection = ownTeam?.mode ? ownTeam : tactics.resolveTeam(payload, ownTeam);
    const history = { A: { attempts: 0, wins: 0 }, B: { attempts: 0, wins: 0 } };
    const rounds = [...(payload?.rounds || [])]
        .sort((a, b) => Number(a.round_num) - Number(b.round_num))
        .filter((round) => Number(round.round_num) < Number(beforeRound))
        .slice(-maxRounds);
    for (const round of rounds) {
        const result = tactics.analyzeTeamRound(payload, round.round_num, selection);
        if (result.team_side !== 'T') continue;
        const firstContact = result.facts?.first_contact;
        const contactSite = firstContact
            ? sideForZone(firstContact.victim_zone_id || firstContact.attacker_zone_id)
            : null;
        const site = result.facts?.planted_site || contactSite;
        if (!site || !history[site]) continue;
        history[site].attempts += 1;
        if (tactics.normalizeSide(round.winner_side) === 'T') history[site].wins += 1;
    }
    return history;
}

function scoreToConfidence(profile, economyMismatch) {
    if (profile.rounds_observed < 3) return 'low';
    if (economyMismatch) return 'low';
    return 'medium';
}

function recommendSite(payload, ownTeam, roundNum, options = {}) {
    const own = ownTeam?.mode ? ownTeam : tactics.resolveTeam(payload, ownTeam);
    if (own.mode === 'unknown') return { status: 'invalid_team', round_num: Number(roundNum) };
    const side = tactics.roundTeamSide(payload, roundNum, own);
    if (side !== 'T') {
        return { status: 'not_attacking_side', round_num: Number(roundNum), own_side: side, reason: 'Site recommendation is produced when the selected team is attacking on T side.' };
    }
    const opponent = opponentRoster(payload, own);
    if (opponent.mode === 'unknown') return { status: 'opponent_not_found', round_num: Number(roundNum) };
    const scoutRounds = Math.max(1, Math.min(Number(options.scoutRounds) || 6, 20));
    const profile = buildCtDefenseProfile(payload, opponent, { throughRound: roundNum, scoutRounds });
    const aDef = profile.initial?.A ?? 2.5;
    const bDef = profile.initial?.B ?? 2.5;
    let a = 50 + (bDef - aDef) * 10;
    let b = 50 + (aDef - bDef) * 10;
    if (profile.hold_rate) {
        a += ((profile.hold_rate.B ?? 0.5) - (profile.hold_rate.A ?? 0.5)) * 30;
        b += ((profile.hold_rate.A ?? 0.5) - (profile.hold_rate.B ?? 0.5)) * 30;
    }
    if (profile.retake_seconds) {
        a += ((profile.retake_seconds.B ?? 0) - (profile.retake_seconds.A ?? 0)) * 2;
        b += ((profile.retake_seconds.A ?? 0) - (profile.retake_seconds.B ?? 0)) * 2;
    }
    const spawns = tactics.spawnAssignments(payload, roundNum, own, 'T');
    const spawnIds = new Set(spawns.map((item) => item.slot_id));
    if (spawnIds.has('t_a_long_first')) a += 6;
    if (spawnIds.has('t_short_first')) a += 3;
    if (spawnIds.has('t_b_tunnel_first')) b += 6;
    const utility = teamUtility(payload, roundNum, own);
    if (utility.smoke_grenades > 0) { a += 3; b += 3; }
    if (utility.flashbangs > 0) { a += 2; b += 2; }
    const ownEconomy = economyFor(payload, roundNum, 'T');
    const enemyEconomy = economyFor(payload, roundNum, 'CT');
    const ownCheap = ['eco', 'pistol', 'force'].includes(ownEconomy.buy_type);
    const enemyStrong = ['full'].includes(enemyEconomy.buy_type);
    const economyMismatch = ownCheap && enemyStrong;
    if (economyMismatch) { a -= 4; b -= 4; }
    if (ownEconomy.buy_type === 'full' && ['eco', 'force'].includes(enemyEconomy.buy_type)) { a += 4; b += 4; }
    const history = ownSiteHistory(payload, own, roundNum);
    const aAttempts = history.A.attempts;
    const bAttempts = history.B.attempts;
    if (aAttempts >= 2) a += ((history.A.wins / aAttempts) - 0.5) * 18;
    if (bAttempts >= 2) b += ((history.B.wins / bAttempts) - 0.5) * 18;
    const primary = a >= b ? 'A' : 'B';
    const secondary = primary === 'A' ? 'B' : 'A';
    const spawnLabels = spawns.map((item) => item.slot_label || spawnLabel(item.slot_id));
    const ownBuyLabel = ownEconomy.buy_label || buyLabel(ownEconomy.buy_type);
    const enemyBuyLabel = enemyEconomy.buy_label || buyLabel(enemyEconomy.buy_type);
    const cannotForce = economyMismatch;
    let tacticId;
    let tacticName;
    let recommendationType = 'execute';
    if (cannotForce) {
        tacticId = 'dust2_t_mid_default_fake';
        tacticName = '默认控图 / 找机会（经济劣势不强行爆点）';
        recommendationType = 'economy_default';
    } else if (profile.weaknesses?.weaker_site === null && profile.confidence !== 'low') {
        tacticId = 'dust2_t_mid_default_fake';
        tacticName = '中路默认 / 假打转点';
        recommendationType = 'default';
    } else if (primary === 'A') {
        tacticId = spawnIds.has('t_short_first') && !spawnIds.has('t_a_long_first')
            ? 'dust2_t_a_short_split'
            : 'dust2_t_a_long_rush';
        tacticName = tacticId === 'dust2_t_a_short_split' ? 'A 小夹 A' : 'A 大快打';
    } else {
        tacticId = 'dust2_t_b_tunnel_rush';
        tacticName = 'B 洞 rush';
    }
    const aWins = history.A.wins;
    const bWins = history.B.wins;
    const reasons = [
        `对手前 ${profile.rounds_observed} 个 CT 回合初始站位：A ${aDef.toFixed(1)} 人，B ${bDef.toFixed(1)} 人。`,
        profile.weaknesses?.weaker_site
            ? `防守画像倾向：${profile.weaknesses.weaker_site} 点压力更大。`
            : '防守画像暂时没有明显单侧弱点，优先考虑默认/假打。',
        `我方出生位：${spawnLabels.join('、') || '未匹配到明确出生位'}。`,
        `我方道具：${utility.smoke_grenades} 烟 / ${utility.flashbangs} 闪。`,
        `经济：我方 ${ownBuyLabel}${ownEconomy.equipment_value != null ? `（约 $${ownEconomy.equipment_value}）` : ''}，对手 ${enemyBuyLabel}${enemyEconomy.equipment_value != null ? `（约 $${enemyEconomy.equipment_value}）` : ''}。`,
        `本场已打过：A ${history.A.attempts} 次（${aWins} 胜），B ${history.B.attempts} 次（${bWins} 胜）。`
    ];
    const risks = [];
    if (cannotForce) risks.push('我方当前是短枪/经济劣势，直接长距离强攻的风险很高，建议先默认控图或找 timing。');
    if (cannotForce && primary === 'A') risks.push('短枪打 A 大的远距离枪线尤其吃亏，不建议在没有烟闪时强抢 A 大。');
    if (cannotForce && primary === 'B') risks.push('短枪进 B 洞虽然距离近，但对面长枪卡点仍占优势，优先找 timing 或近身补枪。');
    if (spawns.length < 5) risks.push('出生位样本不足，当前无法完整判断哪条路线的第一身位更好。');
    if (!utility.smoke_grenades) risks.push('当前没有烟雾弹，进点容错较低。');
    if (!utility.flashbangs) risks.push('当前没有闪光弹，第一身位更容易被直架。');
    if (profile.rotation?.speed === '快') risks.push('对面转点样本偏快，固定单点强打容易被快速回防夹击，建议准备假打/转点。');
    if (profile.confidence === 'low') risks.push('CT 防守样本较少，这个打点判断不能当成确定结论。');
    return {
        status: 'ok',
        round_num: Number(roundNum),
        own_team: { label: own.label, team_clan_name: own.teamClanName || null },
        opponent_team: { label: opponent.label, team_clan_name: opponent.teamClanName || null },
        own_side: 'T',
        economy: { own: ownEconomy, enemy: enemyEconomy },
        utility,
        spawns,
        spawn_labels: spawnLabels,
        recommendation_type: recommendationType,
        profile,
        site_scores: { A: Math.round(a * 10) / 10, B: Math.round(b * 10) / 10 },
        primary_site: primary,
        secondary_site: secondary,
        recommended_tactic_id: tacticId,
        recommended_tactic_name: tacticName,
        confidence: scoreToConfidence(profile, economyMismatch),
        reasons,
        risks
    };
}

function roundReview(payload, ownTeam, roundNum, recommendation) {
    const round = roundFor(payload, roundNum);
    if (!round) return null;
    const selection = ownTeam?.mode ? ownTeam : tactics.resolveTeam(payload, ownTeam);
    const result = tactics.analyzeTeamRound(payload, roundNum, selection);
    const firstContact = result.facts?.first_contact;
    const actualSite = result.facts?.planted_site ||
        (firstContact ? sideForZone(firstContact.victim_zone_id || firstContact.attacker_zone_id) : null);
    const outcome = tactics.normalizeSide(round.winner_side) === 'T' ? 'win' : 'loss';
    const kills = (payload?.kills || [])
        .filter((kill) => Number(kill.round_num) === Number(roundNum))
        .sort((a, b) => Number(a.tick) - Number(b.tick));
    const firstKill = kills[0] || null;
    const firstKillSide = firstKill ? (tactics.normalizeSide(firstKill.attacker_side) === 'T' ? 'T' : 'CT') : null;
    const openingCredit = firstKillSide === 'T' && firstKill
        ? { steamid: firstKill.attacker_steamid || null, name: firstKill.attacker_name || '我方队员', weapon: firstKill.weapon || null }
        : null;
    const openingDeath = firstKillSide === 'CT' && firstKill
        ? { steamid: firstKill.victim_steamid || null, name: firstKill.victim_name || '我方队员', weapon: firstKill.weapon || null }
        : null;
    const ownEconomy = economyFor(payload, roundNum, 'T');
    const enemyEconomy = economyFor(payload, roundNum, 'CT');
    const ownCheap = ['eco', 'pistol', 'force'].includes(ownEconomy.buy_type);
    const enemyStrong = enemyEconomy.buy_type === 'full';
    const followedPlan = actualSite ? actualSite === recommendation.primary_site : null;
    const causes = [];
    const suggestions = [];
    const credits = [];
    if (outcome === 'loss') {
        if (ownCheap && enemyStrong) causes.push(`我方 ${ownEconomy.buy_label || buyLabel(ownEconomy.buy_type)}，对手 ${enemyEconomy.buy_label || buyLabel(enemyEconomy.buy_type)}，枪械经济劣势明显。`);
        if (followedPlan === false) causes.push(`实际没有按建议优先打 ${recommendation.primary_site}，而是去了 ${actualSite} 点。`);
        if (openingDeath) causes.push(`我方先掉人：${openingDeath.name} 被首杀。`);
        const missing = result.evaluation?.missing_checks || [];
        if (missing.length) {
            const labels = missing.map((check) => check.startsWith('utility:') ? '缺少关键道具'
                : check.startsWith('spawn:') ? '出生位不匹配'
                    : check.startsWith('zone:') ? '缺少关键区域控制' : check);
            causes.push(`执行检查未满足：${[...new Set(labels)].join('、')}。`);
        }
        if (!result.facts?.planted_site) causes.push('本回合没有完成下包，进攻没有转化成包点压力。');
        if (!causes.length) causes.push('没有足够证据把失败归因到单一原因，需要回看具体交火。');
        if (ownCheap && enemyStrong) suggestions.push('下一回合先默认/保经济，避免短枪直接冲长枪远点。');
        if (followedPlan === false) suggestions.push(`如果继续打 ${recommendation.primary_site}，下一回合按建议先拿对应出生位并补齐烟闪。`);
        if (openingDeath) suggestions.push('第一身位先要闪或先架枪，避免无补枪首死。');
        if (missing.length) suggestions.push('先补齐战术模板要求的出生位、区域控制和道具，再执行爆点。');
    } else {
        if (openingCredit) {
            credits.push(`${openingCredit.name} 用 ${openingCredit.weapon || '未知武器'} 打开局面，拿到本回合首杀。`);
        } else if (result.facts?.planted_site) {
            credits.push(`本回合最终在 ${result.facts.planted_site} 点完成下包，进攻转化成功。`);
        } else {
            credits.push('本回合取得胜利，但首杀/下包归属样本不足。');
        }
        if (followedPlan) credits.push(`实际进攻方向与建议的 ${recommendation.primary_site} 点一致。`);
        suggestions.push('保留本回合有效的出生位、道具顺序和首杀节奏，但不要固定成每回合不变。');
    }
    return {
        outcome,
        actual_site: actualSite,
        actual_primary_tactic_id: result.primary_tactic_id || null,
        followed_plan: followedPlan,
        economy: { own: ownEconomy, enemy: enemyEconomy },
        opening_credit: openingCredit,
        opening_death: openingDeath,
        credits,
        causes,
        suggestions
    };
}

function buildMatchSummary(payload, ownTeam, options = {}) {
    const own = ownTeam?.mode ? ownTeam : tactics.resolveTeam(payload, ownTeam);
    if (own.mode === 'unknown') return { status: 'invalid_team', team: ownTeam || null };
    const opponent = opponentRoster(payload, own);
    const maxRounds = Math.max(1, Math.min(Number(options.maxRounds) || 10, 30));
    const ownMatch = tactics.analyzeTeamMatch(payload, own, { maxRounds: 30 });
    const tRounds = ownMatch.rounds.filter((round) => round.team_side === 'T').slice(0, maxRounds);
    const recommendations = tRounds.map((round) => {
        const recommendation = recommendSite(payload, own, round.round_num, {
            scoutRounds: options.scoutRounds || 6
        });
        if (recommendation.status === 'ok') recommendation.review = roundReview(payload, own, round.round_num, recommendation);
        return recommendation;
    });
    const profile = opponent.mode === 'roster'
        ? buildCtDefenseProfile(payload, opponent, { scoutRounds: options.scoutRounds || 6 })
        : { status: 'opponent_not_found' };
    return {
        status: 'ok',
        map: ownMatch.map,
        own_team: { label: own.label, team_clan_name: own.teamClanName || null, steamids: own.steamIds ? [...own.steamIds] : null },
        opponent_team: { label: opponent.label, team_clan_name: opponent.teamClanName || null, steamids: opponent.steamIds ? [...opponent.steamIds] : null },
        scout_defense_profile: profile,
        own_tactic_summary: ownMatch.summary,
        round_recommendations: recommendations,
        limitations: [
            'Dust2 only; callout polygons are still draft.',
            'Recommendations use only observed facts and do not estimate a calibrated win probability.',
            'Voices, comms and player intent are not available in the demo.',
            'Smoke coverage/LOS and pre-aim are not yet computed.'
        ]
    };
}

module.exports = {
    SITE_GROUPS,
    sideForZone,
    initialLayout,
    ctRoundFeatures,
    buildCtDefenseProfile,
    recommendSite,
    buildMatchSummary,
    economyFor,
    teamUtility,
    ownSiteHistory
};
