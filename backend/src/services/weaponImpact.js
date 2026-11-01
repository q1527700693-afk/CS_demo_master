'use strict';

/**
 * Extract weapon/economy highlights from a parsed demo.
 *
 * The goal is not to rank players by K/D. It is to surface explainable moments
 * such as:
 *   - an eco/force round opened by an R8 or Deagle kill;
 *   - an SMG/shotgun player finding timing and getting multiple kills;
 *   - a low-cost weapon producing first blood.
 *
 * The output is deliberately compact and evidence-linked so the AI can mention
 * it without inventing weapon facts.
 */

const SCHEMA_VERSION = 'weapon-impact-0.1.0';

const WEAPONS = {
    ak47: { label: 'AK-47', category: 'rifle', cost: 2700, common: true },
    m4a1: { label: 'M4A4', category: 'rifle', cost: 3100, common: true },
    m4a1_silencer: { label: 'M4A1-S', category: 'rifle', cost: 2900, common: true },
    famas: { label: 'FAMAS', category: 'rifle', cost: 2050, common: true },
    galilar: { label: 'Galil AR', category: 'rifle', cost: 1800, common: true },
    aug: { label: 'AUG', category: 'rifle', cost: 3300, common: true },
    sg556: { label: 'SG 553', category: 'rifle', cost: 3000, common: true },
    awp: { label: 'AWP', category: 'awp', cost: 4750, common: true },
    ssg08: { label: 'SSG 08', category: 'sniper', cost: 1700, common: false },
    g3sg1: { label: 'G3SG1', category: 'sniper', cost: 5000, common: false },
    scar20: { label: 'SCAR-20', category: 'sniper', cost: 5000, common: false },
    revolver: { label: 'R8 Revolver', category: 'pistol', cost: 600, common: false, offMeta: true },
    deagle: { label: 'Desert Eagle', category: 'pistol', cost: 700, common: false, special: true },
    elite: { label: 'Dual Berettas', category: 'pistol', cost: 300, common: false, offMeta: true },
    fiveseven: { label: 'Five-SeveN', category: 'pistol', cost: 500, common: false },
    tec9: { label: 'Tec-9', category: 'pistol', cost: 500, common: false, offMeta: true },
    cz75a: { label: 'CZ75-Auto', category: 'pistol', cost: 500, common: false },
    p250: { label: 'P250', category: 'pistol', cost: 300, common: false },
    glock: { label: 'Glock-18', category: 'pistol', cost: 200, common: true },
    usp_silencer: { label: 'USP-S', category: 'pistol', cost: 200, common: true },
    hkp2000: { label: 'P2000', category: 'pistol', cost: 200, common: true },
    p2000: { label: 'P2000', category: 'pistol', cost: 200, common: true },
    mac10: { label: 'MAC-10', category: 'smg', cost: 1050, common: true },
    mp9: { label: 'MP9', category: 'smg', cost: 1250, common: true },
    mp7: { label: 'MP7', category: 'smg', cost: 1500, common: true },
    mp5sd: { label: 'MP5-SD', category: 'smg', cost: 1500, common: true },
    ump45: { label: 'UMP-45', category: 'smg', cost: 1200, common: true },
    bizon: { label: 'PP-Bizon', category: 'smg', cost: 1400, common: false },
    p90: { label: 'P90', category: 'smg', cost: 2350, common: false },
    nova: { label: 'Nova', category: 'shotgun', cost: 1050, common: false, offMeta: true },
    xm1014: { label: 'XM1014', category: 'shotgun', cost: 2000, common: false },
    mag7: { label: 'MAG-7', category: 'shotgun', cost: 1300, common: false, offMeta: true },
    sawedoff: { label: 'Sawed-Off', category: 'shotgun', cost: 1100, common: false, offMeta: true },
    negev: { label: 'Negev', category: 'heavy', cost: 1700, common: false, offMeta: true },
    m249: { label: 'M249', category: 'heavy', cost: 5200, common: false, offMeta: true },
    hegrenade: { label: 'HE Grenade', category: 'utility', cost: 300, common: true },
    inferno: { label: 'Incendiary', category: 'utility', cost: 600, common: true },
    molotov: { label: 'Molotov', category: 'utility', cost: 400, common: true },
    flashbang: { label: 'Flashbang', category: 'utility', cost: 200, common: true },
    smokegrenade: { label: 'Smoke Grenade', category: 'utility', cost: 300, common: true },
    decoy: { label: 'Decoy', category: 'utility', cost: 50, common: false },
    taser: { label: 'Zeus x27', category: 'utility', cost: 200, common: false },
    knife: { label: 'Knife', category: 'melee', cost: 0, common: true },
    planted_c4: { label: 'Bomb', category: 'objective', cost: 0, common: true }
};

