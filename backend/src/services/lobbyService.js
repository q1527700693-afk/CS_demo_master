'use strict';

const { db } = require('../config/database');
const { errors } = require('../utils/response');

// --- limits and allowed values --------------------------------------------- //
const TITLE_MAX_LENGTH = 60;
const DESCRIPTION_MAX_LENGTH = 300;
const SHORT_TEXT_MAX_LENGTH = 32;
const TEAM_CODE_MIN_LENGTH = 4;
const TEAM_CODE_MAX_LENGTH = 64;
const TEAM_SIZE_MIN = 2;
const TEAM_SIZE_MAX = 10;
const DEFAULT_TTL_HOURS = 24;
const MAX_TTL_HOURS = 24 * 365;
const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 50;

const LOBBY_MODES = Object.freeze(['competitive', 'premier', 'wingman']);
const CREATE_FIELDS = new Set([
    'title',
    'description',
    'mode',
    'map',
    'region',
    'skill_level',
    'team_size',
    'current_players',
    'team_code',
]);

// --------------------------------------------------------------------------- //
// validation helpers
// --------------------------------------------------------------------------- //

function normalizeText(value, maxLength, field, { required = false } = {}) {
    if (value === null || value === undefined) {
        if (required) {
            throw errors.invalidParameter(`${field} is required`);
        }
        return null;
    }
    if (typeof value !== 'string') {
        throw errors.invalidParameter(`${field} must be a string`);
    }

    const text = value.trim();
    if (!text) {
        if (required) {
            throw errors.invalidParameter(`${field} is required`);
        }
        return null;
    }
    if (text.length > maxLength) {
        throw errors.invalidParameter(`${field} must be at most ${maxLength} characters`);
    }
    return text;
}

function normalizeMode(value) {
    if (value === undefined) {
        return 'competitive';
    }
    if (typeof value !== 'string' || !LOBBY_MODES.includes(value)) {
        throw errors.invalidParameter(`mode must be one of: ${LOBBY_MODES.join(', ')}`);
    }
    return value;
}

function normalizeTeamSize(value) {
    if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < TEAM_SIZE_MIN ||
        value > TEAM_SIZE_MAX
    ) {
        throw errors.invalidParameter(
            `team_size must be an integer between ${TEAM_SIZE_MIN} and ${TEAM_SIZE_MAX}`
        );
    }
    return value;
}

function normalizeCurrentPlayers(value, teamSize) {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw errors.invalidParameter('current_players must be an integer');
    }
    if (value < 1 || value >= teamSize) {
        throw errors.invalidParameter(
            `current_players must be between 1 and ${teamSize - 1} for a ${teamSize} player team`
        );
    }
    return value;
}

function normalizeTeamCode(value) {
    if (value === null || value === undefined) {
        throw errors.invalidParameter('team_code is required');
    }
    if (typeof value !== 'string') {
        throw errors.invalidParameter('team_code must be a string');
    }
    const code = value.trim();
    if (code.length < TEAM_CODE_MIN_LENGTH || code.length > TEAM_CODE_MAX_LENGTH) {
        throw errors.invalidParameter(
            `team_code must be ${TEAM_CODE_MIN_LENGTH}-${TEAM_CODE_MAX_LENGTH} characters`
        );
    }
    if (/[\u0000-\u001f\u007f]/.test(code)) {
        throw errors.invalidParameter('team_code must not contain control characters');
    }
    return code;
}

function parsePositiveInteger(value, fallback, field, maximum) {
    if (value === undefined) {
        return fallback;
    }
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
        throw errors.invalidParameter(`${field} must be a positive integer`);
    }

    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1) {
        throw errors.invalidParameter(`${field} must be a positive integer`);
    }
    if (maximum && number > maximum) {
        throw errors.invalidParameter(`${field} must be at most ${maximum}`);
    }
    return number;
}

function queryString(value, field) {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'string') {
        throw errors.invalidParameter(`${field} must be a single value`);
    }
    return value;
}

function parseFilters(query) {
    const page = parsePositiveInteger(query.page, 1, 'page');
    const pageSize = parsePositiveInteger(
        query.pageSize,
        PAGE_SIZE_DEFAULT,
        'pageSize',
        PAGE_SIZE_MAX
    );

    let mode;
    if (query.mode !== undefined) {
        mode = queryString(query.mode, 'mode');
        if (!LOBBY_MODES.includes(mode)) {
            throw errors.invalidParameter(`mode must be one of: ${LOBBY_MODES.join(', ')}`);
        }
    }

    return { page, pageSize, mode };
}

