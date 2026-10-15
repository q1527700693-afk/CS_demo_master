const express = require('express');

const router = express.Router();

// GET /api/v1/users/me
router.get('/me', (request, response) => {
    response.status(501).json({
        code: 50100,
        message: 'Not implemented yet',
        data: null
    });
});

// GET /api/v1/users/me/profile
router.get('/me/profile', (request, response) => {
    response.status(501).json({
        code: 50100,
        message: 'Not implemented yet',
        data: null
    });
});

// PATCH /api/v1/users/me/profile
router.patch('/me/profile', (request, response) => {
    response.status(501).json({
        code: 50100,
        message: 'Not implemented yet',
        data: null
    });
});

module.exports = router;
