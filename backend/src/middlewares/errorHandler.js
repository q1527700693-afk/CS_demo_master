'use strict';

const multer = require('multer');
const { ApiError, CODES, failure } = require('../utils/response');

/**
 * Convert every thrown error into the documented response envelope.
 */
function errorHandler(error, request, response, next) {
    if (response.headersSent) {
        return next(error);
    }

    if (error instanceof ApiError) {
        return failure(response, error.code, error.message);
    }

    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return failure(response, CODES.FILE_TOO_LARGE, 'Avatar must be at most 2 MB');
        }
        return failure(response, CODES.INVALID_PARAMETER, error.message);
    }

    if (error && error.type === 'entity.parse.failed') {
        return failure(response, CODES.INVALID_PARAMETER, 'Malformed JSON body');
    }

    console.error(error);
    return failure(response, CODES.INTERNAL_ERROR, 'Internal server error');
}

module.exports = errorHandler;
