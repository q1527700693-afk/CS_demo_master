'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { db } = require('../config/database');
const { errors } = require('../utils/response');
const VERSION = 'rules-1.1.0';
const root = path.resolve(process.env.REPLAY_DIR || path.join(__dirname, '../../data/replays'));
fs.mkdirSync(path.join(root, 'incoming'), { recursive: true });
db.exec(`CREATE TABLE IF NOT EXISTS replay_jobs (
 id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 digest TEXT NOT NULL, version TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
 stage TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
 lease_until INTEGER, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(owner_id,digest,version));
 CREATE INDEX IF NOT EXISTS replay_queue ON replay_jobs(status,created_at);`);
if (!db.prepare('PRAGMA table_info(replay_jobs)').all().some(c => c.name === 'kind')) db.exec("ALTER TABLE replay_jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'legacy'");
db.exec(`CREATE TABLE IF NOT EXISTS analysis_packages (
 owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 package_id TEXT NOT NULL, match_id TEXT NOT NULL, target_player_id TEXT NOT NULL,
 storage_id TEXT NOT NULL, signature TEXT NOT NULL, uploaded_at TEXT NOT NULL, manifest TEXT NOT NULL,
 PRIMARY KEY(owner_id,package_id));
 CREATE TABLE IF NOT EXISTS analysis_runs (
 analysis_id TEXT PRIMARY KEY REFERENCES replay_jobs(id) ON DELETE CASCADE,
 owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 package_id TEXT NOT NULL, match_id TEXT NOT NULL, target_player_id TEXT NOT NULL,
 idempotency_key TEXT NOT NULL, request_body TEXT NOT NULL, created_at TEXT NOT NULL,
 result_status TEXT, summary TEXT, UNIQUE(owner_id,idempotency_key));
 CREATE INDEX IF NOT EXISTS package_matches ON analysis_packages(owner_id,match_id,uploaded_at);
 CREATE INDEX IF NOT EXISTS run_matches ON analysis_runs(owner_id,match_id,created_at);`);
function owned(id, owner) {
    const job = db.prepare('SELECT * FROM replay_jobs WHERE id=? AND owner_id=?').get(id, owner);
    if (!job || job.kind !== 'legacy') throw errors.notFound('Analysis not found');
    return job;
}
function publicJob(job) {
    return { job_id: job.id, status: job.status, stage: job.stage, error: job.error,
        attempts: job.attempts, created_at: job.created_at, updated_at: job.updated_at,
        ai_status: 'not_requested', report_url: job.status === 'ready' ? `/api/v1/demos/${job.id}/report` : null };
}
function directory(id) { return path.join(root, id); }
module.exports = { db, root, VERSION, owned, publicJob, directory };
