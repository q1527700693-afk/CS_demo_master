'use strict';
const { fork } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { db, directory } = require('./replayStore');
function startQueue() {
    let active = null, stopped = false;
    function tick() {
        if (active || stopped) return;
        const now = Date.now(); let job;
        db.exec('BEGIN IMMEDIATE');
        try {
            db.prepare("UPDATE replay_jobs SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END, stage='recovered',error='Worker interrupted',lease_until=NULL WHERE status='running' AND lease_until < ?").run(now);
            if (!db.prepare("SELECT id FROM replay_jobs WHERE status='running'").get()) {
                job = db.prepare("SELECT * FROM replay_jobs WHERE status='queued' ORDER BY created_at LIMIT 1").get();
                if (job) db.prepare("UPDATE replay_jobs SET status='running',stage='validating',attempts=attempts+1,error=NULL,lease_until=?,updated_at=? WHERE id=?").run(now + 150000, new Date().toISOString(), job.id);
            } db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); console.error('Replay queue:', error.message); return; }
        if (!job) return;
        const child = fork(path.join(__dirname, '../replayWorker.js'), [directory(job.id), job.kind], { execArgv: ['--max-old-space-size=384'], stdio: ['ignore','ignore','inherit','ipc'] });
        active = child; let outcome = null;
        const deadline = setTimeout(() => { outcome = 'Analysis exceeded 120 seconds'; child.kill(); }, 120000);
        child.on('message', message => {
            if (message.stage) db.prepare('UPDATE replay_jobs SET stage=?,updated_at=? WHERE id=?').run(message.stage, new Date().toISOString(), job.id);
            if (message.error) outcome = message.error;
            if (message.ready) outcome = 'ready';
        });
        child.on('error', e => { outcome = e.message; });
        child.on('close', () => {
            clearTimeout(deadline);
            let status = outcome === 'ready' ? 'ready' : outcome ? 'failed' : job.attempts < 2 ? 'queued' : 'failed';
            if (status === 'ready' && job.kind === 'analysis') {
                try { const meta = JSON.parse(fs.readFileSync(path.join(directory(job.id), 'report-meta.json'), 'utf8'));
                    db.prepare('UPDATE analysis_runs SET result_status=?,summary=? WHERE analysis_id=?').run(meta.status, JSON.stringify(meta.summary), job.id);
                } catch (error) { outcome = error.message; status = 'failed'; }
            }
            db.prepare('UPDATE replay_jobs SET status=?,stage=?,error=?,lease_until=NULL,updated_at=? WHERE id=?').run(status, status, status === 'ready' ? null : outcome || 'Worker interrupted', new Date().toISOString(), job.id);
            active = null;
        });
    }
    const timer = setInterval(tick, 500); tick();
    return () => { stopped = true; clearInterval(timer); if (active) active.kill(); };
}
module.exports = { startQueue };
