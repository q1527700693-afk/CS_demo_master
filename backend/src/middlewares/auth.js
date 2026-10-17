'use strict';

const jwt = require('jsonwebtoken');
const { db } = require('../config/database');
const { CODES, ApiError } = require('../utils/response');

const DEV_SECRET = 'dev-only-secret-change-me';

function jwtSecret() {
    return process.env.JWT_SECRET || DEV_SECRET;
}

/** Sign an access token for a user row. */
function signToken(user) {
    return jwt.sign({ sub: String(user.id) }, jwtSecret(), {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    });
}

/**
 * Resolve `Authorization: Bearer <token>` into `request.user`.
 *
 * Every profile endpoint is "me" based, so this middleware is the entry point
 * of the personal card module.
 */
function authenticate(request, response, next) {
    const header = request.get('authorization') || '';
    const [scheme, token] = header.split(' ');

    if (!token || !scheme || scheme.toLowerCase() !== 'bearer') {
        return next(
            new ApiError(
                CODES.INVALID_TOKEN,
                'Missing or malformed Authorization header',
                401
            )
        );
    }

    try {
        const payload = jwt.verify(token, jwtSecret());
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(payload.sub));
        if (!user) {
            return next(new ApiError(CODES.INVALID_TOKEN, 'Account no longer exists', 401));
        }

        request.user = user;
        return next();
    } catch (error) {
        return next(new ApiError(CODES.INVALID_TOKEN, 'Invalid or expired token', 401));
    }
}

module.exports = { authenticate, signToken, jwtSecret };
