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

## 4. Lobby

### GET /api/v1/lobbies

### POST /api/v1/lobbies

### GET /api/v1/lobbies/{lobbyId}

### POST /api/v1/lobbies/{lobbyId}/join

### DELETE /api/v1/lobbies/{lobbyId}/leave

### POST /api/v1/lobbies/{lobbyId}/ready

### POST /api/v1/lobbies/{lobbyId}/unready

### POST /api/v1/lobbies/{lobbyId}/start

## 5. Mini Games (Draft)

### POST /api/v1/minigames/aim/scores

### GET /api/v1/minigames/aim/leaderboard

## 6. Demo Analysis (Draft)

### POST /api/v1/demos

### POST /api/v1/demos/{demoId}/analyze

### GET /api/v1/demos/{demoId}/status

### GET /api/v1/demos/{demoId}/report

## 7. Error Codes

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

## 8. Changelog

| Version | Date | Author | Description |
|---|---|---|---|
| v1.0 | 2026-10-01 | Shiyu Qian | Initial API document |
| v1.1 | 2026-10-17 | Shiyu Qian | Documented authentication and the personal card (TASKS.md 4.4): platform ids, signature, extra fields, avatar upload/resize rules |
| v1.2 | 2026-10-17 | Shiyu Qian | Added `steam_friend_code` and removed the at-least-one-platform-id restriction |
