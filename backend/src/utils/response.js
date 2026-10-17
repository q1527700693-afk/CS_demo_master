'use strict';

/** Business codes used in the `code` field of every response. */
const CODES = Object.freeze({
    OK: 0,
    INVALID_PARAMETER: 40000,
    INVALID_CREDENTIALS: 40001,
    INVALID_TOKEN: 40002,
    FORBIDDEN: 40300,
    NOT_FOUND: 40400,
    CONFLICT: 40900,
    FILE_TOO_LARGE: 41300,
    INTERNAL_ERROR: 50000,
});

const HTTP_STATUS = {
    [CODES.INVALID_PARAMETER]: 400,
    [CODES.INVALID_CREDENTIALS]: 401,
    [CODES.INVALID_TOKEN]: 401,
    [CODES.FORBIDDEN]: 403,
    [CODES.NOT_FOUND]: 404,
    [CODES.CONFLICT]: 409,
    [CODES.FILE_TOO_LARGE]: 413,
    [CODES.INTERNAL_ERROR]: 500,
};

/** An error that is safe to show to the client. */
class ApiError extends Error {
    constructor(code, message, status) {
        super(message);
        this.name = 'ApiError';
        this.code = code;
        this.status = status || HTTP_STATUS[code] || 400;
    }
}

function success(response, data = null, message = 'success', status = 200) {
    return response.status(status).json({ code: CODES.OK, message, data });
}

function failure(response, code, message, data = null) {
    return response.status(HTTP_STATUS[code] || 400).json({ code, message, data });
}

const errors = {
    invalidParameter: (message) => new ApiError(CODES.INVALID_PARAMETER, message),
    invalidCredentials: (message = 'Invalid username or password') =>
        new ApiError(CODES.INVALID_CREDENTIALS, message),
    invalidToken: (message = 'Invalid or expired token') => new ApiError(CODES.INVALID_TOKEN, message),
    forbidden: (message = 'You are not allowed to perform this action') =>
        new ApiError(CODES.FORBIDDEN, message),
    notFound: (message = 'Resource not found') => new ApiError(CODES.NOT_FOUND, message),
    conflict: (message) => new ApiError(CODES.CONFLICT, message),
    fileTooLarge: (message) => new ApiError(CODES.FILE_TOO_LARGE, message),
    internal: (message = 'Internal server error') => new ApiError(CODES.INTERNAL_ERROR, message),
};

module.exports = { CODES, HTTP_STATUS, ApiError, success, failure, errors };
