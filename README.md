# CS Demo Master frontend

## Web release v1.3.3

The overview and match report show the selected player's team score first, including after halftime and overtime side switches. Older reports can recover Rating and utility damage from recorded statistics and events. Estimated Rating values are labeled. The tactical radar includes Cobblestone and eight additional maps.

New cloud and local parses record player positions every 8 ticks, or every 0.125 seconds in a 64-tick demo. The player interpolates between recorded positions every 0.1 seconds of match time. Existing reports retain their original sample spacing. See the [release notes](docs/RELEASE.md).

### Earlier web releases

- **v1.3.1** updated utility damage, key plays, trades, economy analysis, player Rating and overview status. Follow-up fixes addressed browser caching, update detection in open tabs, and per-player throw counts for all six utility types. See the [review notes](docs/REVIEW-v1.3.1.md), [web update notes](docs/WEB-UPDATE-v1.3.1.md), [throw-count notes](docs/UTILITY-v1.3.1.md) and [handoff guide](HANDOFF.md).
- **v1.3.0** added Dust II tactical analysis, weapon highlights, rotations and round-by-round review. See the [cloud demo API notes](docs/CLOUD-DEMO-v1.3.0.md) and [handoff guide](HANDOFF.md).

## Overview

This Vue 3, Vite and TypeScript frontend was developed for a software engineering course. Authentication, player profiles, friends, team lobbies and demo analysis use backend APIs. The training page embeds the team's VECTOR aim trainer. See the [friends and lobbies integration guide](docs/SOCIAL-LOBBY-INTEGRATION.md).

Since v1.0.1, the public replay library has loaded matches and reports from the backend. Local development on localhost or 127.0.0.1 can also use the local parser and library through the `/local` proxy. The local library requires Web Crypto's `crypto.subtle`, which is unavailable on public HTTP pages. Use HTTPS for public deployments. ZIP uploads and cloud review use `/api/v1`.

## Getting started

On Windows, run `start-local.cmd` from the parent workspace directory to start the frontend and backend and open the app. Run `stop-local.cmd` to stop the services started by the launcher. See the [local testing guide](../本地测试说明.md).

To run only the frontend, double-click `start.cmd` in this directory and open the address printed in the terminal, normally `http://127.0.0.1:5173`. Press Ctrl+C in that terminal to stop the server. The launcher supports installed pnpm or npm and the bundled Codex runtime on the development machine. Start the backend separately for sign-in and profile access. Its default address is `http://127.0.0.1:8000`. See the [account and profile integration guide](docs/AUTH-PROFILE-INTEGRATION.md) for the backend branch, commands and configuration.

On another machine, run these commands from the directory containing this README and `package.json`:

```sh
npm install
npm run dev
```

Use Node.js 20.19+ on the 20.x line, or 22.12+ on newer supported lines. A pnpm lockfile is included for teams using `pnpm install` and `pnpm dev`. The generated MSW worker is in `public/mockServiceWorker.js`. After updating MSW, run `npm run mock:init`.

Opening or refreshing the app plays a muted startup video for at least two seconds. The app opens once it is ready and the minimum time has elapsed. The video loops during slower loads. In-app navigation skips the splash screen. The progress bar reaches 100% when both startup conditions are met. The video is in `public/media/startup.mp4`. See the [startup guide](docs/STARTUP-SPLASH.md).

## Features

- Responsive navigation, shared layouts, page routing, a 404 page, and loading, empty and error states.
- Username registration and sign-in, JWT session restoration, local sign-out, expired-session handling and redirects for protected pages.
- Player cards with optional platform accounts, Steam friend codes, bios, skill levels, teammate preferences and other game accounts. Players can view public cards at `/players/:userId`, look up a card by ID or copy its link.
- Avatar upload, replacement and removal with immediate header updates. JPEG, PNG and WebP images are supported up to 2 MB.
- Player search by username or nickname, friend lists, incoming and outgoing requests, acceptance, rejection, withdrawal and removal. Public cards show the same friendship status as the friends page.
- Account-specific local best scores across five training modes, grouped by settings for comparison. The player card also reserves space for demo analysis records.
- Four-stage demo analysis progress, local parser connection, ZIP upload, module reports, utility trajectories, analysis history and retry controls.
- Team lobbies with mode filters, pagination, listings and shareable detail links. Players can claim or release a lobby code. Captains can start a session, remove members or delete a lobby.
- The complete VECTOR aim trainer with five modes, settings, results, records and tutorials.
- A shared request layer, common types, API documentation and optional mock services. Modules register centrally and support independent feature flags, lazy-loaded pages and retries after load failures.

The training integration copies the team's runtime files byte for byte. The embedded game replaces the platform's earlier placeholder cards, results page and mock leaderboard. See the [player cards and friends guide](docs/PLAYER-CARDS-AND-FRIENDS.md) for ownership and API boundaries.

The local awpy parser in `local_parser/` can turn a real demo into a ZIP independently. The frontend connects to the local service on port 8877 and also accepts manually exported ZIP files. In the local export workflow, the raw demo stays on the user's machine.

## Demo mode

Authentication and profiles use the real backend by default. For an offline account demo, set both `VITE_MOCK_AUTH` and `VITE_MOCK_PROFILE` to `true` in `.env.local`, then restart the frontend. Use the demo account button or enter the following credentials:

```text
Username: demo_player
Password: Demo123456!
```

