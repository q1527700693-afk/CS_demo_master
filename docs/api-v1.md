# CS Demo Master API Documentation v1

Local base URL: `http://localhost:8000/api/v1`

All requests go through the `/api/v1` prefix. CORS is enabled on the backend.

## 1. Common Conventions

### Response Format

```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```

### Error Format

```json
{
  "code": 40001,
  "message": "Invalid credentials",
  "data": null
}
```

### Authentication

```http
Authorization: Bearer <token>
```

### Pagination

Request:

```text
?page=1&pageSize=20
```

Response:

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "items": [],
    "page": 1,
    "pageSize": 20,
    "total": 0
  }
}
```

## 2. Authentication

### POST /api/v1/auth/register

Creates the account and returns a token (HTTP 201).

Request:

```json
{ "username": "s1mple_fan", "password": "str0ng-passw0rd" }
```

| Field | Rules |
|---|---|
| `username` | 3-32 characters, `A-Z a-z 0-9 _`, unique |
| `password` | 8-128 characters, hashed with bcrypt |

Response `data`:

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "user": {
    "id": 1,
    "username": "s1mple_fan",
    "nickname": null,
    "avatar_url": null,
    "created_at": "2026-10-17T12:30:27.000Z"
  }
}
```

Errors: `40000` invalid parameter, `40900` username already taken.

### POST /api/v1/auth/login

Same body and response as register (HTTP 200).

Errors: `40000` invalid parameter, `40001` invalid username or password.

### POST /api/v1/auth/logout

Not implemented yet. Tokens are stateless, so the client can drop its token at
any time.

### GET /api/v1/users/me

Requires authentication. Returns the account object shown above.

Errors: `40002` missing or invalid token.

## Frontend Quick Start

1. Register or log in.
2. Read `data.access_token`.
3. Store it in memory, Pinia, or localStorage.
4. Add `Authorization: Bearer <token>` for protected requests.
5. Prefix avatar URLs returned by the API with the backend origin.

```js
const API_BASE = "http://localhost:8000";

const res = await fetch(API_BASE + "/api/v1/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username, password })
});

const json = await res.json();
const token = json.data.access_token;
```

## 3. User Profile (Personal Card / 个人名片)

The card of a user, used by the lobby and by shareable card pages. It is made of:

1. **Platform fields** - `steam_id`, `steam_friend_code`, `wanmei_id` (完美世界)
   and `5E_id` (5E). All of these fields are optional. Each platform id can
   belong to one account only (`40900` on a duplicate).
2. **Signature** - free text, at most 200 characters.
3. **Avatar** - JPEG/PNG/WebP up to **2 MB**; the server resizes it to
   **512x512** JPEG and stores it under `uploads/avatars/<userId>/`. Only the
   URL lives in the database.
4. **Extra fields** - `other_game_ids`, `skill_level` (水平) and `looking_for`
   (想找队友).

> `5E_id` starts with a digit: JSON allows it, JavaScript/Python identifiers do
> not. The database column and the internal attribute are `five_e_id`, and a
> request may use either `5E_id` or `five_e_id`. Responses always use `5E_id`.

### Card object

```json
{
  "user_id": 1,
  "username": "s1mple_fan",
  "nickname": null,
  "signature": "AWP main, entry fragger. Let's queue!",
  "steam_id": "76561197960287930",
  "steam_friend_code": "12345678",
  "wanmei_id": "PW_10086",
  "5E_id": "8899",
  "other_game_ids": [{ "game": "Faceit", "account": "s1mple_f" }],
  "skill_level": "完美 C+ / 5E 2200",
  "looking_for": "想找固定车队，晚上 8 点后在线",
  "has_platform_id": true,
  "avatar_url": "/uploads/avatars/1/9f8c2b1d-4e5a-4c3f-8a7b-6d5e4f3a2b1c.jpg",
  "updated_at": "2026-10-17T12:31:02.000Z"
}
```

`avatar_url` is relative to the API host (`${API_ORIGIN}${avatar_url}`). A card
that has never been written returns the same shape with `null` values and
`has_platform_id: false`.

### GET /api/v1/users/me/profile

Requires authentication. Returns the caller's card.

### PATCH /api/v1/users/me/profile

Requires authentication. Partial update: an omitted field keeps its value, an
explicit `null` clears a field.

