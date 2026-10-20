'use strict';

const bcrypt = require('bcryptjs');

const { db } = require('../config/database');
const { errors } = require('../utils/response');
const { signToken } = require('../middlewares/auth');

const USERNAME_RE = /^[A-Za-z0-9_]{3,32}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const BCRYPT_ROUNDS = 10;

/** Account fields that are safe to return to the client. */
function publicUser(user) {
    return {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        avatar_url: user.avatar_url,
        created_at: user.created_at,
    };
}

/**
 * Register an account.
 *
 * Note: registration/login belong to TASKS.md 4.3; they are implemented here
 * because every personal card endpoint is "me" based and needs a token.
 */
function register({ username, password, nickname } = {}) {
    const name = String(username ?? '').trim();

    if (!USERNAME_RE.test(name)) {
        throw errors.invalidParameter(
            'username must be 3-32 characters of letters, digits or underscore'
        );
    }
    if (typeof password !== 'string' || password.length < PASSWORD_MIN) {
        throw errors.invalidParameter(`password must be at least ${PASSWORD_MIN} characters`);
    }
    if (password.length > PASSWORD_MAX) {
        throw errors.invalidParameter(`password must be at most ${PASSWORD_MAX} characters`);
    }
    if (db.prepare('SELECT id FROM users WHERE username = ?').get(name)) {
        throw errors.conflict('Username is already taken');
    }

    const displayName = nickname === null || nickname === undefined
        ? null
        : String(nickname).trim();
    if (displayName && displayName.length > 32) {
        throw errors.invalidParameter('nickname must be at most 32 characters');
    }

    const info = db
        .prepare(
            'INSERT INTO users (username, password_hash, nickname, created_at) VALUES (?, ?, ?, ?)'
        )
        .run(
            name,
            bcrypt.hashSync(password, BCRYPT_ROUNDS),
            displayName || null,
            new Date().toISOString()
        );

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
    return { token: signToken(user), user: publicUser(user) };
}

function login({ username, password } = {}) {
    const name = String(username ?? '').trim();
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(name);

    // bcrypt compared against a dummy hash keeps unknown users as slow as known ones.
    if (!user) {
        bcrypt.compareSync(String(password ?? ''), '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin');
        throw errors.invalidCredentials();
    }
    if (!bcrypt.compareSync(String(password ?? ''), user.password_hash)) {
        throw errors.invalidCredentials();
    }

    return { token: signToken(user), user: publicUser(user) };
}

module.exports = { register, login, publicUser };
