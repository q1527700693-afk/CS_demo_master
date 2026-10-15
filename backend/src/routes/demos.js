const express = require('express');

const router = express.Router();

// POST /api/v1/demos
router.post('/', (request, response) => {
    response.status(501).json({
        code: 50100,
        message: 'Not implemented yet',
        data: null
    });
});

module.exports = router;
