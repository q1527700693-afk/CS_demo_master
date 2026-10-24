# CS Demo Master

CS Demo Master is a CS2 demo analysis and team-building platform.

## Current Status

Implemented:

- User registration and login
- JWT authentication
- Current-user endpoint
- Personal profile card
- Avatar upload and deletion
- Public profile card
- Team lobby hall: team-code sharing, virtual claimants, owner depart/kick, expiry cleanup (no chat)
- Friend list: user search, mutual friend requests, accept/reject/cancel, remove friend
- ZIP replay packages (schema 1.1.0): validation, queued rule analysis, reports, evidence, history and deletion
- Optional AI coaching analysis API (DeepSeek/OpenAI-compatible; disabled when `DEEPSEEK_API_KEY` is empty)

Not implemented yet:

- AI result UI integration
- Mini-game APIs

## Replay Analysis Documentation

- [Architecture, implementation, APIs and future LLM integration (中文)](docs/replay-analysis-design.md)
- [Backend usage and integration](backend/REPLAY.md)
- [Acceptance results and deployment checks](backend/REPLAY_ACCEPTANCE.md)

Rule-based replay analysis works without an LLM. The optional AI coaching
endpoint reads the compact rule report, calls a configured OpenAI-compatible
provider, validates the returned JSON and evidence references, and stores
`ai-report.json`. Without a key the endpoint returns `50300` and the base report
continues to work normally.

## Modules

```text
frontend/   Vue 3 web frontend
backend/    Node.js + Express API
parser/     Demo parsing and log generation
ai/         AI analysis prompts and service layer
docs/       API and design documents
deploy/     Deployment configuration
```

## Tech Stack

- Frontend: Vue 3 + Vite
- Backend: Node.js 22+ + Express
- Database: SQLite via `node:sqlite`
- Auth: JWT + bcryptjs
- Uploads: multer + sharp
- Demo Parser: Python + awpy
- AI: LLM API for demo log analysis

## Backend Quick Start

```bash
cd backend
npm install
npm run dev
```

Server:

```text
http://localhost:8000
```

Health check:

```text
GET http://localhost:8000/api/v1/health
```

Copy `backend/.env.example` to `backend/.env` if you need to override `PORT`,
`JWT_SECRET`, `DB_PATH`, `UPLOAD_DIR`, `LOBBY_TTL_HOURS` or the optional
`DEEPSEEK_*` / `AI_*` variables.

## Frontend Integration

### Base URL

Local backend:

```text
http://localhost:8000
```

API base:

```text
http://localhost:8000/api/v1
```

CORS is enabled on the backend.

### Response format

All endpoints return:

```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```

Errors use:

```json
{
  "code": 40001,
  "message": "Invalid credentials",
  "data": null
}
```

### Auth flow

1. Register or login.
2. Read `data.access_token`.
3. Store the token on the frontend.
4. Send it on protected requests:

```http
Authorization: Bearer <access_token>
```

Register:

```http
POST /api/v1/auth/register
Content-Type: application/json
```

```json
{
  "username": "player_one",
  "password": "12345678",
  "nickname": "Player One"
}
```

Login:

```http
POST /api/v1/auth/login
Content-Type: application/json
```

```json
{
  "username": "player_one",
  "password": "12345678"
}
```

Both return:

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "access_token": "jwt-token",
    "token_type": "bearer",
    "user": {
      "id": 1,
      "username": "player_one",
      "nickname": "Player One",
      "avatar_url": null,
      "created_at": "2026-10-17T12:30:27.000Z"
    }
  }
}
```

Example frontend request:

```js
const response = await fetch("http://localhost:8000/api/v1/auth/login", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    username,
    password
  })
});

const result = await response.json();
const token = result.data.access_token;
```

### Profile APIs

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/users/me` | yes | Current account |
| GET | `/api/v1/users/me/profile` | yes | My profile card |
| PATCH | `/api/v1/users/me/profile` | yes | Update profile |
| GET | `/api/v1/users/:userId/profile` | no | Public profile card |
| POST | `/api/v1/users/me/avatar` | yes | Upload avatar (`multipart/form-data`, field `file`) |
| DELETE | `/api/v1/users/me/avatar` | yes | Delete avatar |

Profile update example:

```json
{
  "signature": "AWP main, want a team for Mirage.",
  "steam_id": "76561197960287930",
  "steam_friend_code": "12345678",
  "wanmei_id": "PW_10086",
  "5E_id": "8899",
  "skill_level": "完美 C+",
  "looking_for": "想找固定车队"
}
```

All platform fields (`steam_id`, `steam_friend_code`, `wanmei_id`, `5E_id`) are optional.

### Avatar URL

The API returns a relative avatar URL, for example:

```text
/uploads/avatars/1/9f8c2b1d.jpg
```

The frontend should prefix it with the backend origin:

```js
const avatarUrl = user.avatar_url
  ? "http://localhost:8000" + user.avatar_url
  : "/default-avatar.png";
```

Avatar upload rules:

- JPG, PNG or WebP
- Maximum 2 MB
- Server resizes to 512x512 JPEG
- `multipart/form-data` field name must be `file`

