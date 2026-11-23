# 网页版 v1.3.3 交付

将源码包的内容放入 GitHub 仓库现有的 `frontend/` 目录。生产构建使用 `pnpm run build`，版本和改动见 [版本记录](docs/RELEASE.md)。发布网页时使用生成的 `dist/`。

## 历史版本 v1.3.2

Copy the contents of front_end_v1.3.2 into repository frontend/ without nesting the version folder. Exclude dist, node_modules and local environment files from GitHub. No Git commit or push is performed.

This release corrects training depth compositing: targets share the room depth buffer, then the weapon and hands render in the foreground. Keep the supplied public/vector-trainer snapshot and integration-source.json together. See docs/TRAINING-v1.3.2.md. Delivery: front_end_v1.3.2 and front_end_v1.3.2.zip. Server verification and rollback: workspace docs/frontend-v1.3.2/DEPLOYMENT.md.

The same-version follow-up versions the entire native training module graph per build, including the deferred renderer. Upload scripts/training-release.mjs, scripts/training-release.d.mts, vite.config.ts and src/features/training/loader.ts together; production output intentionally has revision-stamped import URLs while the public source snapshot stays unchanged. Version remains 1.3.2.

Production has teammate-provided showcase APIs. This frontend already uses the demo-showcase read/write contract; this release does not change those APIs. Preserve deployed backend source and data. The v1.3.1 performance backend patch below is still required when recreating the service from older GitHub backend source.

## Historical 1.3.1 utility follow-up

Actual per-player throw counts are now recorded for all six utility types. See [throw-count fix](docs/UTILITY-v1.3.1.md). Version stays 1.3.1.

# Frontend 1.3.1 handoff

Copy this folder's sources into repository frontend/ without nesting the version folder. Exclude dist, node_modules and local environment files from GitHub.

See docs/REVIEW-v1.3.1.md for corrected grenade/fire damage, relevant positive/negative moments, trade definitions, per-round economy, estimated Rating and the revised overview. Dust2 v1.3.0 features remain included. The frontend showcase flow is unchanged; availability depends on the deployed backend.

This version requires the additive performance endpoint and future-analysis normalization in docs/BACKEND-v1.3.1.patch. The matching patch has been deployed to production; apply it separately when integrating backend source into GitHub. It does not migrate or overwrite stored reports.

Active source: front_end. Delivery snapshot: front_end_v1.3.1. Production verification and rollback: workspace docs/frontend-v1.3.1/DEPLOYMENT.md. Desktop files/installers are unchanged. No Git commits or GitHub push are performed.

Web cache follow-up: deploy the HTML/version.json cache rules in deploy/nginx-web-cache.conf. Each production build now emits its own version.json; publish it with the matching index.html. An open tab detects subsequent builds and offers a safe manual refresh. See docs/WEB-UPDATE-v1.3.1.md. The product version remains 1.3.1.
