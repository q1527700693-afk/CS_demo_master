'use strict';

const { db } = require('../config/database');
const { errors } = require('../utils/response');

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 50;
const SEARCH_MIN_LENGTH = 2;
const SEARCH_MAX_LENGTH = 32;

// --------------------------------------------------------------------------- //
// validation / small helpers
// --------------------------------------------------------------------------- //

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

function parsePagination(query) {
    return {
        page: parsePositiveInteger(query.page, 1, 'page'),
        pageSize: parsePositiveInteger(query.pageSize, PAGE_SIZE_DEFAULT, 'pageSize', PAGE_SIZE_MAX),
    };
}

function normalizeTargetUserId(value) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        throw errors.invalidParameter('user_id must be a positive integer');
    }
    return value;
}

function requestIdValue(value) {
    const numericId = Number(value);
    if (!Number.isInteger(numericId) || numericId <= 0) {
        throw errors.notFound('Friend request not found');
    }
    return numericId;
}

function pairOf(first, second) {
    return first < second ? [first, second] : [second, first];
}

function escapeLike(value) {
    return value.replace(/[\\%_]/g, '\\$&');
}

function serializeUser(row) {
    return {
        user_id: row.user_id,
        username: row.username,
        nickname: row.nickname,
        avatar_url: row.avatar_url || null,
        skill_level: row.skill_level || null,
        signature: row.signature || null,
        looking_for: row.looking_for || null,
    };
}

// --------------------------------------------------------------------------- //
// lookup helpers
// --------------------------------------------------------------------------- //

function ensureUserExists(userId) {
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) {
        throw errors.notFound('User not found');
    }
    return user;
}

function friendshipBetween(first, second) {
    const [low, high] = pairOf(first, second);
    return db
        .prepare('SELECT * FROM friendships WHERE user_low_id = ? AND user_high_id = ?')
        .get(low, high);
}

function findRequestRow(value) {
    const id = requestIdValue(value);
    const row = db.prepare('SELECT * FROM friendships WHERE id = ?').get(id);
    if (!row) {
        throw errors.notFound('Friend request not found');
    }
    return row;
}

function requireParticipant(row, user) {
    if (row.user_low_id !== user.id && row.user_high_id !== user.id) {
        throw errors.notFound('Friend request not found');
    }
}

const REQUEST_SELECT = `
    SELECT
        f.*,
        CASE WHEN f.user_low_id = ? THEN f.user_high_id ELSE f.user_low_id END AS other_id,
        u.username    AS other_username,
        u.nickname    AS other_nickname,
        u.avatar_url  AS other_avatar_url,
        p.skill_level AS other_skill_level,
        p.bio         AS other_signature,
        p.looking_for AS other_looking_for
    FROM friendships f
    JOIN users u
      ON u.id = CASE WHEN f.user_low_id = ? THEN f.user_high_id ELSE f.user_low_id END
    LEFT JOIN user_profiles p ON p.user_id = u.id
`;

function findRequestWithUser(value, viewer) {
    const id = requestIdValue(value);
    const row = db
        .prepare(`${REQUEST_SELECT} WHERE f.id = ?`)
        .get(viewer.id, viewer.id, id);
    if (!row) {
        throw errors.notFound('Friend request not found');
    }
    return row;
}

function serializeRequest(row, viewer) {
    return {
        id: row.id,
        direction: row.requester_id === viewer.id ? 'outgoing' : 'incoming',
        status: row.status,
        user: {
            user_id: row.other_id,
            username: row.other_username,
            nickname: row.other_nickname,
            avatar_url: row.other_avatar_url || null,
            skill_level: row.other_skill_level || null,
            signature: row.other_signature || null,
            looking_for: row.other_looking_for || null,
        },
        created_at: row.created_at,
        updated_at: row.updated_at,
        accepted_at: row.accepted_at || null,
    };
}

// --------------------------------------------------------------------------- //
// relationship helpers for search
// --------------------------------------------------------------------------- //

function relationshipLabel(row, viewerId) {
    if (!row) {
        return 'none';
    }
    if (row.status === 'accepted') {
        return 'friend';
    }
    return row.requester_id === viewerId ? 'outgoing_request' : 'incoming_request';
}