function normalizeSide(side) {
    const value = String(side || '').toLowerCase();
    if (value === 't' || value === 'terrorist' || value === 'terrorists') return 'T';
    if (value === 'ct' || value === 'counter-terrorist' || value === 'counterterrorist' || value === 'counter_terrorist') return 'CT';
    return null;
}

function normalizeWeapon(value) {
    return String(value || '').toLowerCase()
        .replace(/^weapon_/, '')
        .replace(/_vip$/, '');
}

function weaponInfo(value) {
    const id = normalizeWeapon(value);
    return { id, ...(WEAPONS[id] || { label: id || 'unknown', category: 'other', cost: null, common: false }) };
}

function playerMaps(payload) {
    const byId = new Map();
    const byName = new Map();
    for (const player of payload?.players || []) {
        if (player.steamid) byId.set(String(player.steamid), player);
        if (player.name) byName.set(String(player.name), player);
    }
    for (const kill of payload?.kills || []) {
        if (kill.attacker_steamid && !byId.has(String(kill.attacker_steamid))) {
            byId.set(String(kill.attacker_steamid), { steamid: String(kill.attacker_steamid), name: kill.attacker_name, side: kill.attacker_side });
        }
    }
    return { byId, byName };
}

function economyMap(payload) {
    const map = new Map();
    for (const row of payload?.round_economy || []) {
        const side = normalizeSide(row.side);
        if (!side) continue;
        map.set(`${Number(row.round_num)}:${side}`, {
            buy_type: row.buy_type || null,
            equipment_value: Number.isFinite(Number(row.equipment_value)) ? Number(row.equipment_value) : null,
            players: Number(row.n_players) || null
        });
    }
    return map;
}

function isLowEconomy(buyType) {
    return ['eco', 'pistol', 'force'].includes(String(buyType || '').toLowerCase());
}

function isStrongBuy(buyType) {
    return ['full', 'force'].includes(String(buyType || '').toLowerCase());
}

