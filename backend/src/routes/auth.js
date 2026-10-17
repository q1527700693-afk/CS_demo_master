'use strict';

const express = require('express');

const authService = require('../services/authService');
const { success } = require('../utils/response');

const router = express.Router();

// POST /api/v1/auth/register
router.post('/register', (request, response) => {
    const result = authService.register(request.body);
    return success(
        response,
        {
            access_token: result.token,
            token_type: 'bearer',
            user: result.user,
        },
        'success',
        201
    );
});

// POST /api/v1/auth/login
router.post('/login', (request, response) => {
    const result = authService.login(request.body);
    return success(response, {
        access_token: result.token,
        token_type: 'bearer',
        user: result.user,
    });
});

module.exports = router;
