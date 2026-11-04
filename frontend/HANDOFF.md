## 1.3.1 utility follow-up

Actual per-player throw counts are now recorded for all six utility types. See [throw-count fix](docs/UTILITY-v1.3.1.md). Version stays 1.3.1.

# Frontend 1.3.1 handoff

Copy this folder's sources into repository frontend/ without nesting the version folder. Exclude dist, node_modules and local environment files from GitHub.

See docs/REVIEW-v1.3.1.md for corrected grenade/fire damage, relevant positive/negative moments, trade definitions, per-round economy, estimated Rating and the revised overview. Dust2 v1.3.0 features remain included. The public profile showcase backend is still unavailable and the frontend flow is unchanged.

This version requires the additive performance endpoint and future-analysis normalization in docs/BACKEND-v1.3.1.patch. The matching patch has been deployed to production; apply it separately when integrating backend source into GitHub. It does not migrate or overwrite stored reports.

Active source: front_end. Delivery snapshot: front_end_v1.3.1. Production verification and rollback: workspace docs/frontend-v1.3.1/DEPLOYMENT.md. Desktop files/installers are unchanged. No Git commits or GitHub push are performed.

Web cache follow-up: deploy the HTML/version.json cache rules in deploy/nginx-web-cache.conf. Each production build now emits its own version.json; publish it with the matching index.html. An open tab detects subsequent builds and offers a safe manual refresh. See docs/WEB-UPDATE-v1.3.1.md. The product version remains 1.3.1.