function lobbyId(value) {
    const numericId = Number(value);
    if (!Number.isInteger(numericId) || numericId <= 0) {
        throw errors.notFound('Lobby not found');
    }
    return numericId;
}

function claimantUserId(value) {
    const numericId = Number(value);
    if (!Number.isInteger(numericId) || numericId <= 0) {
        throw errors.notFound('Claimant not found');
    }
    return numericId;
}

// --------------------------------------------------------------------------- //
// expiry
// --------------------------------------------------------------------------- //

function ttlHours() {
    const configured = Number(process.env.LOBBY_TTL_HOURS);
    if (!Number.isFinite(configured) || configured <= 0) {
        return DEFAULT_TTL_HOURS;
    }
    return Math.min(configured, MAX_TTL_HOURS);
}

function nextExpiry(now = new Date()) {
    return new Date(now.getTime() + ttlHours() * 60 * 60 * 1000).toISOString();
}

/** Lazy cleanup: every public lobby operation removes expired posts. */
function purgeExpiredLobbies(now = new Date().toISOString()) {
    db.prepare('DELETE FROM lobbies WHERE expires_at IS NULL OR expires_at <= ?').run(now);
}

// --------------------------------------------------------------------------- //
// row helpers
// --------------------------------------------------------------------------- //

const LOBBY_SELECT = `
    SELECT
        l.*,
        u.username    AS owner_username,
        u.nickname    AS owner_nickname,
        u.avatar_url  AS owner_avatar_url,
        p.skill_level AS owner_skill_level,
        (SELECT COUNT(*) FROM lobby_claims c
          WHERE c.lobby_id = l.id AND c.status = 'claimed') AS claim_count,
        EXISTS (
            SELECT 1 FROM lobby_claims vc
            WHERE vc.lobby_id = l.id AND vc.user_id = ? AND vc.status = 'claimed'
        ) AS viewer_claimed
    FROM lobbies l
    JOIN users u ON u.id = l.owner_id
    LEFT JOIN user_profiles p ON p.user_id = l.owner_id
`;

function findLobby(value) {
    const id = lobbyId(value);
    const lobby = db.prepare('SELECT * FROM lobbies WHERE id = ?').get(id);
    if (!lobby) {
        throw errors.notFound('Lobby not found');
    }
    return lobby;
}

function findLobbyWithViewer(value, viewer) {
    const id = lobbyId(value);
    const row = db
        .prepare(`${LOBBY_SELECT} WHERE l.id = ?`)
        .get(viewer ? viewer.id : null, id);
    if (!row) {
        throw errors.notFound('Lobby not found');
    }
    return row;
}

function claimRow(lobbyIdValue, userId) {
    return db
        .prepare('SELECT * FROM lobby_claims WHERE lobby_id = ? AND user_id = ?')
        .get(lobbyIdValue, userId);
}

function getClaims(lobbyIdValue) {
    return db
        .prepare(
            `SELECT
                 c.user_id,
                 c.claimed_at,
                 u.username,
                 u.nickname,
                 u.avatar_url,
                 p.skill_level
             FROM lobby_claims c
             JOIN users u ON u.id = c.user_id
             LEFT JOIN user_profiles p ON p.user_id = c.user_id
             WHERE c.lobby_id = ? AND c.status = 'claimed'
             ORDER BY c.claimed_at ASC, c.user_id ASC`
        )
        .all(lobbyIdValue);
}

function getClaimsForLobbies(ids) {
    const byLobby = new Map(ids.map((id) => [id, []]));
    if (ids.length === 0) {
        return byLobby;
    }

    const placeholders = ids.map(() => '?').join(', ');
    const rows = db
        .prepare(
            `SELECT
                 c.lobby_id,
                 c.user_id,
                 c.claimed_at,
                 u.username,
                 u.nickname,
                 u.avatar_url,
                 p.skill_level
             FROM lobby_claims c
             JOIN users u ON u.id = c.user_id
             LEFT JOIN user_profiles p ON p.user_id = c.user_id
             WHERE c.lobby_id IN (${placeholders}) AND c.status = 'claimed'
             ORDER BY c.lobby_id ASC, c.claimed_at ASC, c.user_id ASC`
        )
        .all(...ids);

    for (const row of rows) {
        byLobby.get(row.lobby_id).push(row);
    }
    return byLobby;
}

function touchLobby(id, now = new Date().toISOString()) {
    db.prepare('UPDATE lobbies SET updated_at = ? WHERE id = ?').run(now, id);
}

// --------------------------------------------------------------------------- //
// serialisation
// --------------------------------------------------------------------------- //

