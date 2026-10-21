'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const { db } = require('../config/database');
const { errors } = require('../utils/response');

// --- limits derived from TASKS.md 4.4 ---------------------------------------
const SIGNATURE_MAX_LENGTH = 200;
const SKILL_LEVEL_MAX_LENGTH = 32;
const LOOKING_FOR_MAX_LENGTH = 100;
const OTHER_GAMES_MAX = 5;
const OTHER_GAME_FIELD_MAX_LENGTH = 32;
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_SIZE = 512;
const AVATAR_FORMATS = new Set(['jpeg', 'png', 'webp']);

const PLATFORM_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,31}$/;
const STEAM_FRIEND_CODE_RE = /^\d{6,12}$/;
const PLATFORM_FIELDS = ['steam_id', 'wanmei_id', 'five_e_id'];
const PLATFORM_LABELS = {
    steam_id: 'Steam',
    wanmei_id: '完美世界 (Perfect World)',
    five_e_id: '5E',
};

//: JSON accepts a property starting with a digit, JavaScript identifiers do not.
const FIVE_E_ALIASES = ['5E_id', 'five_e_id'];
const UPDATABLE_FIELDS = new Set([
    'steam_id',
    'steam_friend_code',
    'wanmei_id',
    'signature',
    'bio',
    'other_game_ids',
    'skill_level',
    'looking_for',
    ...FIVE_E_ALIASES,
]);

const STEAM_ID64_BASE = 76561197960265728n;
const STEAM_ID64_MAX = STEAM_ID64_BASE + 4294967295n;

// --------------------------------------------------------------------------- //
// Steam / platform identifiers
// --------------------------------------------------------------------------- //

function validateSteamId64(value) {
    if (!/^\d{17}$/.test(value)) {
        throw errors.invalidParameter(
            'steam_id must be a 17 digit SteamID64, for example 76561197960287930'
        );
    }
    const number = BigInt(value);
    if (!(number > STEAM_ID64_BASE && number <= STEAM_ID64_MAX)) {
        throw errors.invalidParameter('steam_id is not a valid SteamID64 (unexpected account range)');
    }
    return value;
}

/** Accept SteamID64, SteamID3, SteamID2 and profile links; return SteamID64. */
function normalizeSteamId(raw) {
    const value = String(raw ?? '').trim();
    if (!value) {
        throw errors.invalidParameter('steam_id must not be empty');
    }

    if (/^\d+$/.test(value)) {
        return validateSteamId64(value);
    }

    let match = value.match(/^\[U:([01]):(\d{1,10})\]$/);
    if (match) {
        if (match[1] !== '1') {
            throw errors.invalidParameter('Only public Steam accounts (universe 1) are supported');
        }
        return validateSteamId64((STEAM_ID64_BASE + BigInt(match[2])).toString());
    }

    match = value.match(/^STEAM_([0-5]):([01]):(\d{1,10})$/i);
    if (match) {
        const accountId = BigInt(match[3]) * 2n + BigInt(match[2]);
        return validateSteamId64((STEAM_ID64_BASE + accountId).toString());
    }

    match = value.match(
        /^https?:\/\/(?:www\.)?steamcommunity\.com\/profiles\/(\d{17})\/?(?:\?.*)?$/i
    );
    if (match) {
        return validateSteamId64(match[1]);
    }

    if (/^https?:\/\/(?:www\.)?steamcommunity\.com\/id\//i.test(value)) {
        throw errors.invalidParameter(
            'Custom Steam profile links cannot be resolved without the Steam Web API; ' +
                'open the profile and paste the 17 digit SteamID64 instead'
        );
    }

    throw errors.invalidParameter(
        'steam_id must be a SteamID64 (17 digits), SteamID3 ([U:1:...]), ' +
            'SteamID2 (STEAM_0:1:...) or a steamcommunity.com/profiles/<SteamID64> link'
    );
}

function normalizeSteamFriendCode(value) {
    if (value === null || value === undefined) {
        return null;
    }
    const text = String(value).trim();
    if (!text) {
        return null;
    }
    if (!STEAM_FRIEND_CODE_RE.test(text)) {
        throw errors.invalidParameter('steam_friend_code must be 6-12 digits');
    }
    return text;
}

function normalizePlatformId(value, label) {
    if (value === null || value === undefined) {
        return null;
    }
    const text = String(value).trim();
    if (!text) {
        return null;
    }
    if (!PLATFORM_ID_RE.test(text)) {
        throw errors.invalidParameter(
            `${label} id must be 2-32 characters of letters, digits, '_' or '-'`
        );
    }
    return text;
}

// --------------------------------------------------------------------------- //
// text / JSON helpers
// --------------------------------------------------------------------------- //

