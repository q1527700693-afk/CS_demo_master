const jwt = require('jsonwebtoken');
const { HttpError } = require('../utils/errors');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

/**
 * 认证中间件：解析 Authorization: Bearer <token>，
 * 校验通过后把用户信息挂到 request.user（{ id, username }）。
 */
function authenticate(request, response, next) {
    const header = request.headers.authorization || '';

    if (!header.startsWith('Bearer ')) {
        return next(new HttpError(401, 40002, '无效或过期的令牌'));
    }

    const token = header.slice('Bearer '.length).trim();

    try {
        const payload = jwt.verify(token, JWT_SECRET);
        request.user = {
            id: payload.userId,
            username: payload.username,
        };
        return next();
    } catch (error) {
        return next(new HttpError(401, 40002, '无效或过期的令牌'));
    }
}

module.exports = authenticate;
