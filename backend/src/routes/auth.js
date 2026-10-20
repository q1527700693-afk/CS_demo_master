const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/response');
const authService = require('../services/authService');

const router = express.Router();

// POST /api/v1/auth/register
router.post('/register', asyncHandler(async (request, response) => {
    const { username, password, nickname } = request.body || {};
    const user = await authService.register({ username, password, nickname });
    return success(response, { user }, 'success', 201);
}));

// POST /api/v1/auth/login
router.post('/login', asyncHandler(async (request, response) => {
    const { username, password } = request.body || {};
    const result = await authService.login({ username, password });
    return success(response, result);
}));

module.exports = router;