function relationshipsFor(viewerId, userIds) {
    const relationships = new Map();
    if (userIds.length === 0) {
        return relationships;
    }

    const placeholders = userIds.map(() => '?').join(', ');
    const rows = db
        .prepare(
            `SELECT * FROM friendships
             WHERE (user_low_id = ? AND user_high_id IN (${placeholders}))
                OR (user_high_id = ? AND user_low_id IN (${placeholders}))`
        )
        .all(viewerId, ...userIds, viewerId, ...userIds);

    for (const row of rows) {
        const otherId = row.user_low_id === viewerId ? row.user_high_id : row.user_low_id;
        relationships.set(otherId, row);
    }
    return relationships;
}

// --------------------------------------------------------------------------- //
// user search
// --------------------------------------------------------------------------- //

function searchUsers(query, viewer) {
    const params = query || {};
    const { page, pageSize } = parsePagination(params);
    if (typeof params.q !== 'string') {
        throw errors.invalidParameter(
            `q is required and must be ${SEARCH_MIN_LENGTH}-${SEARCH_MAX_LENGTH} characters`
        );
    }
    const search = params.q.trim();
    if (search.length < SEARCH_MIN_LENGTH || search.length > SEARCH_MAX_LENGTH) {
        throw errors.invalidParameter(
            `q must be ${SEARCH_MIN_LENGTH}-${SEARCH_MAX_LENGTH} characters`
        );
    }

    const pattern = `%${escapeLike(search)}%`;
    const where = `u.id != ?
        AND (u.username LIKE ? ESCAPE '\\'
             OR COALESCE(u.nickname, '') LIKE ? ESCAPE '\\')`;
    const parameters = [viewer.id, pattern, pattern];

    const total = db
        .prepare(`SELECT COUNT(*) AS total FROM users u WHERE ${where}`)
        .get(...parameters).total;
    const offset = (page - 1) * pageSize;
    const rows = db
        .prepare(
            `SELECT
                 u.id AS user_id,
                 u.username,
                 u.nickname,
                 u.avatar_url,
                 p.skill_level,
                 p.bio AS signature,
                 p.looking_for
             FROM users u
             LEFT JOIN user_profiles p ON p.user_id = u.id
             WHERE ${where}
             ORDER BY u.username ASC
             LIMIT ? OFFSET ?`
        )
        .all(...parameters, pageSize, offset);

    const relationships = relationshipsFor(
        viewer.id,
        rows.map((row) => row.user_id)
    );

    return {
        items: rows.map((row) => ({
            ...serializeUser(row),
            relationship: relationshipLabel(relationships.get(row.user_id), viewer.id),
        })),
        page,
        pageSize,
        total,
    };
}

// --------------------------------------------------------------------------- //
// friend requests
// --------------------------------------------------------------------------- //

function sendRequest(user, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw errors.invalidParameter('Request body must be a JSON object');
    }
    for (const key of Object.keys(payload)) {
        if (key !== 'user_id') {
            throw errors.invalidParameter(`Unknown field: ${key}`);
        }
    }

    const targetId = normalizeTargetUserId(payload.user_id);
    if (targetId === user.id) {
        throw errors.invalidParameter('You cannot add yourself as a friend');
    }
    ensureUserExists(targetId);

    const existing = friendshipBetween(user.id, targetId);
    if (existing) {
        if (existing.status === 'accepted') {
            throw errors.conflict('You are already friends with this user');
        }
        if (existing.requester_id === user.id) {
            throw errors.conflict('Friend request already sent');
        }
        throw errors.conflict(
            'This user has already sent you a friend request; accept it instead'
        );
    }

    const [low, high] = pairOf(user.id, targetId);
    const now = new Date().toISOString();
    const info = db
        .prepare(
            `INSERT INTO friendships
                 (user_low_id, user_high_id, requester_id, status, created_at, updated_at)
             VALUES (?, ?, ?, 'pending', ?, ?)`
        )
        .run(low, high, user.id, now, now);

    return serializeRequest(findRequestWithUser(Number(info.lastInsertRowid), user), user);
}

function listRequests(user) {
    const rows = db
        .prepare(
            `${REQUEST_SELECT}
             WHERE f.status = 'pending'
               AND (f.user_low_id = ? OR f.user_high_id = ?)
             ORDER BY f.created_at DESC, f.id DESC`
        )
        .all(user.id, user.id, user.id, user.id);

    const incoming = [];
    const outgoing = [];
    for (const row of rows) {
        const request = serializeRequest(row, user);
        if (request.direction === 'incoming') {
            incoming.push(request);
        } else {
            outgoing.push(request);
        }
    }

    return { incoming, outgoing, incoming_count: incoming.length };
}

function acceptRequest(user, value) {
    const row = findRequestRow(value);
    requireParticipant(row, user);
    if (row.requester_id === user.id) {
        throw errors.forbidden('Only the recipient can accept this friend request');
    }
    if (row.status !== 'pending') {
        throw errors.conflict('This friend request is no longer pending');
    }

    const now = new Date().toISOString();
    db.prepare(
        `UPDATE friendships
         SET status = 'accepted', accepted_at = ?, updated_at = ?
         WHERE id = ?`
    ).run(now, now, row.id);

    return serializeRequest(findRequestWithUser(row.id, user), user);
}

function rejectRequest(user, value) {
    const row = findRequestRow(value);
    requireParticipant(row, user);
    if (row.requester_id === user.id) {
        throw errors.forbidden('Only the recipient can reject this friend request');
    }
    if (row.status !== 'pending') {
        throw errors.conflict('This friend request is no longer pending');
    }

    const request = serializeRequest(findRequestWithUser(row.id, user), user);
    db.prepare('DELETE FROM friendships WHERE id = ?').run(row.id);
    return { ...request, status: 'rejected' };
}

function cancelRequest(user, value) {
    const row = findRequestRow(value);
    requireParticipant(row, user);
    if (row.requester_id !== user.id) {
        throw errors.forbidden('Only the requester can cancel this friend request');
    }
    if (row.status !== 'pending') {
        throw errors.conflict('This friend request is no longer pending');
    }

    const request = serializeRequest(findRequestWithUser(row.id, user), user);
    db.prepare('DELETE FROM friendships WHERE id = ?').run(row.id);
    return { ...request, status: 'cancelled' };
}

// --------------------------------------------------------------------------- //
// friends
// --------------------------------------------------------------------------- //

function listFriends(user, query) {
    const { page, pageSize } = parsePagination(query || {});
    const total = db
        .prepare(
            `SELECT COUNT(*) AS total FROM friendships
             WHERE status = 'accepted'
               AND (user_low_id = ? OR user_high_id = ?)`
        )
        .get(user.id, user.id).total;

    const offset = (page - 1) * pageSize;
    const rows = db
        .prepare(
            `SELECT
                 f.id AS friendship_id,
                 f.accepted_at,
                 f.updated_at,
                 u.id AS user_id,
                 u.username,
                 u.nickname,
                 u.avatar_url,
                 p.skill_level,
                 p.bio AS signature,
                 p.looking_for
             FROM friendships f
             JOIN users u
               ON u.id = CASE WHEN f.user_low_id = ? THEN f.user_high_id ELSE f.user_low_id END
             LEFT JOIN user_profiles p ON p.user_id = u.id
             WHERE f.status = 'accepted'
               AND (f.user_low_id = ? OR f.user_high_id = ?)
             ORDER BY f.accepted_at DESC, f.id DESC
             LIMIT ? OFFSET ?`
        )
        .all(user.id, user.id, user.id, pageSize, offset)
        .map((row) => ({
            friendship_id: row.friendship_id,
            user: serializeUser(row),
            friends_since: row.accepted_at || row.updated_at,
        }));

    return { items: rows, page, pageSize, total };
}

function removeFriend(user, targetValue) {
    const targetId = normalizeTargetUserId(Number(targetValue));
    if (targetId === user.id) {
        throw errors.invalidParameter('You cannot remove yourself from friends');
    }

    const relation = friendshipBetween(user.id, targetId);
    if (!relation || relation.status !== 'accepted') {
        throw errors.notFound('You are not friends with this user');
    }

    db.prepare('DELETE FROM friendships WHERE id = ?').run(relation.id);
    return { user_id: targetId };
}

module.exports = {
    PAGE_SIZE_DEFAULT,
    PAGE_SIZE_MAX,
    SEARCH_MIN_LENGTH,
    SEARCH_MAX_LENGTH,
    searchUsers,
    sendRequest,
    listRequests,
    acceptRequest,
    rejectRequest,
    cancelRequest,
    listFriends,
    removeFriend,
};