Mock profile and replay records are stored in the browser. Newly registered mock credentials last for the current page session. After refreshing, use the demo account above. Real accounts and profiles are stored in the backend SQLite database, and the frontend uses a JWT for authentication.

Mock uploads validate the extension, file size and nonempty content. The four-stage flow uses synthetic data, and the page offers a downloadable five-file contract example. This mode skips ZIP parsing and cloud analysis. Its sample utility chart plots two-dimensional world coordinates without radar alignment, floor detection or coverage analysis.

## Connecting backend modules

Copy `.env.example` to `.env.local`. This example uses real account and profile services and mock replay data:

```dotenv
VITE_API_BASE_URL=/api/v1
VITE_PROXY_TARGET=http://127.0.0.1:8000
VITE_MOCK_AUTH=false
VITE_MOCK_PROFILE=false
VITE_MOCK_REPLAY=true
VITE_MOCK_LOBBY=false
```

Authentication, profiles and replay each have an optional mock switch. Friends and team lobbies always use the real backend. The legacy `VITE_MOCK_LOBBY` setting has no effect. Restart the development server after changing the configuration. When real authentication is combined with mock modules, those modules use the signed-in user's identity for local demo data.

During development, Vite proxies `/api` and avatar requests under `/uploads`. You can set `VITE_API_BASE_URL` to an absolute URL if the backend permits the frontend origin. Avatar URLs resolve against the API host. For production, disable all mocks and configure a same-origin reverse proxy or allow the frontend origin on the backend. Values prefixed with `VITE_` are included in the browser build, so keep server credentials elsewhere.

## Project structure

```text
src/app/                   Routing, module registry and feature configuration
src/layouts/               Shared layouts
src/components/            Reusable UI components
src/api/http.ts            Fetch, uploads and shared error handling
src/stores/                Authentication state and notifications
src/types/                 Account and profile contracts and shared module types
src/features/auth/         Sign-in and registration
src/features/profile/      Player profiles
src/features/replay/       Uploads, analysis status and reports
src/features/lobby/        Team lobbies
src/features/training/     Vue host for the aim trainer
src/mocks/                 Mock network layer
public/vector-trainer/     Bundled copy of the training runtime
scripts/sync-training.mjs  Training asset synchronization and SHA-256 tracking
docs/                      Backend API and game integration guides
```

Keep pages, feature-specific components and API functions in the corresponding `src/features/` directory. Pages access backend data through the feature's `api.ts`. Put shared UI in `src/components/` and cross-page identity in the auth store. Register routes, navigation entries and module availability together in `src/app/modules.ts`.

## Updating modules

The [module update guide](docs/MODULE-UPDATES.md) lists entry points for authentication, profiles, replay, lobbies, training and new features. Each module has its own pages and API adapter. Replay, profiles, lobbies and training also support `VITE_FEATURE_*` flags. Disabling a feature hides its navigation entry and displays an unavailable state for existing links.

Feature flags and mock switches are independent. Restart the development server after changing environment variables. Production changes require a new build and deployment. The application supports code and asset releases and open-tab update detection. It does not download and install patches in the app.

## Training integration

At `/training`, the frontend calls the trainer's public `mountTrainer` function and calls `destroy` when the user leaves. Both `npm run dev` and `npm run build` synchronize runtime files from `../training/CSPlatform/aim-trainer`. Run `npm run training:sync` to synchronize them separately. Only the training page loads these assets, and no separate game server is required. The trainer retains its original scoring, export and local record behavior. Its own records are shared within the browser and do not automatically sync to the cloud. See the [game integration guide](docs/GAME-INTEGRATION.md).

## API contracts

The [demo analysis handoff](docs/analysis-handoff/README.md) includes OpenAPI definitions, schemas, field types, and sample ZIP files and reports for backend implementers. The [API contract guide](docs/API-CONTRACT.md) documents integration details and differences. Accounts, profiles, friends, lobbies and replay have been integrated with the real backend. Cloud training APIs remain unimplemented.

Use the agreed OpenAPI specification or API documentation when integrating changes. Update the relevant feature API adapter and type definitions first so pages can share the same behavior.

## Validation and deployment

```sh
npm run typecheck
npm test
npm run test:social    # Friends, lobbies and profiles with an isolated database
npm run test:analysis  # Optional mock UI tests requiring Playwright and Chrome
npm run build
npm run preview
```

Serve the generated `dist/` directory over HTTP. History-mode routing requires a fallback to `index.html` for page routes. Forward `/api` and `/uploads` to the backend before applying that fallback. The game runtime loads on the training page, and the charting library loads on the report page.

Authentication reads `access_token` from the backend and sends it as a Bearer token. Sign-out clears the local JWT. A token that the server has not revoked remains valid until it expires.

## Exporting a real demo locally

Start the parser with `start-local-parser.cmd` in the workspace root. In the local parse and ZIP export view, enter the token from `local_parser/token.txt` and your nickname. Select a `.dem` file, read its player roster, select and confirm a SteamID, then calculate and download the ZIP. This workflow uses the local service on port 8877 and can run independently of the cloud analysis API. See the [local parser guide](../local_parser/README.md) for installation, caching and data limitations.

Detailed schema 1.1.0 packages include the selected player's damage, shots, items, economy, sampled states and related context. The earlier schema and mock examples use version 1.0.0. See the [detailed data format](docs/analysis-handoff/DETAILED-DATA-v1.1.md).
