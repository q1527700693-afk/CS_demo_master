const express = require('express');

const router = express.Router();

// GET /api/v1/lobbies
router.get('/', (request, response) => {
    response.status(501).json({
        code: 50100,
        message: 'Not implemented yet',
        data: null
    });
});

// POST /api/v1/lobbies
router.post('/', (request, response) => {
    response.status(501).json({
        code: 50100,
        message: 'Not implemented yet',
        data: null
    });
});

module.exports = router;
