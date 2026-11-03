# Frontend 1.3.0 handoff

Copy this directory's contents into repository frontend/. Do not nest the version directory. This release adds the Dust2 tactical view and weapon highlights to the 1.2.1 upload/history/AI fixes, and preserves the deployed rotation, spawn, economy, round-review and grouped weapon enhancements that were not yet on GitHub.

See [integration and validation](docs/CLOUD-DEMO-v1.3.0.md). Backend endpoints already exist in production; this release only deploys frontend code and static files. The local backend_service checkout and its uncommitted changes are preserved.

The browser source is front_end; the standalone handoff is front_end_v1.3.0. Existing desktop files and installers are unchanged. No Git commit or GitHub push is performed; upload frontend sources yourself. Exclude node_modules, dist, local environment files, test output and credentials when committing.
