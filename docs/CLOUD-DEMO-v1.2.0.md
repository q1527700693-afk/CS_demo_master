# Frontend v1.2.0 integration

## Runtime channels

The Electron user agent identifies the installed app even on a loopback origin. Regular browsers, including localhost development, enable raw Demo cloud upload and disable local parsing. Electron enables local parsing and disables raw Demo cloud upload. ZIP import remains available separately. The task store enforces the policy as well as the UI; this is feature selection, not an authentication boundary.

Cloud uploads probe GET /api/v1/demo-analyses/parser first and accept at most 512 MiB. Raw files are uploaded to the server. The app parses locally and uploads the parsed ZIP. Refreshing or closing a tab before the file upload finishes interrupts the transfer; created cloud jobs can be resumed from history.

## Independent reports

Cloud frontend ids are namespaced as cloud:<demo_id>; HTTP requests strip the prefix. Flat events, round summaries, map point objects and queued AI statuses are adapted at the API boundary. History lists every analysis id, including all players and repeated ZIP analyses, rather than one latest report per match.

Titles contain nickname, date/time, map and a short analysis-id suffix in history. Match time is used when known; otherwise upload/analysis time is used. No match time is invented.

The backend deduplicates by owner + file SHA-256 + target player. Selecting another player creates a separate demo_id and leaves the first report intact. The report offers a validated player selector. A retained source File handle can be reused in the current browser session; after refresh the user reselects the same Demo. The action does not overwrite the original analysis.

## Backend deployment

Requires release/cloud-test@550848b or compatible newer endpoints. CLOUD-DEMO-COMPATIBILITY.patch supplies additional corrections relative to that commit: preserve TK/effective-flash/utility-damage policy for AI facts, expose round timing and sampled sides, filter spectator-only accounts, and reject an explicit SteamID missing from the match statistics rather than silently choosing someone else. Preserve existing production ZIP rule fixes. The frontend commit does not modify repository backend sources; the patch is included for backend handoff.

Install Python 3.11+ and awpy in a virtual environment or isolated dependency directory. Keep provider keys on the server. No SSH keys or credentials belong in Vite variables or release artifacts.

Nginx must allow a 512 MiB file plus multipart overhead on the exact /api/v1/demo-analyses route (for example, 513m), while retaining the old ZIP limit. AI generation returns a queued response; poll the AI GET endpoint until completion/failure. Provider failure does not remove the rule report.

Public profile showcase endpoints are still pending. Private drafts can select either source. A future showcase backend must resolve the cloud: namespace and validate ownership.

## Validation

- Unit tests: node_modules/.bin/vitest run
- TypeScript: node_modules/.bin/vue-tsc -b
- Browser HTTP integration: set CSDM_TEST_CLOUD_BACKEND to the new backend checkout, then run node tests/v120-integration.cjs. Accounts, database and storage are isolated; parser/model fixtures do not spend credits.
- Real Linux server verification: one 347 MB CS2 Demo produced two distinct 18-round reports for s1zzi and ropz; both remained readable, with valid history, round timing and map data.

This frontend release does not rebuild the desktop installer. Future application builds use the Electron-specific local channel from the same sources.
