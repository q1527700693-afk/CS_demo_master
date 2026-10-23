'use strict';

const express = require('express');

const { authenticate, optionalAuthenticate } = require('../middlewares/auth');
const lobbyService = require('../services/lobbyService');
const { success } = require('../utils/response');

const router = express.Router();

// GET /api/v1/lobbies - public list of short-handed teams
router.get('/', optionalAuthenticate, (request, response) =>
    success(response, lobbyService.listLobbies(request.query, request.user))
);

// POST /api/v1/lobbies - publish a team and its team code
router.post('/', authenticate, (request, response) =>
    success(response, lobbyService.createLobby(request.user, request.body), 'success', 201)
);

// GET /api/v1/lobbies/:lobbyId - public detail with the virtual claimants
router.get('/:lobbyId', optionalAuthenticate, (request, response) =>
    success(response, lobbyService.getLobby(request.params.lobbyId, request.user))
);

// POST /api/v1/lobbies/:lobbyId/claim - reveal the code; this is NOT joining
router.post('/:lobbyId/claim', authenticate, (request, response) =>
    success(response, lobbyService.claimLobby(request.user, request.params.lobbyId))
);

// POST /api/v1/lobbies/:lobbyId/join - compatibility alias for /claim
router.post('/:lobbyId/join', authenticate, (request, response) =>
    success(response, lobbyService.claimLobby(request.user, request.params.lobbyId))
);

// DELETE /api/v1/lobbies/:lobbyId/claim - remove my virtual claim
router.delete('/:lobbyId/claim', authenticate, (request, response) =>
    success(response, lobbyService.cancelClaim(request.user, request.params.lobbyId))
);

// DELETE /api/v1/lobbies/:lobbyId/leave - compatibility alias for /claim
router.delete('/:lobbyId/leave', authenticate, (request, response) =>
    success(response, lobbyService.cancelClaim(request.user, request.params.lobbyId))
);

// POST /api/v1/lobbies/:lobbyId/depart - owner hides the post and stops claims
router.post('/:lobbyId/depart', authenticate, (request, response) =>
    success(
        response,
        lobbyService.departLobby(request.user, request.params.lobbyId),
        'Lobby departed'
    )
);

// DELETE /api/v1/lobbies/:lobbyId/claimants/:userId - owner kicks a claimant
router.delete('/:lobbyId/claimants/:userId', authenticate, (request, response) =>
    success(
        response,
        lobbyService.kickClaimant(
            request.user,
            request.params.lobbyId,
            request.params.userId
        ),
        'Claimant kicked'
    )
);

// DELETE /api/v1/lobbies/:lobbyId - owner removes the team from the hall
router.delete('/:lobbyId', authenticate, (request, response) =>
    success(
        response,
        lobbyService.deleteLobby(request.user, request.params.lobbyId),
        'Lobby deleted'
    )
);

module.exports = router;
