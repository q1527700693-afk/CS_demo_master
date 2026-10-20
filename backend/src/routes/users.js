const express = require('express');
const authenticate = require('../middlewares/auth');
const { success } = require('../utils/response');
const authService = require('../services/authService');

const router = express.Router();

// GET /api/v1/users/me
router.get('/me', authenticate, (request, response) => {
    const user = authService.getUserById(request.user.id);
    return success(response, { user });
});

// 个人名片接口（属于 profile 模块，后续实现）。
router.get('/me/profile', authenticate, (request, response) => {
    response.status(501).json({ code: 50100, message: 'Not implemented yet', data: null });
});

router.patch('/me/profile', authenticate, (request, response) => {
    response.status(501).json({ code: 50100, message: 'Not implemented yet', data: null });
});

module.exports = router;