### Lobby APIs

The lobby hall is a **team-code sharing board**. The owner declares the team
size and how many players are already in the team (5-player team with 4 players
= 4缺1), then publishes the in-game team code. A visitor who clicks "join" gets
the code and appears as a **virtual claimant**; this does not fill the roster or
remove the post from the hall.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/lobbies` | optional | Hall of short-handed teams (`page`, `pageSize`, `mode`) |
| POST | `/api/v1/lobbies` | yes | Publish a team and its team code |
| GET | `/api/v1/lobbies/:lobbyId` | optional | Detail and virtual claimants |
| POST | `/api/v1/lobbies/:lobbyId/claim` | yes | Reveal the code and create a virtual claim (`/join` alias) |
| DELETE | `/api/v1/lobbies/:lobbyId/claim` | yes | Cancel my virtual claim (`/leave` alias) |
| POST | `/api/v1/lobbies/:lobbyId/depart` | yes | Owner发车: hide the post and stop claims |
| DELETE | `/api/v1/lobbies/:lobbyId/claimants/:userId` | yes | Owner kicks a virtual claimant |
| DELETE | `/api/v1/lobbies/:lobbyId` | yes | Owner removes the post |

`GET` list/detail are public. Sending a token adds the caller's `is_owner` /
`is_claimed` flags; an invalid token is still rejected with `40002`.

Create example:

```json
{
  "title": "Mirage 4缺1",
  "description": "AWP main, looking for a support player.",
  "mode": "premier",
  "map": "Mirage",
  "region": "Asia",
  "skill_level": "完美 C+",
  "team_size": 5,
  "current_players": 4,
  "team_code": "CS2-MIRAGE-8899"
}
```

Rules:

- `team_size` is 2-10 and `current_players` is 1 to `team_size - 1`.
- `team_code` is 4-64 characters. It is returned only to the owner and to users
  who have claimed it; public responses get `null`.
- Claiming does not change `current_players` or `slots_needed`. The team stays
  in the hall and the claimant is listed under `claimants` as a virtual player.
  Multiple people may claim the same code; CS2 decides who actually joins.
- The owner can **发车** with `POST /api/v1/lobbies/:lobbyId/depart`: the post
  leaves the hall, is hidden from everyone except the owner, and stops accepting
  claims. Existing claimants also lose access to the post.
- The owner can kick a virtual claimant with
  `DELETE /api/v1/lobbies/:lobbyId/claimants/:userId`. The kicked user disappears
  from `claimants` and cannot claim that post again.
- The owner deletes the post with `DELETE /api/v1/lobbies/:lobbyId` once the
  team is formed. Posts also expire automatically (`LOBBY_TTL_HOURS`, default
  24 hours).
- The frontend should route to this hall right after login; the list already
  contains only short-handed, unexpired teams.

There is intentionally no chat or messaging endpoint.

### Friends APIs

Friendships are mutual and private: a request must be accepted before either
user appears in the other's list. Every endpoint below requires
`Authorization: Bearer <token>`.

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/users/search?q=...` | Find users by username/nickname (`page`, `pageSize`) |
| POST | `/api/v1/friends/requests` | Send a request (`{ "user_id": 7 }`) |
| GET | `/api/v1/friends/requests` | Pending incoming/outgoing requests + `incoming_count` |
| POST | `/api/v1/friends/requests/:requestId/accept` | Recipient accepts |
| POST | `/api/v1/friends/requests/:requestId/reject` | Recipient rejects |
| DELETE | `/api/v1/friends/requests/:requestId` | Requester cancels |
| GET | `/api/v1/friends` | My accepted friends (`page`, `pageSize`) |
| DELETE | `/api/v1/friends/:userId` | Remove a friend for both users |

Search results include a `relationship` field: `none`, `incoming_request`,
`outgoing_request` or `friend`. Rejected/cancelled requests and removed friends
can be requested again later. The caller cannot add themselves, cannot create a
duplicate request, and cannot accept/reject the wrong side of a request.

## AI Coaching Integration

The replay report is the source of truth. The AI module only receives compact
facts such as modules, findings, key rounds, movement summary and data quality;
it does not receive the full map or raw ZIP.

Configure on the server only:

```env
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
AI_TIMEOUT_MS=60000
AI_MAX_TOKENS=2000
AI_PROMPT_VERSION=coach-1.0.0
```

If `DEEPSEEK_API_KEY` is empty, the backend stays healthy and the AI endpoints
return `not_configured` / `50300`.

Endpoints:

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/analyses/:analysisId/ai` | Read existing AI coaching result or status |
| POST | `/api/v1/analyses/:analysisId/ai` | Generate AI coaching result from a ready report |

The current implementation is synchronous and returns after the provider call.
A queued AI task can be added later without changing the base report contract.

## API Documentation

Full API details:

- [docs/api-v1.md](docs/api-v1.md)

## Backend Tasks

- [backend/TASKS.md](backend/TASKS.md)

## Team

- Backend Team
- Frontend:
- Parser:
- AI:
- Docs / QA:
