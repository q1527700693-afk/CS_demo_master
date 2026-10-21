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

Not implemented yet:

- Lobby APIs
- Demo analysis APIs
- AI report APIs
- Mini-game APIs

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
`JWT_SECRET`, `DB_PATH` or `UPLOAD_DIR`.

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
  "username": "qianshiyu",
  "password": "12345678",
  "nickname": "钱施宇"
}
```

Login:

```http
POST /api/v1/auth/login
Content-Type: application/json
```

```json
{
  "username": "qianshiyu",
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
      "username": "qianshiyu",
      "nickname": "钱施宇",
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

## API Documentation

Full API details:

- [docs/api-v1.md](docs/api-v1.md)

## Backend Tasks

- [backend/TASKS.md](backend/TASKS.md)

## Team

- Backend Lead: Shiyu Qian
- Frontend:
- Parser:
- AI:
- Docs / QA:
