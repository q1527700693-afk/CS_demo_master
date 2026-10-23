# CS Demo Master Backend

Node.js + Express backend API for CS Demo Master.

## Tech Stack

- Node.js 22+
- Express
- SQLite (`node:sqlite`, built into Node.js)
- JWT (`jsonwebtoken`)
- bcryptjs
- multer (uploads)
- sharp (image resizing)

## Run

```bash
npm install
npm run dev
```

The server starts at:

```text
http://localhost:8000
```

Health check:

```text
GET /api/v1/health
```

Copy `.env.example` to `.env` to override `PORT`, `JWT_SECRET`, `DB_PATH`,
`UPLOAD_DIR` and `LOBBY_TTL_HOURS`. The SQLite file and the upload folder are
created automatically.

## Implemented: Personal Card (TASKS.md 4.4)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/auth/register` | - | Create an account, returns a JWT |
| POST | `/api/v1/auth/login` | - | Log in, returns a JWT |
| GET | `/api/v1/users/me` | yes | Current account |
| GET | `/api/v1/users/me/profile` | yes | My personal card |
| PATCH | `/api/v1/users/me/profile` | yes | Update platform ids / Steam friend code / signature / extra fields |
| GET | `/api/v1/users/:userId/profile` | - | Public card |
| POST | `/api/v1/users/me/avatar` | yes | Upload avatar (multipart `file`) |
| DELETE | `/api/v1/users/me/avatar` | yes | Remove avatar |

Design notes:

- The card is `user_profiles`; credentials and `avatar_url` stay in `users`, as
  planned in TASKS.md 4.2.
- The signature lives in the `bio` column (TASKS.md 4.2) and is exposed as
  `signature`; requests may also send `bio`.
- `steam_id` / `wanmei_id` / `five_e_id` are NULL when unbound and carry UNIQUE
  indexes, so one platform account can belong to one user only. These platform
  fields, plus `steam_friend_code`, are all optional.
- `5E_id` starts with a digit: the JSON/API name is `5E_id`, the column and
  attribute are `five_e_id`, and requests may use either spelling.
- Avatars are validated with sharp (real JPEG/PNG/WebP), resized to 512x512
  JPEG and written to `uploads/avatars/<userId>/`. Only the URL is stored in
  SQLite, and the file is served with `X-Content-Type-Options: nosniff`.
- The card row is created lazily on the first write, so reading a fresh account
  returns an empty card without touching the database.

## Implemented: Lobby Hall (TASKS.md 4.5)

The hall is a team-code sharing board, not a roster manager. The owner declares
`team_size` and `current_players` (a 5-player team with `current_players: 4` is
4缺1) and publishes the in-game `team_code`. Claiming reveals the code and
records a **virtual claimant**; it does not change the declared roster.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/lobbies` | optional | Short-handed, unexpired hall |
| POST | `/api/v1/lobbies` | yes | Publish a team and its code |
| GET | `/api/v1/lobbies/:lobbyId` | optional | Detail and virtual claimants |
| POST | `/api/v1/lobbies/:lobbyId/claim` | yes | Reveal the code (alias: `/join`) |
| DELETE | `/api/v1/lobbies/:lobbyId/claim` | yes | Cancel my claim (alias: `/leave`) |
| POST | `/api/v1/lobbies/:lobbyId/depart` | yes | Owner发车: hide the post and stop claims |
| DELETE | `/api/v1/lobbies/:lobbyId/claimants/:userId` | yes | Owner kicks a virtual claimant |
| DELETE | `/api/v1/lobbies/:lobbyId` | yes | Owner deletes the post |

Design notes:

- `lobbies` keeps the declared roster (`team_size`, `current_players`), the
  code and `expires_at`. `lobby_claims` stores only users who revealed the code;
  there is no real-membership table.
- `current_players` is declared by the owner and includes the owner/existing
  teammates. The API refuses to publish an already-full team.
- The list only returns unexpired posts where `current_players < team_size`.
  `page`, `pageSize` (max 50) and `mode` are supported; results are newest
  first.
- Create accepts `title` (required, 1-60), `description` (max 300), `mode`
  (`competitive` / `premier` / `wingman`), `map`, `region`, `skill_level`
  (max 32 each), `team_size` (2-10), `current_players` (1 to `team_size - 1`)
  and `team_code` (4-64 chars, no control characters). Unknown fields are
  rejected.
- `team_code` is only serialized for the owner and for users with a claim. The
  claim response returns it explicitly; public list/detail responses get `null`.
- Claiming is idempotent and does not fill a slot. The post stays in the hall,
  and `claimants` is the virtual-player list. Multiple users may claim the same
  code.
- `depart` sets `status: "departed"`/`departed_at`: the post is removed from the
  hall and its detail/claim endpoints return `404` to everyone except the owner.
  Existing claimants lose access too.
- Kicking sets a claim's status to `kicked` and records `kicked_at`. The user is
  removed from `claimants`/`claim_count`, loses the code in later reads, and gets
  `403` if they try to claim again. The row is kept to enforce that block.
- The list/detail routes are public. An `Authorization` header is optional but,
  when supplied, must be valid; it adds `is_owner` / `is_claimed`.
- `LOBBY_TTL_HOURS` controls expiry (default 24, max 8760). Expired posts are
  deleted lazily on reads/claims. The owner deletes the post once the team is
  formed; there is no chat module.

## Implemented: Friends (TASKS.md 4.8)

Friendships are mutual. A pending request must be accepted before either user
appears in the other's list, and friend lists are private. Every route below
requires authentication.

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/users/search` | Search users by username/nickname (`q`, `page`, `pageSize`) |
| POST | `/api/v1/friends/requests` | Send a request (`{ "user_id": 7 }`) |
| GET | `/api/v1/friends/requests` | Pending `incoming` / `outgoing` + `incoming_count` |
| POST | `/api/v1/friends/requests/:requestId/accept` | Recipient accepts |
| POST | `/api/v1/friends/requests/:requestId/reject` | Recipient rejects |
| DELETE | `/api/v1/friends/requests/:requestId` | Requester cancels |
| GET | `/api/v1/friends` | My accepted friends (`page`, `pageSize`) |
| DELETE | `/api/v1/friends/:userId` | Remove a friend for both users |

