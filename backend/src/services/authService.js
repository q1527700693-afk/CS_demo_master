const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../config/database');
const { HttpError } = require('../utils/errors');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const BCRYPT_ROUNDS = 10;

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,32}$/;
const PASSWORD_MIN_LENGTH = 6;
const NICKNAME_MAX_LENGTH = 32;

if (!process.env.JWT_SECRET) {
    console.warn('[authService] JWT_SECRET 未配置，使用开发默认值，生产环境务必设置。');
}

/**
 * 把数据库用户行转成对外返回的安全对象（去掉密码哈希）。
 */
function toPublicUser(row) {
    return {
        id: row.id,
        username: row.username,
        nickname: row.nickname,
        avatar_url: row.avatar_url,
        created_at: row.created_at,
    };
}

function findByUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function findById(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function validateRegisterInput({ username, password, nickname }) {
    if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) {
        throw new HttpError(400, 40000, '用户名需为 3-32 位字母、数字或下划线');
    }
    if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
        throw new HttpError(400, 40000, `密码至少 ${PASSWORD_MIN_LENGTH} 位`);
    }
    if (nickname !== undefined && nickname !== null) {
        if (typeof nickname !== 'string' || nickname.trim().length === 0 || nickname.length > NICKNAME_MAX_LENGTH) {
            throw new HttpError(400, 40000, `昵称需为 1-${NICKNAME_MAX_LENGTH} 个字符`);
        }
    }
}

async function register({ username, password, nickname }) {
    validateRegisterInput({ username, password, nickname });

    if (findByUsername(username)) {
        throw new HttpError(409, 40900, '用户名已存在');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const finalNickname = nickname && nickname.trim() ? nickname.trim() : username;

    const result = db.prepare(
        'INSERT INTO users (username, password_hash, nickname) VALUES (?, ?, ?)'
    ).run(username, passwordHash, finalNickname);

    const user = findById(result.lastInsertRowid);
    return toPublicUser(user);
}

async function login({ username, password }) {
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
        throw new HttpError(401, 40001, '用户名或密码错误');
    }

    const user = findByUsername(username);
    if (!user) {
        throw new HttpError(401, 40001, '用户名或密码错误');
    }

    const matched = await bcrypt.compare(password, user.password_hash);
    if (!matched) {
        throw new HttpError(401, 40001, '用户名或密码错误');
    }

    const token = jwt.sign(
        { userId: user.id, username: user.username },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );

    return {
        token,
        user: toPublicUser(user),
    };
}

function getUserById(id) {
    const user = findById(id);
    if (!user) {
        throw new HttpError(404, 40400, '用户不存在');
    }
    return toPublicUser(user);
}

module.exports = {
    register,
    login,
    getUserById,
};
