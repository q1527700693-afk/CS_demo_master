const express = require('express');

const router = express.Router();

// POST /api/v1/auth/register
router.post('/register', (request, response) => {
    response.status(501).json({
        code: 50100,
        message: 'Not implemented yet',
        data: null
    });
});

// POST /api/v1/auth/login
router.post('/login', (request, response) => {
    response.status(501).json({
        code: 50100,
        message: 'Not implemented yet',
        data: null
    });
});

module.exports = router;