Design notes:

- `friendships` stores pending and accepted relationships in one table. The
  pair is canonical (`user_low_id < user_high_id`) with a UNIQUE constraint, so
  A→B and B→A cannot create two rows. `requester_id` records which side sent the
  request.
- Search is authenticated and excludes the caller. `q` is 2-32 characters and
  matches username or nickname. Results include `relationship`: `none`,
  `outgoing_request`, `incoming_request` or `friend`.
- Sending a request rejects self-adds, unknown users, duplicate/reverse pending
  requests and existing friendships (`40000` / `40400` / `40900`).
- Only the recipient can accept or reject; only the requester can cancel.
  Accepting sets `status='accepted'` and fills both friend lists. Reject/cancel
  deletes the row, so the sender can request again later.
- Rejection and cancellation responses keep the request shape but report
  `status: "rejected"` / `"cancelled"`.
- The friend list returns `friendship_id`, the friend's public summary and
  `friends_since`, sorted newest first. Removing a friend deletes the shared row
  for both sides.
- Deleting a user cascades their friendships. There is no public friend list,
  online presence or chat.

## Tests

```bash
npm test
```

`tests/profile.test.js` covers registration/JWT errors, optional platform
fields, Steam id normalisation, field validation, uniqueness conflicts, the
public card, and every avatar rule (resize to 512x512, 2 MB limit, non-image
rejection, replacement, deletion).

`tests/lobby.test.js` covers the declared roster/code/claim schema,
authentication, creation validation, public pagination/filtering, code privacy,
claim idempotence and virtual claimants, code cancellation, join/leave aliases,
owner-only depart and kick, kicked-user re-claim blocking, owner-only deletion,
hiding full teams, and expiry cleanup.

`tests/friends.test.js` covers the friendship schema, auth on every route, search
validation/privacy/relationship states, sending and duplicate requests, request
direction and counts, accept/reject/cancel permissions, the mutual friend list,
pagination, and friend removal/re-request. All files use an in-memory SQLite
database and a temporary upload folder; the suite currently has 49 tests.

## Layout

```text
backend/
  src/
    app.js                   Express app, /uploads static, 404 + error handler
    server.js                dotenv + listen
    config/database.js       node:sqlite connection and schema
    middlewares/auth.js      Bearer token -> request.user (+ optional auth)
    middlewares/errorHandler.js
    routes/auth.js           register / login
    routes/users.js          me, profile, avatar, user search
    routes/lobbies.js        lobby hall routes
    routes/friends.js        friend request / friend list routes
    services/authService.js
    services/profileService.js   card validation, Steam ids, avatar resizing
    services/lobbyService.js     team-code posts, claims, expiry, deletion
    services/friendService.js    search, requests, friendships
    utils/response.js        { code, message, data } envelope + ApiError
  tests/profile.test.js
  tests/lobby.test.js
  tests/friends.test.js
  uploads/avatars/           runtime, git ignored
  uploads/demo-logs/         runtime, git ignored
  data/                      SQLite file, git ignored
```