function normalizeText(value, maxLength, field) {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value !== 'string') {
        throw errors.invalidParameter(`${field} must be a string`);
    }
    const text = value.trim();
    if (!text) {
        return null;
    }
    if (text.length > maxLength) {
        throw errors.invalidParameter(`${field} must be at most ${maxLength} characters`);
    }
    return text;
}

function normalizeOtherGames(value) {
    if (value === null || value === undefined) {
        return null;
    }
    if (!Array.isArray(value)) {
        throw errors.invalidParameter('other_game_ids must be an array of { game, account }');
    }
    if (value.length > OTHER_GAMES_MAX) {
        throw errors.invalidParameter(`other_game_ids may hold at most ${OTHER_GAMES_MAX} entries`);
    }

    const entries = value.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw errors.invalidParameter('Each other_game_ids entry must be { game, account }');
        }
        const game = String(item.game ?? '').trim();
        const account = String(item.account ?? '').trim();
        if (!game || !account) {
            throw errors.invalidParameter('Each other_game_ids entry needs a game and an account');
        }
        if (game.length > OTHER_GAME_FIELD_MAX_LENGTH || account.length > OTHER_GAME_FIELD_MAX_LENGTH) {
            throw errors.invalidParameter(
                `other_game_ids game/account must be at most ${OTHER_GAME_FIELD_MAX_LENGTH} characters`
            );
        }
        return { game, account };
    });

    return entries.length ? JSON.stringify(entries) : null;
}

function parseJson(value, fallback) {
    if (!value) {
        return fallback;
    }
    try {
        return JSON.parse(value);
    } catch (error) {
        return fallback;
    }
}

// --------------------------------------------------------------------------- //
// card row helpers
// --------------------------------------------------------------------------- //

function getUser(userId) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(userId));
}

function getProfileRow(userId) {
    return db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(Number(userId));
}

function ensureProfileRow(userId) {
    const existing = getProfileRow(userId);
    if (existing) {
        return existing;
    }

    const now = new Date().toISOString();
    db.prepare(
        'INSERT INTO user_profiles (user_id, created_at, updated_at) VALUES (?, ?, ?)'
    ).run(Number(userId), now, now);
    return getProfileRow(userId);
}

/** Turn the two rows into the card object documented in docs/api-v1.md. */
function serialize(user, profile) {
    return {
        user_id: user.id,
        username: user.username,
        nickname: user.nickname,
        // DB column is `bio` (TASKS.md 4.2), the API calls it `signature`.
        signature: profile ? profile.bio : null,
        steam_id: profile ? profile.steam_id : null,
        steam_friend_code: profile ? profile.steam_friend_code : null,
        wanmei_id: profile ? profile.wanmei_id : null,
        '5E_id': profile ? profile.five_e_id : null,
        other_game_ids: parseJson(profile && profile.other_game_ids, []),
        skill_level: profile ? profile.skill_level : null,
        looking_for: profile ? profile.looking_for : null,
        has_platform_id: Boolean(
            profile && (profile.steam_id || profile.wanmei_id || profile.five_e_id)
        ),
        avatar_url: user.avatar_url || null,
        updated_at: profile ? profile.updated_at : null,
    };
}

// --------------------------------------------------------------------------- //
// public API of this service
// --------------------------------------------------------------------------- //

function getMyCard(user) {
    return serialize(user, getProfileRow(user.id));
}

function getPublicCard(userId) {
    const numericId = Number(userId);
    if (!Number.isInteger(numericId) || numericId <= 0) {
        throw errors.notFound('User not found');
    }
    const user = getUser(numericId);
    if (!user) {
        throw errors.notFound('User not found');
    }
    return serialize(user, getProfileRow(numericId));
}

/**
 * Apply a partial update to the card.
 *
 * Omitted fields stay unchanged, an explicit null clears a field. All platform
 * fields are optional.
 */