```json
{
  "steam_id": "[U:1:12345]",
  "steam_friend_code": "12345678",
  "wanmei_id": "PW_10086",
  "5E_id": "8899",
  "signature": "AWP main, entry fragger.",
  "skill_level": "完美 C+",
  "looking_for": "想找固定车队",
  "other_game_ids": [{ "game": "Faceit", "account": "s1mple_f" }]
}
```

| Field | Type | Rules |
|---|---|---|
| `steam_id` | string \| null | SteamID64 (17 digits), SteamID3 `[U:1:...]`, SteamID2 `STEAM_0:1:...` or a `steamcommunity.com/profiles/<SteamID64>` link. Always stored normalised to SteamID64. Vanity links cannot be resolved without the Steam Web API and are rejected. |
| `steam_friend_code` | string \| null | Steam friend code, 6-12 digits, optional |
| `wanmei_id` | string \| null | 完美世界 id, 2-32 characters of `A-Z a-z 0-9 _ -` |
| `5E_id` | string \| null | 5E id, 2-32 characters of `A-Z a-z 0-9 _ -`. `five_e_id` is accepted as an alias |
| `signature` | string \| null | At most 200 characters, trimmed. Stored in the `bio` column of `user_profiles` (TASKS.md 4.2); `bio` is accepted as an input alias |
| `skill_level` | string \| null | At most 32 characters (水平) |
| `looking_for` | string \| null | At most 100 characters (想找队友) |
| `other_game_ids` | array \| null | At most 5 `{ "game": ..., "account": ... }` entries, each field at most 32 characters |

Unknown fields are rejected with `40000`.

Errors:

| Code | HTTP | When |
|---:|---:|---|
| 40000 | 400 | Empty payload, unknown field, invalid id/format, or too long text |
| 40002 | 401 | Missing / invalid token |
| 40900 | 409 | The platform id is already bound to another account |

### GET /api/v1/users/:userId/profile

Public (no token). Returns the same card object.

Errors: `40400` user not found.

### POST /api/v1/users/me/avatar

Requires authentication. `multipart/form-data` with one `file` field.

```bash
curl -X POST http://127.0.0.1:8000/api/v1/users/me/avatar \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@avatar.png"
```

| Rule | Value |
|---|---|
| Size | at most **2 MB** |
| Format | JPEG, PNG or WebP, verified by decoding the image |
| Output | resized to **512x512** JPEG (quality 82), EXIF rotation applied |
| Storage | `uploads/avatars/<userId>/<uuid>.jpg`, served on `/uploads/avatars/...` |
| Replacement | uploading again deletes the previous file |

Response `data`:

```json
{
  "avatar_url": "/uploads/avatars/1/9f8c2b1d-4e5a-4c3f-8a7b-6d5e4f3a2b1c.jpg",
  "content_type": "image/jpeg",
  "size_bytes": 48211,
  "width": 512,
  "height": 512
}
```

Errors: `40000` not an image / empty file, `40002` missing token, `41300` larger
than 2 MB.

### DELETE /api/v1/users/me/avatar

Requires authentication. Deletes the resized file from disk, clears
`avatar_url` and returns the card object. Deleting when no avatar exists still
succeeds.

## 4. Lobby（组队大厅）

The lobby is a **team-code sharing board**, not a roster manager. A short-handed
team publishes its in-game `team_code`; a visitor claims the code and appears as
a **virtual claimant**. Claiming does **not** join the team and does **not**
change `current_players` or `slots_needed`.

- `current_players` is declared by the owner. A 5-player team with
  `current_players: 4` is exactly "4缺1".
- The hall lists only unexpired posts where `current_players < team_size`.
- `team_code` is visible only to the owner and to users who have claimed it;
  public responses return `null`. The claim response returns it explicitly.
- The owner can **depart (发车)**: the post becomes `departed`, leaves the hall,
  is hidden from everyone except the owner, and rejects new claims.
- The owner can **kick** a claimant: that claimant disappears from `claimants`
  and cannot claim the same post again.
- Posts expire after `LOBBY_TTL_HOURS` (default 24) and are removed lazily on
  lobby reads and claims. The owner can delete a post as soon as the team is
  formed.
- Public reads, authenticated writes, and **no chat or messaging endpoints**.
- `avatar_url` is relative to the API origin, exactly like the profile card.