function extractWeaponTransitions(payload, limit = 80) {
    const grouped = new Map();
    for (const sample of payload?.all_player_samples || []) {
        const weapon = sample?.active_weapon ? normalizeWeapon(sample.active_weapon) : null;
        if (!weapon) continue;
        const key = `${sample.steamid}:${sample.round_num}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(sample);
    }
    const transitions = [];
    for (const samples of grouped.values()) {
        samples.sort((a, b) => Number(a.tick) - Number(b.tick));
        for (let index = 1; index < samples.length; index += 1) {
            const previous = normalizeWeapon(samples[index - 1].active_weapon);
            const current = normalizeWeapon(samples[index].active_weapon);
            const previousInfo = weaponInfo(previous);
            const currentInfo = weaponInfo(current);
            if (!previous || !current || previous === current) continue;
            if (['melee', 'utility', 'objective', 'other'].includes(previousInfo.category) ||
                ['melee', 'utility', 'objective', 'other'].includes(currentInfo.category)) continue;
            transitions.push({
                steamid: String(samples[index].steamid),
                player_name: samples[index].name || null,
                round_num: Number(samples[index].round_num),
                tick: Number(samples[index].tick),
                from_weapon: previous,
                to_weapon: current,
                from_label: previousInfo.label,
                to_label: currentInfo.label,
                confidence: 'sampled',
                kind: 'weapon_change_in_snapshots'
            });
        }
    }
    return transitions.sort((a, b) => a.tick - b.tick).slice(0, limit);
}

function extractWeaponImpact(payload) {
    const players = playerMaps(payload);
    const economy = economyMap(payload);
    const sortedKills = [...(payload?.kills || [])]
        .filter((kill) => kill.attacker_steamid)
        .sort((a, b) => Number(a.tick) - Number(b.tick));
    const firstBlood = new Set();
    const seenRounds = new Set();
    for (const kill of sortedKills) {
        const round = Number(kill.round_num);
        if (seenRounds.has(round)) continue;
        seenRounds.add(round);
        firstBlood.add(kill.event_id);
    }
    const multiKillRounds = new Map();
    for (const kill of sortedKills) {
        const key = `${kill.attacker_steamid}:${kill.round_num}`;
        multiKillRounds.set(key, (multiKillRounds.get(key) || 0) + 1);
    }
    const buckets = new Map();
    for (const kill of sortedKills) {
        const weapon = weaponInfo(kill.weapon);
        if (!weapon.id || weapon.category === 'objective') continue;
        const attackerSide = normalizeSide(kill.attacker_side) || normalizeSide(players.byId.get(String(kill.attacker_steamid))?.side);
        if (!attackerSide) continue;
        const enemySide = attackerSide === 'T' ? 'CT' : 'T';
        const ownEconomy = economy.get(`${Number(kill.round_num)}:${attackerSide}`) || {};
        const enemyEconomy = economy.get(`${Number(kill.round_num)}:${enemySide}`) || {};
        const lowEconomy = isLowEconomy(ownEconomy.buy_type);
        const enemyStrong = isStrongBuy(enemyEconomy.buy_type);
        const key = `${kill.attacker_steamid}:${weapon.id}`;
        const current = buckets.get(key) || {
            steamid: String(kill.attacker_steamid),
            player_name: kill.attacker_name || players.byId.get(String(kill.attacker_steamid))?.name || String(kill.attacker_steamid),
            side: attackerSide,
            team_clan_name: players.byId.get(String(kill.attacker_steamid))?.team_clan_name || null,
            weapon: weapon.id,
            weapon_label: weapon.label,
            category: weapon.category,
            cost: weapon.cost,
            off_meta: Boolean(weapon.offMeta),
            special: Boolean(weapon.special),
            kills: 0,
            headshots: 0,
            first_bloods: 0,
            economy_kills: 0,
            enemy_full_kills: 0,
            low_cost_kills: 0,
            multi_kill_rounds: 0,
            rounds: new Set(),
            evidence_ids: new Set(),
            buy_types: new Set()
        };
        current.kills += 1;
        current.headshots += kill.headshot ? 1 : 0;
        if (firstBlood.has(kill.event_id)) current.first_bloods += 1;
        if (lowEconomy) {
            current.economy_kills += 1;
            current.buy_types.add(String(ownEconomy.buy_type || 'unknown'));
        }
        if (enemyStrong) current.enemy_full_kills += 1;
        if (weapon.cost !== null && weapon.cost <= 1500) current.low_cost_kills += 1;
        current.rounds.add(Number(kill.round_num));
        if (kill.event_id) current.evidence_ids.add(kill.event_id);
        buckets.set(key, current);
    }

    const playerBuckets = new Map();
    for (const bucket of buckets.values()) {
        bucket.multi_kill_rounds = [...bucket.rounds].filter((round) =>
            (multiKillRounds.get(`${bucket.steamid}:${round}`) || 0) >= 2
        ).length;
        bucket.impact_score = bucket.kills * 2 +
            bucket.first_bloods * 5 +
            bucket.economy_kills * 3 +
            bucket.multi_kill_rounds * 4 +
            bucket.headshots * 0.5 +
            (bucket.off_meta ? 3 : 0) +
            (bucket.low_cost_kills ? 2 : 0);
        bucket.rounds = [...bucket.rounds].sort((a, b) => a - b);
        bucket.evidence_ids = [...bucket.evidence_ids];
        bucket.buy_types = [...bucket.buy_types];
        playerBuckets.set(bucket.steamid, playerBuckets.get(bucket.steamid) || []);
        playerBuckets.get(bucket.steamid).push(bucket);
    }

    const notableWeapon = (bucket) => bucket.off_meta || bucket.special ||
        ['smg', 'shotgun'].includes(bucket.category) ||
        bucket.weapon === 'deagle' || bucket.weapon === 'revolver';
    const highlightCondition = (bucket) => bucket.first_bloods > 0 ||
        bucket.economy_kills > 0 ||
        bucket.multi_kill_rounds > 0 ||
        bucket.kills >= 2;
    const highlights = [];
    for (const bucket of buckets.values()) {
        if (!notableWeapon(bucket) || !highlightCondition(bucket)) continue;
        const reasons = [];
        if (bucket.off_meta) reasons.push(`${bucket.weapon_label} 属于冷门/非常规选择`);
        if (bucket.economy_kills > 0) reasons.push(`在 ${bucket.buy_types.join('/')} 局拿到 ${bucket.economy_kills} 杀`);
        if (bucket.first_bloods > 0) reasons.push(`其中 ${bucket.first_bloods} 次首杀`);
        if (bucket.multi_kill_rounds > 0) reasons.push(`${bucket.multi_kill_rounds} 个回合完成多杀`);
        if (bucket.low_cost_kills > 0 && bucket.cost !== null) reasons.push(`武器成本约 $${bucket.cost}`);
        if (bucket.enemy_full_kills > 0) reasons.push(`有 ${bucket.enemy_full_kills} 杀发生在对手较强经济回合`);
        highlights.push({
            steamid: bucket.steamid,
            player_name: bucket.player_name,
            side: bucket.side,
            team_clan_name: bucket.team_clan_name,
            weapon: bucket.weapon,
            weapon_label: bucket.weapon_label,
            category: bucket.category,
            cost: bucket.cost,
            kills: bucket.kills,
            headshots: bucket.headshots,
            first_bloods: bucket.first_bloods,
            economy_kills: bucket.economy_kills,
            low_cost_kills: bucket.low_cost_kills,
            multi_kill_rounds: bucket.multi_kill_rounds,
            rounds: bucket.rounds,
            evidence_ids: bucket.evidence_ids,
            impact_score: Math.round(bucket.impact_score * 10) / 10,
            reason: reasons.join('；') || '低成本武器产生了可点评的击杀。'
        });
    }
    highlights.sort((a, b) => b.impact_score - a.impact_score || b.kills - a.kills);

    const playerProfiles = [...playerBuckets.entries()].map(([steamid, list]) => {
        const player = players.byId.get(String(steamid)) || {};
        const top = [...list].sort((a, b) => b.kills - a.kills || b.impact_score - a.impact_score).slice(0, 3);
        return {
            steamid: String(steamid),
            name: player.name || list[0].player_name,
            side: player.side ? normalizeSide(player.side) : list[0].side,
            team_clan_name: player.team_clan_name || list[0].team_clan_name || null,
            top_weapons: top.map((item) => ({
                weapon: item.weapon,
                weapon_label: item.weapon_label,
                category: item.category,
                kills: item.kills,
                headshots: item.headshots,
                first_bloods: item.first_bloods,
                economy_kills: item.economy_kills,
                evidence_ids: item.evidence_ids
            }))
        };
    });

    const playerWeaponImpact = [...playerBuckets.entries()].map(([steamid, list]) => {
        const player = players.byId.get(String(steamid)) || {};
        const playerHighlights = highlights.filter((item) => item.steamid === String(steamid));
        return {
            steamid: String(steamid),
            name: player.name || list[0].player_name,
            team_clan_name: player.team_clan_name || list[0].team_clan_name || null,
            side: player.side ? normalizeSide(player.side) : list[0].side,
            kills: list.reduce((sum, item) => sum + item.kills, 0),
            headshots: list.reduce((sum, item) => sum + item.headshots, 0),
            first_bloods: list.reduce((sum, item) => sum + item.first_bloods, 0),
            economy_kills: list.reduce((sum, item) => sum + item.economy_kills, 0),
            low_cost_kills: list.reduce((sum, item) => sum + item.low_cost_kills, 0),
            special_highlight_count: playerHighlights.length,
            weapon_impact_score: Math.round(list.reduce((sum, item) => sum + item.impact_score, 0) * 10) / 10,
            top_weapons: [...list].sort((a, b) => b.kills - a.kills || b.impact_score - a.impact_score).slice(0, 3).map((item) => ({
                weapon: item.weapon,
                weapon_label: item.weapon_label,
                category: item.category,
                kills: item.kills,
                first_bloods: item.first_bloods,
                economy_kills: item.economy_kills
            }))
        };
    }).sort((a, b) => b.weapon_impact_score - a.weapon_impact_score);

    const weaponTransitions = extractWeaponTransitions(payload);
    return {
        schema_version: SCHEMA_VERSION,
        demo_sha256: payload?.demo?.sha256 || null,
        map: payload?.header?.map_name || null,
        highlights,
        player_profiles: playerWeaponImpact.map((item) => ({
            steamid: item.steamid,
            name: item.name,
            side: item.side,
            team_clan_name: item.team_clan_name,
            top_weapons: item.top_weapons
        })),
        player_weapon_impact: playerWeaponImpact,
        weapon_transitions: weaponTransitions,
        limitations: [
            'Weapon highlights are candidate signals, not a complete player rating.',
            'A kill in an eco round is not automatically a mistake by the opponent.',
            'Weapon prices are approximate CS2 values.',
            'weapon_transitions are sampled from snapshots; they are not proof of pickup/drop intent.'
        ]
    };
}

module.exports = {
    SCHEMA_VERSION,
    WEAPONS,
    normalizeWeapon,
    weaponInfo,
    extractWeaponImpact,
    extractWeaponTransitions
};
