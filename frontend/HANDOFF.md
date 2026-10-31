## Current v1.2.1 follow-up

Names and preview lists now use `#01 · nickname · map`. Calendar labels and date inputs were removed from both raw Demo channels; the frontend no longer submits `played_at`. Internal processing timestamps remain available for ordering and compatibility.

Overview records now use the same complete cloud/ZIP/native perspective loader as My Replays. Background completion, deletion, returning to the window and the refresh button update recent reports and metrics. Available per-player statistics are used without copying another perspective's latest values. Both delete buttons are red.

The shared frontend changes apply to browser and Electron channels. Previous cloud and native parser fixes remain in place; the installed desktop binaries have not been rebuilt. Git changes remain uncommitted and unpushed.

# v1.2.1

Two-step roster selection, full-player maps, correct match-time labels, perspective replacement/deletion and upload state reset are implemented. See [v1.2.1 integration](docs/CLOUD-DEMO-v1.2.1.md). Frontend/local-parser sources and the required cloud-backend delta patch are included; preserve existing production ZIP combat fixes. GitHub changes are intentionally left uncommitted and unpushed for the owner to review.

# Frontend v1.2.0 handoff

Copy this folder contents into frontend/ without nesting a version folder. Build with VITE_MOCK_AUTH=false, VITE_MOCK_PROFILE=false and VITE_MOCK_REPLAY=false. Do not copy node_modules, local environment files, SSH keys or test output.

See docs/CLOUD-DEMO-v1.2.0.md for runtime channels, independent player history, required backend interfaces, compatibility patch and validation. The raw-demo-capable backend must be deployed before browser uploads become available. ZIP imports remain supported.