### Lobby object

This example is the detail returned to a user who has claimed the code.

```json
{
  "id": 3,
  "title": "Mirage 4缺1",
  "description": "AWP main, looking for a support player.",
  "mode": "premier",
  "map": "Mirage",
  "region": "Asia",
  "skill_level": "完美 C+",
  "team_size": 5,
  "current_players": 4,
  "slots_needed": 1,
  "claim_count": 1,
  "status": "open",
  "departed_at": null,
  "team_code": "CS2-MIRAGE-8899",
  "owner_id": 1,
  "owner": {
    "user_id": 1,
    "username": "s1mple_fan",
    "nickname": "S1",
    "avatar_url": "/uploads/avatars/1/9f8c2b1d.jpg",
    "skill_level": "完美 C+"
  },
  "is_owner": false,
  "is_claimed": true,
  "can_claim": false,
  "expires_at": "2026-10-22T09:30:00.000Z",
  "created_at": "2026-10-21T09:30:00.000Z",
  "updated_at": "2026-10-21T09:35:00.000Z",
  "claimants": [
    {
      "user_id": 7,
      "username": "entry_fragger",
      "nickname": "Entry",
      "avatar_url": null,
      "skill_level": "5E 2200",
      "claimed_at": "2026-10-21T09:32:00.000Z",
      "is_you": true
    }
  ]
}
```

Notes:

- `team_code` is `null` for anonymous requests and for logged-in users who have
  not claimed the code.
- `claimants` are **virtual players**, not members. They do not affect
  `current_players` or `slots_needed`; the team remains in the hall.
- Multiple users may claim the same code. `claim_count` is the number of
  **active** claimants, and `is_you` marks the caller inside `claimants`.
- `can_claim` is `true` for a non-owner who has not claimed the code while the
  team is still short-handed. Anonymous requests also get `true`; the claim
  endpoint itself still requires a token.
- `status` is `open` normally and `departed` after the owner departs (发车). A
  `departed` post is only readable by its owner; for everyone else detail and
  claim return `40400`.
- Kicked users are removed from `claimants` and `claim_count`; their claim row
  is kept internally so they cannot claim again.
- `expires_at` is when the post is removed from the hall.

### GET /api/v1/lobbies

Public, paginated, newest first. Only unexpired, short-handed, **open** teams
are returned; a departed team or a team that has filled its roster offline is
not shown. Every item uses the lobby object with `claimants`.

| Query | Default | Rules |
|---|---|---|
| `page` | 1 | Positive integer |
| `pageSize` | 20 | 1-50 |
| `mode` | - | `competitive`, `premier` or `wingman` |

Response `data`:

```json
{
  "items": [],
  "page": 1,
  "pageSize": 20,
  "total": 0
}
```

Errors: `40000` malformed pagination/filter values, `40002` an invalid token was
supplied.

### POST /api/v1/lobbies

Requires authentication. Publishes a team and its team code.

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

| Field | Type | Rules |
|---|---|---|
| `title` | string | Required, 1-60 characters after trimming |
| `description` | string \| null | Optional, at most 300 characters |
| `mode` | string | Optional, `competitive` (default), `premier` or `wingman` |
| `map` | string \| null | Optional, at most 32 characters |
| `region` | string \| null | Optional, at most 32 characters |
| `skill_level` | string \| null | Optional, at most 32 characters |
| `team_size` | integer | Required, 2-10 |
| `current_players` | integer | Required, 1 to `team_size - 1` (4 for a 5-player 4缺1 post) |
| `team_code` | string | Required, 4-64 characters, no control characters |

Unknown fields are rejected. Response is HTTP 201 with the full lobby object.
The owner can see `team_code` in this response and in later reads.

Errors: `40000` invalid or unknown field, `40002` missing / invalid token.

### GET /api/v1/lobbies/{lobbyId}

Public. Returns the full lobby object and its `claimants`. `team_code` is
included only when the caller is the owner or has claimed the code. After the
owner departs, only the owner can read the post; everyone else gets `40400`.

Errors: `40002` an invalid token was supplied, `40400` lobby not found,
expired, or departed for a non-owner.

### POST /api/v1/lobbies/{lobbyId}/claim

Requires authentication. Reveals the team code and creates a virtual claim for
the caller. `POST /api/v1/lobbies/{lobbyId}/join` is a compatibility alias.

