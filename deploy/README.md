# CS Demo Master Deployment

This repository contains:

```text
backend/    Node.js + Express API + replay worker
frontend/   Vue 3 + Vite production frontend
deploy/     Nginx and systemd examples
```

## Release branch

The deployable integration branch is `release/cloud-test`: latest ZIP replay backend
(v1.1/v1.2), optional AI coaching, lobby/friends/profile/auth, and the
`front_end` Vue application.

## 1. Server prerequisites

- Node.js 22+ (needed for `node:sqlite`)
- pnpm 11.25.0 for the frontend
- Nginx
- Persistent disk for SQLite, avatars and replay packages

## 2. Build frontend

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm build
```

The production build is in:

```text
frontend/dist/
```

`frontend/.env.production` sets the public API base to `/api/v1` and disables
mock modules. The local parser URL is intentionally empty; the cloud UI must not
depend on a user's local `127.0.0.1:8877` service.

## 3. Install backend

```bash
cd backend
npm ci --omit=dev
cp .env.example .env
```

Edit `.env`:

```env
PORT=8000
JWT_SECRET=replace-with-a-long-random-string
JWT_EXPIRES_IN=7d
DB_PATH=/var/lib/cs-demo-master/app.db
UPLOAD_DIR=/var/lib/cs-demo-master/uploads
REPLAY_DIR=/var/lib/cs-demo-master/replays
LOBBY_TTL_HOURS=24

DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
AI_TIMEOUT_MS=60000
AI_MAX_TOKENS=2000
AI_PROMPT_VERSION=coach-1.0.0
```

The SQLite database and storage directories are created automatically.
`DEEPSEEK_API_KEY` may stay empty; AI endpoints then return `50300` while the
rule report and the rest of the application remain available.

Start the backend:

```bash
npm start
```

For production use the systemd example:

```bash
sudo cp deploy/systemd/cs-demo-master.service.example \
  /etc/systemd/system/cs-demo-master.service
sudo systemctl daemon-reload
sudo systemctl enable --now cs-demo-master
sudo systemctl status cs-demo-master
```

## 4. Nginx

Root-domain example:

```bash
sudo cp deploy/nginx/cs-demo-master.conf.example \
  /etc/nginx/sites-available/cs-demo-master
sudo ln -s /etc/nginx/sites-available/cs-demo-master \
  /etc/nginx/sites-enabled/cs-demo-master
sudo nginx -t
sudo systemctl reload nginx
```

Subpath example (for `/cs2/`):

```bash
# Build with the matching public base path and API base:
cd frontend
VITE_BASE_PATH=/cs2/ VITE_API_BASE_URL=/cs2/api/v1 pnpm build
```

Then use:

```text
deploy/nginx/cs-demo-master-subpath.conf.example
```

The frontend is a Vue history-mode SPA, so Nginx must fall back to
`index.html`. `/api/` and `/uploads/` must be proxied to the Node backend; do
not serve them from the static directory.

## 5. Persistence

Never delete these on redeploy:

```text
DB_PATH
UPLOAD_DIR
REPLAY_DIR
```

If using Docker or a cloud container, mount them as persistent volumes.

## 6. Smoke test after deployment

Open the frontend, then check:

1. Register and log in.
2. Read and edit the profile card; upload an avatar.
3. Create a lobby and claim a team code with a second account.
4. Search a user and send/accept a friend request.
5. Upload a v1.1 or v1.2 ZIP replay package.
6. Create an analysis, poll until `completed` or `partial`.
7. Open the report, round map, events and evidence.
8. Call AI:
   - empty `DEEPSEEK_API_KEY`: `50300` / `not_configured`
   - configured key: `completed` with `improvement_areas`

## 7. Security checklist

- Set a strong `JWT_SECRET`.
- Use HTTPS.
- Keep `.env` and `DEEPSEEK_API_KEY` off Git and out of `VITE_*`.
- Restrict `/debug/` or remove it in production (the previous debug console is
  not part of this release).
- Run the backend as a non-root user.
- Back up `DB_PATH`, `UPLOAD_DIR` and `REPLAY_DIR`.
