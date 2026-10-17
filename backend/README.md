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

Copy `.env.example` to `.env` to override `PORT`, `JWT_SECRET`, `DB_PATH` and
`UPLOAD_DIR`. The SQLite file and the upload folder are created automatically.

## Implemented: Personal Card (TASKS.md 4.4)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/auth/register` | - | Create an account, returns a JWT |
| POST | `/api/v1/auth/login` | - | Log in, returns a JWT |
| GET | `/api/v1/users/me` | yes | Current account |
| GET | `/api/v1/users/me/profile` | yes | My personal card |
| PATCH | `/api/v1/users/me/profile` | yes | Update platform ids / signature / extra fields |
| GET | `/api/v1/users/:userId/profile` | - | Public card |
| POST | `/api/v1/users/me/avatar` | yes | Upload avatar (multipart `file`) |
| DELETE | `/api/v1/users/me/avatar` | yes | Remove avatar |

Design notes:

- The card is `user_profiles`; credentials and `avatar_url` stay in `users`, as
  planned in TASKS.md 4.2.
- The signature lives in the `bio` column (TASKS.md 4.2) and is exposed as
  `signature`; requests may also send `bio`.
- `steam_id` / `wanmei_id` / `five_e_id` are NULL when unbound and carry UNIQUE
  indexes, so one platform account can belong to one user only. "At least one
  platform id" is checked against the **resulting** card, so a rejected update
  changes nothing.
- `5E_id` starts with a digit: the JSON/API name is `5E_id`, the column and
  attribute are `five_e_id`, and requests may use either spelling.
- Avatars are validated with sharp (real JPEG/PNG/WebP), resized to 512x512
  JPEG and written to `uploads/avatars/<userId>/`. Only the URL is stored in
  SQLite, and the file is served with `X-Content-Type-Options: nosniff`.
- The card row is created lazily on the first write, so reading a fresh account
  returns an empty card without touching the database.

## Tests

```bash
npm test
```

`tests/profile.test.js` runs against an in-memory SQLite database and a
temporary upload folder; it covers registration/JWT errors, the at-least-one
platform rule, Steam id normalisation, field validation, uniqueness conflicts,
the public card, and every avatar rule (resize to 512x512, 2 MB limit, non-image
rejection, replacement, deletion).

## Layout

```text
backend/
  src/
    app.js                   Express app, /uploads static, 404 + error handler
    server.js                dotenv + listen
    config/database.js       node:sqlite connection and schema
    middlewares/auth.js      Bearer token -> request.user
    middlewares/errorHandler.js
    routes/auth.js           register / login
    routes/users.js          me, profile, avatar
    services/authService.js
    services/profileService.js   card validation, Steam ids, avatar resizing
    utils/response.js        { code, message, data } envelope + ApiError
    utils/asyncHandler.js
  tests/profile.test.js
  uploads/avatars/           runtime, git ignored
  data/                      SQLite file, git ignored
```