This does **not** add a member, does **not** change `current_players` or
`slots_needed`, and does **not** remove the post from the hall. Other players
may still claim the same code. The first person to actually join the in-game
lobby is still decided by CS2, not by this API.

Response `data` (the nested `lobby` is abbreviated here; it has the full detail
shape):

```json
{
  "team_code": "CS2-MIRAGE-8899",
  "lobby_id": 3,
  "claimed_at": "2026-10-21T09:32:00.000Z",
  "lobby": {
    "id": 3,
    "team_size": 5,
    "current_players": 4,
    "slots_needed": 1,
    "claim_count": 1,
    "is_claimed": true,
    "team_code": "CS2-MIRAGE-8899",
    "claimants": [
      {
        "user_id": 7,
        "username": "entry_fragger",
        "nickname": "Entry",
        "avatar_url": null,
        "skill_level": "5E 2200",
        "claimed_at": "2026-10-21T09:32:00.000Z",
        "is_you": true
      }
    ]
  }
}
```

The full `lobby` object has the same shape as the detail response. Claiming
again is idempotent: the same `claimed_at` and code are returned.

Errors:

| Code | HTTP | When |
|---:|---:|---|
| 40002 | 401 | Missing / invalid token |
| 40300 | 403 | The caller owns this post, or was kicked from it |
| 40400 | 404 | Lobby not found, expired, or already departed |
| 40900 | 409 | The declared roster is already full |

### DELETE /api/v1/lobbies/{lobbyId}/claim

Requires authentication. Cancels the caller's virtual claim and hides the code
again in subsequent responses. `DELETE /api/v1/lobbies/{lobbyId}/leave` is a
compatibility alias. The declared roster is unchanged.

Returns the updated lobby object. Errors: `40002` missing token, `40400` lobby
not found, departed, kicked, or the caller has no active claim.

### POST /api/v1/lobbies/{lobbyId}/depart

Requires authentication and lobby ownership. Marks the post as `departed`
(发车):

- `status` becomes `departed` and `departed_at` is set;
- the post disappears from `GET /api/v1/lobbies`;
- `GET /api/v1/lobbies/{lobbyId}` returns `40400` for everyone except the owner;
- existing claims stay in the database but can no longer view the post or claim
  the code again;
- the owner may still read the post, kick claimants, or delete it.

Calling it again is idempotent. Returns the updated lobby object (owner view).

Errors: `40002` missing token, `40300` caller is not the owner, `40400` lobby not
found or expired.

### DELETE /api/v1/lobbies/{lobbyId}/claimants/{userId}

Requires authentication and lobby ownership. Kicks one virtual claimant:

- the claim row becomes `kicked`, `kicked_at` is set;
- the user disappears from `claimants`, and `claim_count` decreases;
- the user's `team_code` becomes `null` in later reads;
- the user cannot claim this post again (`40300`).

Returns the updated lobby object (owner view). The owner can kick while the post
is open or already departed.

Errors: `40002` missing token, `40300` caller is not the owner, `40400` lobby not
found or the target has no active claim.

### DELETE /api/v1/lobbies/{lobbyId}

Requires authentication and lobby ownership. Deletes the post and all of its
virtual claims. Returns:

```json
{ "id": 3 }
```

Errors: `40002` missing token, `40300` caller is not the owner, `40400` lobby not
found.

### Expiry

`LOBBY_TTL_HOURS` controls the lifetime of a post (default **24** hours, maximum
8760). Expired posts are deleted lazily whenever the hall, a detail, or a claim
is requested. A claim does not extend the lifetime.

## 5. Friends（好友）

Friend relationships are mutual: a request must be accepted before either user
appears in the other's friend list. All friend endpoints require a valid token.
Friend lists are private; there is no public friend-list endpoint and no chat.

### User summary

Search results, requests and friend lists use this public summary:

```json
{
  "user_id": 7,
  "username": "entry_fragger",
  "nickname": "Entry",
  "avatar_url": null,
  "skill_level": "5E 2200",
  "signature": "Entry fragger, I play after 8pm.",
  "looking_for": "想找固定车队"
}
```

`avatar_url` is relative to the API origin. Missing profile fields are `null`.

### GET /api/v1/users/search

Requires authentication. Finds users to add as friends. The caller is excluded
from the results.

| Query | Default | Rules |
|---|---|---|
| `q` | required | 2-32 characters, matches `username` or `nickname` (case-insensitive for ASCII) |
| `page` | 1 | Positive integer |
| `pageSize` | 20 | 1-50 |

Each item is a user summary plus a `relationship`:

| `relationship` | Meaning |
|---|---|
| `none` | No request and not friends |
| `outgoing_request` | I have sent this user a pending request |
| `incoming_request` | This user has sent me a pending request |
| `friend` | Already friends |

Response `data`:

```json
{
  "items": [
    {
      "user_id": 7,
      "username": "entry_fragger",
      "nickname": "Entry",
      "avatar_url": null,
      "skill_level": "5E 2200",
      "signature": "Entry fragger, I play after 8pm.",
      "looking_for": "想找固定车队",
      "relationship": "none"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 1
}
```

Errors: `40000` missing/invalid `q` or pagination, `40002` missing / invalid
token.

### POST /api/v1/friends/requests

Requires authentication. Sends a pending friend request.

```json
{ "user_id": 7 }
```

Response is HTTP 201 with a request object:

```json
{
  "id": 12,
  "direction": "outgoing",
  "status": "pending",
  "user": {
    "user_id": 7,
    "username": "entry_fragger",
    "nickname": "Entry",
    "avatar_url": null,
    "skill_level": "5E 2200",
    "signature": null,
    "looking_for": null
  },
  "created_at": "2026-10-23T10:00:00.000Z",
  "updated_at": "2026-10-23T10:00:00.000Z",
  "accepted_at": null
}
```

Rules:

- `user_id` must be an existing user and cannot be the caller.
- One canonical row per pair; A→B and B→A cannot both be pending.
- If the other user already sent a request, tell the caller to accept it
  instead of creating a reverse request.
- Accepted friends and existing pending requests return `40900`.

Errors: `40000` invalid body / self / unknown field, `40002` missing token,
`40400` target user not found, `40900` duplicate or already friends.

### GET /api/v1/friends/requests

Requires authentication. Returns all pending requests for the caller:

```json
{
  "incoming": [],
  "outgoing": [],
  "incoming_count": 0
}
```

- `incoming`: requests sent to me.
- `outgoing`: requests I sent.
- `incoming_count` can be used as the notification badge.
- Every item uses the request object shown above. `direction` is `incoming` or
  `outgoing`, and `user` is the other person.

### POST /api/v1/friends/requests/{requestId}/accept

Requires authentication. Only the recipient can accept. The row becomes
`status: "accepted"`, and the two users immediately appear in each other's
friend list. The response is the request object with `status: "accepted"` and
`accepted_at` set.

Errors: `40002` missing token, `40300` caller is the requester (not recipient),
`40400` request not found or caller is not a participant, `40900` request is no
longer pending.

### POST /api/v1/friends/requests/{requestId}/reject

Requires authentication. Only the recipient can reject. The request is deleted,
so it disappears from both request lists. The response is the request object with
`status: "rejected"`. The sender may send a new request later.

Errors: `40002` missing token, `40300` caller is the requester, `40400` request
not found or not a participant, `40900` request is no longer pending.

### DELETE /api/v1/friends/requests/{requestId}

Requires authentication. Only the sender can cancel an outgoing pending request.
The row is deleted. The response is the request object with
`status: "cancelled"`.

Errors: `40002` missing token, `40300` caller is the recipient, `40400` request
not found or not a participant, `40900` request is no longer pending.

### GET /api/v1/friends

Requires authentication. Returns only the caller's accepted friends, newest
friendship first.

| Query | Default | Rules |
|---|---|---|
| `page` | 1 | Positive integer |
| `pageSize` | 20 | 1-50 |

Response `data`:

```json
{
  "items": [
    {
      "friendship_id": 4,
      "user": {
        "user_id": 7,
        "username": "entry_fragger",
        "nickname": "Entry",
        "avatar_url": null,
        "skill_level": "5E 2200",
        "signature": "Entry fragger, I play after 8pm.",
        "looking_for": "想找固定车队"
      },
      "friends_since": "2026-10-23T10:01:00.000Z"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 1
}
```

Errors: `40000` invalid pagination, `40002` missing / invalid token.

