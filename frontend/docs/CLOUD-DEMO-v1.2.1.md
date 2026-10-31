## Current v1.2.1 follow-up

Names and preview lists now use `#01 · nickname · map`. Calendar labels and date inputs were removed from both raw Demo channels; the frontend no longer submits `played_at`. Internal processing timestamps remain available for ordering and compatibility.

Overview records now use the same complete cloud/ZIP/native perspective loader as My Replays. Background completion, deletion, returning to the window and the refresh button update recent reports and metrics. Available per-player statistics are used without copying another perspective's latest values. Both delete buttons are red.

The shared frontend changes apply to browser and Electron channels. Previous cloud and native parser fixes remain in place; the installed desktop binaries have not been rebuilt. Git changes remain uncommitted and unpushed.

# v1.2.1 integration and verification

Cloud uploads now use a two-step flow: multipart POST `/api/v1/demo-analyses` with `selection_mode=choose`, poll until `roster_available`, GET `/{id}/players`, then POST `/{id}/analyses` with a roster `target_player_id`. The UI never asks users to type a SteamID. The parser status response advertises `player_selection`, `full_player_map` and `record_delete` capabilities.

The selection body optionally accepts `played_at` (timezone-qualified ISO timestamp) and `force` (boolean). These date fields remain supported by the legacy backend contract; the current frontend no longer collects or displays a match date. Provenance is `demo`, `user_input`, or `unknown`.

The parser keeps periodic samples for all roster participants and all grenade trajectories. Maps expose all-player samples, named players, grenade owners, aligned point ticks and start/end timing. The first displayed frame is an actual recorded live frame. The local parsing/export path retains full-player and full-utility streams too.

Owner + Demo SHA + selected player identify a perspective. Another player gets another report. Repeated analysis of the same player updates/reuses its record. ZIP requests set `replace_previous=true`; replacement happens only after the new report succeeds. Other players are preserved. Deletion is owner checked and removes only unshared private data; desktop deletion also removes the local snapshot. Pending player-selection uploads can be resumed from history and are hidden after creating a player report.

A fresh upload view resets completed file/progress/error/selection state. Navigating away from an active task preserves it. Profile showcase choices load automatically; the separate load-matches button is removed. Public showcase persistence still requires the previously documented profile endpoints.

This front_end checkout contains frontend and local_parser sources. Complete cloud backend/parser sources are retained in the workspace at docs/frontend-v1.2.1/cloud-source; cloud API changes are supplied as a patch for integration into the backend branch. `BACKEND-v1.2.1.patch` is the delta from the v1.2.0 cloud source. Preserve existing production ZIP combat-rule fixes when integrating; the deployment intentionally does not replace `replayAnalysis.js`. The existing desktop build recipe in the workspace now uses the current shared frontend. The released desktop installer is not rebuilt by this patch.

Verification includes frontend unit tests/typecheck/build, backend HTTP/regression tests, browser workflows for both runtime channels, local snapshot/date tests, and a 347 MB real Demo through both parsers. Browser integration: set `CSDM_TEST_CLOUD_BACKEND` to this backend checkout, then run `node tests/v121-integration.cjs`. Parser/provider fixtures use isolated data and do not call a paid model.