function serializeClaim(claim, viewer) {
    return {
        user_id: claim.user_id,
        username: claim.username,
        nickname: claim.nickname,
        avatar_url: claim.avatar_url || null,
        skill_level: claim.skill_level || null,
        claimed_at: claim.claimed_at,
        is_you: Boolean(viewer && viewer.id === claim.user_id),
    };
}

function serializeLobby(row, viewer, claims) {
    const isOwner = Boolean(viewer && viewer.id === row.owner_id);
    const isClaimed = Boolean(row.viewer_claimed);
    const slotsNeeded = Math.max(0, row.team_size - row.current_players);
    const owner = {
        user_id: row.owner_id,
        username: row.owner_username,
        nickname: row.owner_nickname,
        avatar_url: row.owner_avatar_url || null,
        skill_level: row.owner_skill_level || null,
    };

    return {
        id: row.id,
        title: row.title,
        description: row.description,
        mode: row.mode,
        map: row.map,
        region: row.region,
        skill_level: row.skill_level,
        team_size: row.team_size,
        current_players: row.current_players,
        slots_needed: slotsNeeded,
        claim_count: row.claim_count,
        status: row.departed_at ? 'departed' : 'open',
        // The code is the product: only the owner and users who have claimed
        // it can read it back from list/detail. The claim response returns it
        // explicitly as `team_code` too.
        team_code: isOwner || isClaimed ? row.team_code : null,
        owner_id: row.owner_id,
        owner,
        is_owner: isOwner,
        is_claimed: isClaimed,
        can_claim: !row.departed_at && !isOwner && !isClaimed && slotsNeeded > 0,
        expires_at: row.expires_at,
        departed_at: row.departed_at || null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        claimants: claims.map((claim) => serializeClaim(claim, viewer)),
    };
}

// --------------------------------------------------------------------------- //
// public API of this service
// --------------------------------------------------------------------------- //

