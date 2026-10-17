'use strict';

const express = require('express');
const multer = require('multer');

const { authenticate } = require('../middlewares/auth');
const { errors, success } = require('../utils/response');
const authService = require('../services/authService');
const profileService = require('../services/profileService');

/**
 * Wrap an async handler so a rejected promise reaches the error middleware.
 * Kept here instead of a separate util: the directory layout in TASKS.md 2 has
 * `utils/response.js` as its only util file.
 */
function asyncRoute(handler) {
    return (request, response, next) => handler(request, response, next).catch(next);
}

const avatarUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: profileService.AVATAR_MAX_BYTES, files: 1 },
});

/**
 * Run multer, translating its errors into the shared envelope. Keeping the
 * upload in memory means the original file never reaches the disk: only the
 * 512x512 JPEG produced by sharp is written.
 */
function uploadAvatar(request, response, next) {
    avatarUpload.single('file')(request, response, (error) => {
        if (!error) {
            return next();
        }
        if (error.code === 'LIMIT_FILE_SIZE') {
            return next(errors.fileTooLarge('Avatar must be at most 2 MB'));
        }
        return next(errors.invalidParameter(error.message || 'Invalid avatar upload'));
    });
}

const router = express.Router();

// GET /api/v1/users/me - the account behind the token
router.get('/me', authenticate, (request, response) =>
    success(response, authService.publicUser(request.user))
);

// GET /api/v1/users/me/profile - my personal card
router.get('/me/profile', authenticate, (request, response) =>
    success(response, profileService.getMyCard(request.user))
);

// PATCH /api/v1/users/me/profile - edit signature, platform ids, skill level...
router.patch('/me/profile', authenticate, (request, response) =>
    success(response, profileService.updateMyCard(request.user, request.body))
);

// POST /api/v1/users/me/avatar - upload and resize the avatar
router.post(
    '/me/avatar',
    authenticate,
    uploadAvatar,
    asyncRoute(async (request, response) =>
        success(response, await profileService.replaceAvatar(request.user, request.file))
    )
);

// DELETE /api/v1/users/me/avatar
router.delete(
    '/me/avatar',
    authenticate,
    asyncRoute(async (request, response) =>
        success(response, await profileService.deleteAvatar(request.user))
    )
);

// GET /api/v1/users/:userId/profile - public card
router.get('/:userId/profile', (request, response) =>
    success(response, profileService.getPublicCard(request.params.userId))
);

module.exports = router;