function updateMyCard(user, payload) {
    const body = payload && typeof payload === 'object' ? payload : {};

    for (const key of Object.keys(body)) {
        if (!UPDATABLE_FIELDS.has(key)) {
            throw errors.invalidParameter(`Unknown field: ${key}`);
        }
    }

    const changes = {};

    if ('steam_id' in body) {
        changes.steam_id =
            body.steam_id === null || body.steam_id === '' ? null : normalizeSteamId(body.steam_id);
    }
    if ('steam_friend_code' in body) {
        changes.steam_friend_code = normalizeSteamFriendCode(body.steam_friend_code);
    }
    if ('wanmei_id' in body) {
        changes.wanmei_id = normalizePlatformId(body.wanmei_id, PLATFORM_LABELS.wanmei_id);
    }

    const fiveKey = FIVE_E_ALIASES.find((key) => key in body);
    if (fiveKey) {
        changes.five_e_id = normalizePlatformId(body[fiveKey], PLATFORM_LABELS.five_e_id);
    }

    if ('signature' in body || 'bio' in body) {
        const raw = 'signature' in body ? body.signature : body.bio;
        changes.bio = normalizeText(raw, SIGNATURE_MAX_LENGTH, 'signature');
    }
    if ('skill_level' in body) {
        changes.skill_level = normalizeText(body.skill_level, SKILL_LEVEL_MAX_LENGTH, 'skill_level');
    }
    if ('looking_for' in body) {
        changes.looking_for = normalizeText(body.looking_for, LOOKING_FOR_MAX_LENGTH, 'looking_for');
    }
    if ('other_game_ids' in body) {
        changes.other_game_ids = normalizeOtherGames(body.other_game_ids);
    }

    if (Object.keys(changes).length === 0) {
        throw errors.invalidParameter('No fields to update');
    }

    const profile = ensureProfileRow(user.id);

    // Validate the *resulting* card, not just the incoming fields.
    const candidate = {
        steam_id: 'steam_id' in changes ? changes.steam_id : profile.steam_id,
        wanmei_id: 'wanmei_id' in changes ? changes.wanmei_id : profile.wanmei_id,
        five_e_id: 'five_e_id' in changes ? changes.five_e_id : profile.five_e_id,
    };
    for (const field of PLATFORM_FIELDS) {
        const value = candidate[field];
        if (!value) {
            continue;
        }
        const owner = db
            .prepare(`SELECT user_id FROM user_profiles WHERE ${field} = ?`)
            .get(value);
        if (owner && owner.user_id !== user.id) {
            throw errors.conflict(
                `This ${PLATFORM_LABELS[field]} id is already bound to another account`
            );
        }
    }

    const columns = Object.keys(changes);
    const statement = columns.map((column) => `${column} = ?`).join(', ');
    db.prepare(`UPDATE user_profiles SET ${statement}, updated_at = ? WHERE user_id = ?`).run(
        ...columns.map((column) => changes[column]),
        new Date().toISOString(),
        user.id
    );

    return serialize(user, getProfileRow(user.id));
}

// --------------------------------------------------------------------------- //
// avatar
// --------------------------------------------------------------------------- //

function uploadRoot() {
    return path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads'));
}

function resolveUploadPath(url) {
    if (!url) {
        return null;
    }
    const root = uploadRoot();
    const relative = String(url).replace(/^\/uploads\//, '');
    const target = path.resolve(root, relative);
    if (target !== root && !target.startsWith(root + path.sep)) {
        return null;
    }
    return target;
}

async function removeUpload(url) {
    const target = resolveUploadPath(url);
    if (!target) {
        return;
    }
    await fs.unlink(target).catch(() => {});
}

/**
 * Validate the upload, resize it to 512x512 JPEG and store it outside the
 * database, then point `users.avatar_url` at it.
 */
async function replaceAvatar(user, file) {
    if (!file || !file.buffer || !file.size) {
        throw errors.invalidParameter('Avatar file is required (multipart field name: file)');
    }
    if (file.size > AVATAR_MAX_BYTES) {
        throw errors.fileTooLarge('Avatar must be at most 2 MB');
    }

    let metadata;
    try {
        metadata = await sharp(file.buffer).metadata();
    } catch (error) {
        throw errors.invalidParameter('Avatar must be a valid JPEG, PNG or WebP image');
    }
    if (!AVATAR_FORMATS.has(metadata.format)) {
        throw errors.invalidParameter(
            `Avatar format ${metadata.format || 'unknown'} is not allowed; use JPEG, PNG or WebP`
        );
    }

    const resized = await sharp(file.buffer)
        .rotate()
        .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();

    const relative = `${user.id}/${crypto.randomUUID()}.jpg`;
    const target = path.join(uploadRoot(), 'avatars', relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, resized);

    const url = `/uploads/avatars/${relative.replace(/\\/g, '/')}`;
    const previous = user.avatar_url;
    db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(url, user.id);
    if (previous && previous !== url) {
        await removeUpload(previous);
    }

    return {
        avatar_url: url,
        content_type: 'image/jpeg',
        size_bytes: resized.length,
        width: AVATAR_SIZE,
        height: AVATAR_SIZE,
    };
}

async function deleteAvatar(user) {
    const previous = user.avatar_url;
    db.prepare('UPDATE users SET avatar_url = NULL WHERE id = ?').run(user.id);
    if (previous) {
        await removeUpload(previous);
    }
    return serialize(getUser(user.id), getProfileRow(user.id));
}

module.exports = {
    AVATAR_MAX_BYTES,
    AVATAR_SIZE,
    SIGNATURE_MAX_LENGTH,
    getMyCard,
    getPublicCard,
    updateMyCard,
    replaceAvatar,
    deleteAvatar,
    normalizeSteamId,
    normalizePlatformId,
};