### DELETE /api/v1/friends/{userId}

Requires authentication. Removes an accepted friend for **both** users. Returns:

```json
{ "user_id": 7 }
```

The two users may send a new friend request afterwards.

Errors: `40000` invalid/self user id, `40002` missing token, `40400` the users are
not friends.

### Friend errors

| Code | HTTP | When |
|---:|---:|---|
| 40000 | 400 | Invalid body, self request, invalid search/pagination |
| 40002 | 401 | Missing / invalid token |
| 40300 | 403 | Acting as the wrong side of a request |
| 40400 | 404 | User or friend request not found |
| 40900 | 409 | Already friends, duplicate/reverse pending request, or already handled |

## 6. Mini Games (Draft)

### POST /api/v1/minigames/aim/scores

### GET /api/v1/minigames/aim/leaderboard

## 7. Replay analysis

The current frontend contract is implemented. Use POST /analysis-packages, then
POST /matches/{match_id}/analyses with Idempotency-Key. Poll GET /analyses/{analysis_id};
completed and partial both expose GET /analyses/{analysis_id}/report.

GET /matches and GET /matches/{match_id}/analyses provide history. GET
/analysis-packages/{package_id}/evidence projects the legacy contract; add
?version=1.1 for detailed data. DELETE /analysis-packages/{package_id} and DELETE
/analyses/{analysis_id} remove non-running resources. GET /analyses/{analysis_id}/details
provides additional rule analysis. All resources are scoped to the logged-in user.

Both ZIP schema 1.1.0 and 1.2.0 are supported. For v1.2 packages, GET
`/analysis-packages/{package_id}/global` returns all-player statistics and metadata.
GET `/analysis-packages/{package_id}/global/{kind}` accepts `events`, `samples`, or
`trajectories`, with `round_num`, `offset`, and `limit` pagination. Follow
`next_offset` until null; byte limits can shorten a page. These streams are
separate from target-player evidence and must not be added together.

`evidence?version=1.1` remains a target-only projection. Explicit
`evidence?version=1.2` returns the complete events document as an object (including
`items`, `global_items`, and `global_coverage`) and the full map document.
See [v1.2 integration details](../backend/REPLAY_V12.md).

See [full API and operational guide](../backend/REPLAY.md) and the original
[OpenAPI contract](../backend/contracts/openapi.json). The original handoff OpenAPI
also describes local-parser endpoints; those run in the local parser, not this cloud server.
Old /demos endpoints remain for legacy clients only.

### Replay tab compatibility endpoints

The Vue frontend also uses these authenticated endpoints:

```text
GET /api/v1/analyses/{analysisId}/rounds/{round}
GET /api/v1/analyses/{analysisId}/rounds/{round}/map?limit=200&offset=0
GET /api/v1/analysis-packages/{packageId}/events
```

- `rounds/{round}` returns the saved round detail (`round-<n>.json`).
- `/map` returns `{ items, next_offset }`; `limit` is 1-500.
- `events` returns `{ match_id, package_id, events }` for the target player's
  event stream.
- All three return `404` when the analysis/package does not belong to the caller.


## 8. Demo File Analysis (raw `.dem`)

These endpoints accept a raw CS2 demo instead of a parsed ZIP. The server runs
`parser/parse_demo.py` (awpy) in a queued child process, then builds the same
report shapes as the ZIP pipeline and can generate the AI coach from the parsed
facts. Design and failure matrix: [ai-demo-analysis-design.md](ai-demo-analysis-design.md).

