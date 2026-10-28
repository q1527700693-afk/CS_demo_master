'use strict';

const { fork } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { db, directory } = require('./replayStore');
const aiAnalysis = require('./aiAnalysis');

// Every job kind gets its own wall-clock budget: parsing a demo needs minutes,
// a ZIP rule pass needs seconds, an AI call is bounded by AI_TIMEOUT_MS.
const BUDGET_MS = { import: 150_000, analysis: 120_000, demo: 600_000, ai: 180_000 };
const LEASE_SLACK_MS = 30_000;

function budget(kind) {
    return BUDGET_MS[kind] ?? 120_000;
}

/**
 * Queue an AI coaching pass for a ready demo analysis. The AI job is a normal
 * queued row, so retries, leases and failure states come for free; the report
 * stays untouched if the provider fails.
 */
function enqueueDemoAi(demoJobId) {
    const existing = db.prepare("SELECT id FROM replay_jobs WHERE kind='ai' AND digest=?").get(demoJobId);
    if (existing) return existing.id;
    const owner = db.prepare('SELECT owner_id FROM replay_jobs WHERE id=?').get(demoJobId);
    if (!owner) throw new Error('Demo job not found');
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const dir = directory(id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ai-task.json'),
        JSON.stringify({ demo_job_id: demoJobId, demo_dir: directory(demoJobId) }));
    db.prepare("INSERT INTO replay_jobs(id,owner_id,digest,version,kind,status,stage,created_at,updated_at,meta) VALUES(?,?,?,?,'ai','queued','queued',?,?,?)")
        .run(id, owner.owner_id, demoJobId, 'ai-1.0.0', now, now, JSON.stringify({ demo_job_id: demoJobId }));
    return id;
}

/**
 * @param {object} [options]
 * @param {(dir: string, kind: string, onStage: Function) => Promise<void>} [options.runner]
 *   Run jobs in-process instead of forking. Used by the test suite on hosts that
 *   forbid child processes; production always forks.
 */
function startQueue(options = {}) {
    // REPLAY_QUEUE_INLINE=1 runs jobs in the API process. It exists for hosts
    // that forbid child processes (some CI/sandboxes); production forks.
    const inlineRunner = typeof options.runner === 'function' ? options.runner
        : process.env.REPLAY_QUEUE_INLINE === '1' ? require('./replayJobRunner').runJob : null;
    let active = null, stopped = false;

    function complete(job, outcome) {
        let status = outcome === 'ready' ? 'ready' : outcome ? 'failed' : job.attempts < 2 ? 'queued' : 'failed';
        if (status === 'ready' && job.kind === 'analysis') {
            try {
                const meta = JSON.parse(fs.readFileSync(path.join(directory(job.id), 'report-meta.json'), 'utf8'));
                db.prepare('UPDATE analysis_runs SET result_status=?,summary=? WHERE analysis_id=?')
                    .run(meta.status, JSON.stringify(meta.summary), job.id);
            } catch (error) { outcome = error.message; status = 'failed'; }
        }
        if (status === 'ready' && job.kind === 'demo') {
            try {
                const meta = JSON.parse(fs.readFileSync(path.join(directory(job.id), 'report-meta.json'), 'utf8'));
                const stored = JSON.parse(job.meta || '{}');
                db.prepare('UPDATE replay_jobs SET meta=? WHERE id=?')
                    .run(JSON.stringify({
                        ...stored,
                        target_player_id: meta.summary?.target_player_id ?? stored.target_player_id ?? null,
                        target_selection: meta.summary?.target_selection ?? stored.target_selection ?? null,
                        demo_sha256: meta.summary?.demo_sha256 ?? stored.demo_sha256 ?? null,
                        summary: meta.summary,
                        status: meta.status
                    }), job.id);
            } catch (error) {
                console.error('Demo report metadata:', error.message);
            }
            // Auto-coaching is opt-in: it costs a provider call and must never
            // delay the deterministic report from becoming available.
            if (process.env.AI_AUTO_ANALYZE === 'true' && aiAnalysis.isConfigured()) {
                try { enqueueDemoAi(job.id); } catch (error) { console.error('AI enqueue:', error.message); }
            }
        }
        db.prepare('UPDATE replay_jobs SET status=?,stage=?,error=?,lease_until=NULL,updated_at=? WHERE id=?')
            .run(status, status, status === 'ready' ? null : outcome || 'Worker interrupted', new Date().toISOString(), job.id);
        active = null;
    }

    function runInline(job) {
        const limit = budget(job.kind);
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            complete(job, `Job exceeded ${Math.round(limit / 1000)} seconds`);
        }, limit);
        Promise.resolve().then(() => inlineRunner(directory(job.id), job.kind, (message) => {
            if (message?.stage) {
                db.prepare('UPDATE replay_jobs SET stage=?,updated_at=? WHERE id=?')
                    .run(message.stage, new Date().toISOString(), job.id);
            }
        })).then(() => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            complete(job, 'ready');
        }).catch((error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            complete(job, String(error.message || error).slice(0, 300));
        });
    }

    function runForked(job) {
        const limit = budget(job.kind);
        const child = fork(path.join(__dirname, '../replayWorker.js'), [directory(job.id), job.kind, String(limit)],
            { execArgv: ['--max-old-space-size=512'], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
        active = child;
        let outcome = null;
        const deadline = setTimeout(() => { outcome = `Job exceeded ${Math.round(limit / 1000)} seconds`; child.kill(); }, limit);
        child.on('message', message => {
            if (message.stage) db.prepare('UPDATE replay_jobs SET stage=?,updated_at=? WHERE id=?').run(message.stage, new Date().toISOString(), job.id);
            if (message.error) outcome = message.error;
            if (message.ready) outcome = 'ready';
        });
        child.on('error', e => { outcome = e.message; });
        child.on('close', () => { clearTimeout(deadline); complete(job, outcome); });
    }

    function tick() {
        if (active || stopped) return;
        const now = Date.now(); let job;
        db.exec('BEGIN IMMEDIATE');
        try {
            db.prepare(`UPDATE replay_jobs SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,
                        stage='recovered',error='Worker interrupted',lease_until=NULL
                        WHERE status='running' AND lease_until < ?`).run(now);
            if (!db.prepare("SELECT id FROM replay_jobs WHERE status='running'").get()) {
                job = db.prepare("SELECT * FROM replay_jobs WHERE status='queued' ORDER BY created_at LIMIT 1").get();
                if (job) db.prepare("UPDATE replay_jobs SET status='running',stage='validating',attempts=attempts+1,error=NULL,lease_until=?,updated_at=? WHERE id=?")
                    .run(now + budget(job.kind) + LEASE_SLACK_MS, new Date().toISOString(), job.id);
            }
            db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); console.error('Replay queue:', error.message); return; }
        if (!job) return;
        if (inlineRunner) { active = true; runInline(job); }
        else runForked(job);
    }

    const timer = setInterval(tick, 500); tick();
    return () => {
        stopped = true;
        clearInterval(timer);
        if (active instanceof Object && typeof active.kill === 'function') active.kill();
    };
}

module.exports = { startQueue, enqueueDemoAi, budget };
