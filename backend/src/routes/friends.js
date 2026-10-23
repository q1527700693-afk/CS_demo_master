'use strict';

const express = require('express');

const { authenticate } = require('../middlewares/auth');
const friendService = require('../services/friendService');
const { success } = require('../utils/response');

const router = express.Router();

router.use(authenticate);

// GET /api/v1/friends - my accepted friends
router.get('/', (request, response) =>
    success(response, friendService.listFriends(request.user, request.query))
);

// GET /api/v1/friends/requests - incoming and outgoing pending requests
router.get('/requests', (request, response) =>
    success(response, friendService.listRequests(request.user))
);

// POST /api/v1/friends/requests - send a friend request
router.post('/requests', (request, response) =>
    success(response, friendService.sendRequest(request.user, request.body), 'success', 201)
);

// POST /api/v1/friends/requests/:requestId/accept
router.post('/requests/:requestId/accept', (request, response) =>
    success(
        response,
        friendService.acceptRequest(request.user, request.params.requestId)
    )
);

// POST /api/v1/friends/requests/:requestId/reject
router.post('/requests/:requestId/reject', (request, response) =>
    success(
        response,
        friendService.rejectRequest(request.user, request.params.requestId),
        'Friend request rejected'
    )
);

// DELETE /api/v1/friends/requests/:requestId - cancel my outgoing request
router.delete('/requests/:requestId', (request, response) =>
    success(
        response,
        friendService.cancelRequest(request.user, request.params.requestId),
        'Friend request cancelled'
    )
);

// DELETE /api/v1/friends/:userId - remove a friend
router.delete('/:userId', (request, response) =>
    success(
        response,
        friendService.removeFriend(request.user, request.params.userId),
        'Friend removed'
    )
);

module.exports = router;