function createLobby(user, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw errors.invalidParameter('Request body must be a JSON object');
    }
    for (const key of Object.keys(payload)) {
        if (!CREATE_FIELDS.has(key)) {
            throw errors.invalidParameter(`Unknown field: ${key}`);
        }
    }

    const title = normalizeText(payload.title, TITLE_MAX_LENGTH, 'title', { required: true });
    const description = normalizeText(
        payload.description,
        DESCRIPTION_MAX_LENGTH,
        'description'
    );
    const mode = normalizeMode(payload.mode);
    const map = normalizeText(payload.map, SHORT_TEXT_MAX_LENGTH, 'map');
    const region = normalizeText(payload.region, SHORT_TEXT_MAX_LENGTH, 'region');
    const skillLevel = normalizeText(payload.skill_level, SHORT_TEXT_MAX_LENGTH, 'skill_level');
    const teamSize = normalizeTeamSize(payload.team_size);
    const currentPlayers = normalizeCurrentPlayers(payload.current_players, teamSize);
    const teamCode = normalizeTeamCode(payload.team_code);
    const nowDate = new Date();
    const now = nowDate.toISOString();
    const expiresAt = nextExpiry(nowDate);

    purgeExpiredLobbies(now);

    const info = db
        .prepare(
            `INSERT INTO lobbies
                 (owner_id, title, description, mode, map, region, skill_level,
                  team_size, current_players, team_code, expires_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
            user.id,
            title,
            description,
            mode,
            map,
            region,
            skillLevel,
            teamSize,
            currentPlayers,
            teamCode,
            expiresAt,
            now,
            now
        );

    return getLobby(Number(info.lastInsertRowid), user);
}

function listLobbies(query, viewer) {
    const filters = parseFilters(query || {});
    const now = new Date().toISOString();
    purgeExpiredLobbies(now);

    const conditions = [
        'l.current_players < l.team_size',
        'l.expires_at > ?',
        'l.departed_at IS NULL',
    ];
    const filterParameters = [now];
    if (filters.mode) {
        conditions.push('l.mode = ?');
        filterParameters.push(filters.mode);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const total = db
        .prepare(`SELECT COUNT(*) AS total FROM lobbies l ${where}`)
        .get(...filterParameters).total;
    const offset = (filters.page - 1) * filters.pageSize;
    const rows = db
        .prepare(
            `${LOBBY_SELECT}
             ${where}
             ORDER BY l.created_at DESC, l.id DESC
             LIMIT ? OFFSET ?`
        )
        .all(viewer ? viewer.id : null, ...filterParameters, filters.pageSize, offset);

    const claimsByLobby = getClaimsForLobbies(rows.map((row) => row.id));

    return {
        items: rows.map((row) => serializeLobby(row, viewer, claimsByLobby.get(row.id))),
        page: filters.page,
        pageSize: filters.pageSize,
        total,
    };
}

function getLobby(value, viewer = null) {
    purgeExpiredLobbies();
    const row = findLobbyWithViewer(value, viewer);
    // "发车" hides the post from everyone except its owner.
    if (row.departed_at && !(viewer && viewer.id === row.owner_id)) {
        throw errors.notFound('Lobby not found');
    }
    return serializeLobby(row, viewer, getClaims(row.id));
}

function claimLobby(user, value) {
    purgeExpiredLobbies();
    const lobby = findLobby(value);

    if (lobby.departed_at) {
        throw errors.notFound('Lobby not found');
    }
    if (lobby.owner_id === user.id) {
        throw errors.forbidden(
            'You are the owner of this lobby; the team code is already visible to you'
        );
    }

    const existing = claimRow(lobby.id, user.id);
    if (existing && existing.status === 'kicked') {
        throw errors.forbidden('You were removed from this lobby by the owner');
    }
    if (!existing && lobby.current_players >= lobby.team_size) {
        throw errors.conflict('This team is already full');
    }

    const claimedAt = existing ? existing.claimed_at : new Date().toISOString();
    if (!existing) {
        db.prepare(
            `INSERT INTO lobby_claims (lobby_id, user_id, claimed_at, status)
             VALUES (?, ?, ?, 'claimed')`
        ).run(lobby.id, user.id, claimedAt);
        touchLobby(lobby.id, claimedAt);
    }

    return {
        team_code: lobby.team_code,
        lobby_id: lobby.id,
        claimed_at: claimedAt,
        lobby: getLobby(lobby.id, user),
    };
}

function cancelClaim(user, value) {
    purgeExpiredLobbies();
    const lobby = findLobby(value);
    if (lobby.departed_at) {
        throw errors.notFound('Lobby not found');
    }

    const claim = claimRow(lobby.id, user.id);
    if (!claim || claim.status !== 'claimed') {
        throw errors.notFound('You have not claimed this lobby');
    }

    const now = new Date().toISOString();
    db.prepare('DELETE FROM lobby_claims WHERE lobby_id = ? AND user_id = ?').run(
        lobby.id,
        user.id
    );
    touchLobby(lobby.id, now);

    return getLobby(lobby.id, user);
}

function departLobby(user, value) {
    purgeExpiredLobbies();
    const lobby = findLobby(value);
    if (lobby.owner_id !== user.id) {
        throw errors.forbidden('Only the lobby owner can depart the lobby');
    }

    if (!lobby.departed_at) {
        const now = new Date().toISOString();
        db.prepare(
            'UPDATE lobbies SET departed_at = ?, updated_at = ? WHERE id = ?'
        ).run(now, now, lobby.id);
    }

    return getLobby(lobby.id, user);
}

function kickClaimant(user, value, targetValue) {
    purgeExpiredLobbies();
    const lobby = findLobby(value);
    if (lobby.owner_id !== user.id) {
        throw errors.forbidden('Only the lobby owner can kick a claimant');
    }

    const targetId = claimantUserId(targetValue);
    const claim = claimRow(lobby.id, targetId);
    if (!claim || claim.status !== 'claimed') {
        throw errors.notFound('This user has not claimed this lobby');
    }

    const now = new Date().toISOString();
    db.prepare(
        `UPDATE lobby_claims
         SET status = 'kicked', kicked_at = ?
         WHERE lobby_id = ? AND user_id = ?`
    ).run(now, lobby.id, targetId);
    touchLobby(lobby.id, now);

    return getLobby(lobby.id, user);
}

function deleteLobby(user, value) {
    purgeExpiredLobbies();
    const lobby = findLobby(value);
    if (lobby.owner_id !== user.id) {
        throw errors.forbidden('Only the lobby owner can delete the lobby');
    }

    db.prepare('DELETE FROM lobbies WHERE id = ?').run(lobby.id);
    return { id: lobby.id };
}

module.exports = {
    LOBBY_MODES,
    TEAM_SIZE_MIN,
    TEAM_SIZE_MAX,
    TEAM_CODE_MIN_LENGTH,
    TEAM_CODE_MAX_LENGTH,
    DEFAULT_TTL_HOURS,
    PAGE_SIZE_DEFAULT,
    PAGE_SIZE_MAX,
    createLobby,
    listLobbies,
    getLobby,
    claimLobby,
    cancelClaim,
    departLobby,
    kickClaimant,
    deleteLobby,
};