Every endpoint requires `Authorization: Bearer <access_token>`.

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/demo-analyses/parser` | Parser availability, awpy version, AI configuration |
| POST | `/api/v1/demo-analyses` | Upload a `.dem` (multipart `file`, ≤512 MiB) |
| GET | `/api/v1/demo-analyses` | My demo analyses (`page`, `pageSize` ≤100) |
| GET | `/api/v1/demo-analyses/{demoId}` | Status and summary |
| GET | `/api/v1/demo-analyses/{demoId}/report` | Standard report (`report.schema.json`) |
| GET | `/api/v1/demo-analyses/{demoId}/details` | Extended report (modules, findings, rounds, movement) |
| GET | `/api/v1/demo-analyses/{demoId}/rounds/{round}` | One round with events and finding ids |
| GET | `/api/v1/demo-analyses/{demoId}/rounds/{round}/map` | Paginated map JSONL (`offset`, `limit` ≤500) |
| GET | `/api/v1/demo-analyses/{demoId}/evidence/{eventId}` | One evidence event |
| GET | `/api/v1/demo-analyses/{demoId}/ai` | AI result, or status + `queued`/`last_error` |
| POST | `/api/v1/demo-analyses/{demoId}/ai` | Queue AI coaching (`?force=true` regenerates) |
| DELETE | `/api/v1/demo-analyses/{demoId}` | Delete the analysis and its AI jobs |

### POST /api/v1/demo-analyses

`multipart/form-data`:

| Field | Type | Required | Notes |
|---|---|---|---|
| `file` | binary | yes | CS2 demo, magic `PBDEMS2`; `.dem` extension not enforced |
| `target_player_id` | string | no | SteamID64; defaults to the top fragger |

The file must be a CS2 (Source 2) demo. `HL2DEMO` (CS:GO) and gzip-compressed
files are rejected with `40000`.

```json
{
  "demo_id": "4f1c2f7e-5a5c-4d5a-9f2f-4c1f0f2a7b11",
  "status": "queued",
  "stage": "queued",
  "progress": null,
  "report_available": false,
  "target_player_id": null,
  "target_selection": "auto_top_fragger",
  "file_name": "match.dem",
  "size_bytes": 60601900,
  "ai_status": "not_configured",
  "created_at": "2026-10-28T12:00:00.000Z"
}
```

HTTP `202` for a new job, `200` when an identical upload (same bytes, same
target) is reused. Uploading the same demo with a different `target_player_id`
creates a separate analysis.

### GET /api/v1/demo-analyses/{demoId}

```json
{
  "demo_id": "4f1c2f7e-…",
  "status": "completed",
  "stage": "ready",
  "progress": 100,
  "message": "报告已保存",
  "report_available": true,
  "target_player_id": "76561197964020430",
  "target_selection": "auto_top_fragger",
  "map": "de_mirage",
  "score": { "terrorist": 8, "counter-terrorist": 2 },
  "rounds": 10,
  "ai_status": "completed",
  "created_at": "2026-10-28T12:00:00.000Z",
  "analyzed_at": "2026-10-28T12:00:03.000Z"
}
```

`status` is one of `queued`, `parsing`, `analyzing`, `reporting`, `completed`,
`failed`. `progress` is `null` until completion because parse time depends on
demo size. `ai_status` is `not_configured`, `not_generated`, `queued`,
`completed` or `failed`.

### POST /api/v1/demo-analyses/{demoId}/ai

Queues a `kind=ai` job and returns `202`:

```json
{
  "demo_id": "4f1c2f7e-…",
  "ai_job_id": "8b2d…",
  "ai_status": "queued",
  "message": "AI 教练解读已排队，请轮询 GET /demo-analyses/{id}/ai"
}
```

If a result already exists the stored object is returned with `200`; use
`?force=true` to discard it and regenerate. AI failure never modifies
`report.json` / `cloud-report.json`. `GET /ai` exposes `queued`, `stage` and
`last_error` while a job runs or after it fails.

Set `AI_AUTO_ANALYZE=true` to queue the coach automatically once a demo report is
ready.

Errors:

| Code | HTTP | When |
|---|---|---|
| 40000 | 400 | Not a CS2 demo, CS:GO demo, gzip, bad `target_player_id` or pagination |
| 40002 | 401 | Missing / invalid token |
| 40400 | 404 | Demo not found or not owned by caller |
| 40900 | 409 | Report not ready, capacity reached, AI already running |
| 41300 | 413 | Demo exceeds 512 MiB |
| 50200 | 502 | AI provider error, invalid JSON or unknown evidence ID |
| 50300 | 503 | `DEEPSEEK_API_KEY` is not configured |
| 50310 | 503 | Demo parser unavailable (no Python/awpy) |

Server configuration for the parser:

```env
DEMO_PARSER_PYTHON=
DEMO_PARSER_SCRIPT=
DEMO_PARSER_PYTHONPATH=
DEMO_PARSER_TIMEOUT_MS=300000
```

## 9. AI Coaching (optional)

AI coaching reads an already-ready rule report and calls an OpenAI-compatible
provider. It never receives the full map, raw events or the original ZIP. The
base report remains available if AI is disabled or fails.

All AI endpoints require authentication and an analysis whose base report is
ready.

### GET /api/v1/analyses/{analysisId}/ai

Returns an existing AI result, or a status object:

```json
{
  "ai_status": "not_configured",
  "analysis_id": "analysis-example",
  "model": "deepseek-chat"
}
```

`ai_status` may be `completed`, `not_generated` or `not_configured`.

### POST /api/v1/analyses/{analysisId}/ai

Generates AI coaching synchronously and stores `ai-report.json` in the private
analysis directory.

Server-only configuration:

```env
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
AI_TIMEOUT_MS=60000
AI_MAX_TOKENS=2000
AI_PROMPT_VERSION=coach-1.0.0
```

If `DEEPSEEK_API_KEY` is empty, the endpoint returns `50300` and makes no
network call.

Response `data` shape:

```json
{
  "ai_status": "completed",
  "analysis_id": "analysis-example",
  "model": "deepseek-chat",
  "prompt_version": "coach-1.0.0",
  "generated_at": "2026-10-24T12:00:00.000Z",
  "summary": "本场主要提升点是道具使用时机和闪光弹安全性。",
  "improvement_areas": [
    {
      "priority": "high",
      "category": "utility",
      "title": "死亡时未使用道具偏多",
      "evidence_ids": ["death_17", "death_42"],
      "explanation": "多次死亡时仍携带可用道具。",
      "training": ["交火前先规划道具用途。"]
    }
  ],
  "strengths": [],
  "data_limitations": ["烟雾弹和燃烧弹缺少投掷者归属。"]
}
```

Errors:

| Code | HTTP | When |
|---:|---:|---|
| 40002 | 401 | Missing / invalid token |
| 40400 | 404 | Analysis not found or not owned by caller |
| 40900 | 409 | Base report is not ready |
| 50200 | 502 | Provider error, timeout, invalid JSON or unknown evidence ID |
| 50300 | 503 | `DEEPSEEK_API_KEY` is not configured |

## 10. Error Codes

| Code | HTTP | Description |
|---:|---:|---|
| 0 | 200 | Success |
| 40000 | 400 | Invalid parameter |
| 40001 | 401 | Invalid username or password |
| 40002 | 401 | Invalid or expired token |
| 40300 | 403 | Forbidden |
| 40400 | 404 | Resource not found |
| 40900 | 409 | Resource conflict |
| 41300 | 413 | File too large |
| 50000 | 500 | Internal server error |
| 50200 | 502 | AI provider error, invalid AI JSON or unknown evidence ID |
| 50300 | 503 | AI analysis is not configured |
| 50310 | 503 | Demo parser unavailable (no Python/awpy) |

## 11. Changelog

| Version | Date | Author | Description |
|---|---|---|---|
| v1.0 | 2026-10-01 | CS Demo Master Team | Initial API document |
| v1.1 | 2026-10-17 | CS Demo Master Team | Documented authentication and the personal card (TASKS.md 4.4): platform ids, signature, extra fields, avatar upload/resize rules |
| v1.2 | 2026-10-17 | CS Demo Master Team | Added `steam_friend_code` and removed the at-least-one-platform-id restriction |
| v1.3 | 2026-10-22 | CS Demo Master Team | Reworked the lobby hall into a team-code sharing board (TASKS.md 4.5): declared roster, virtual claims, code privacy, owner deletion and TTL cleanup; no chat |
| v1.4 | 2026-10-23 | CS Demo Master Team | Added owner depart (发车) and claimant kick: departed posts are owner-only and stop claims; kicked users are removed from claimants and cannot re-claim |
| v1.5 | 2026-10-23 | CS Demo Master Team | Added mutual friend requests, accept/reject/cancel, private friend list, remove friend, and authenticated user search with relationship states |
| v1.6 | 2026-10-24 | CS Demo Master Team | Added optional AI coaching endpoints backed by a server-side DeepSeek/OpenAI-compatible provider; disabled without `DEEPSEEK_API_KEY` |
| v1.7 | 2026-10-28 | CS Demo Master Team | Added raw `.dem` upload and analysis (`/api/v1/demo-analyses`): server-side awpy parsing, rule report, map points, evidence and queued demo-grounded AI coaching; new code `50310` |
