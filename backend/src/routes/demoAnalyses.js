'use strict';

/**
 * Demo-file analysis API: upload a raw CS2 `.dem`, let the queue parse and
 * analyse it, then read the report, rounds, map points, evidence and AI coach.
 *
 * This is the "read the uploaded demo file" path. It shares the job table,
 * private storage and queue with the ZIP pipeline but keeps its own routes so
 * the existing contracts stay untouched.
 */

const express = require('express');
const multer = require('multer');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { pipeline } = require('node:stream/promises');
const { authenticate } = require('../middlewares/auth');
const { success, errors, ApiError, CODES } = require('../utils/response');
const { db, root, directory } = require('../services/replayStore');
const demoParser = require('../services/demoParser');
const aiAnalysis = require('../services/aiAnalysis');
const { enqueueDemoAi } = require('../services/replayQueue');

const router = express.Router();
router.use(authenticate);

const DEMO_VERSION = 'demo-1.0.0';
const MAX_DEMO_BYTES = 512 * 1024 * 1024;
const UPLOAD_DIR = path.join(root, 'incoming');
const CS2_MAGIC = Buffer.from('PBDEMS2');
const CSGO_MAGIC = Buffer.from('HL2DEMO');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const upload = multer({
    dest: UPLOAD_DIR,
    limits: { fileSize: MAX_DEMO_BYTES, files: 1, fields: 2, parts: 4 }
}).fields([{ name: 'file', maxCount: 1 }]);

let uploading = 0;

function capacity(owner) {
    const total = db.prepare("SELECT count(*) AS n FROM replay_jobs WHERE kind='demo'").get().n;
    const pending = db.prepare("SELECT count(*) AS n FROM replay_jobs WHERE kind='demo' AND status IN ('queued','running')").get().n;
    const own = db.prepare("SELECT count(*) AS n FROM replay_jobs WHERE kind='demo' AND owner_id=?").get(owner).n;
    const ownPending = db.prepare("SELECT count(*) AS n FROM replay_jobs WHERE kind='demo' AND owner_id=? AND status IN ('queued','running')").get(owner).n;
    if (total >= 200 || pending >= 50 || own >= 20 || ownPending >= 3) {
        throw errors.conflict('Demo analysis capacity reached; retry later or remove old demos');
    }
}

function demoRow(owner, id) {
    const row = db.prepare("SELECT * FROM replay_jobs WHERE id=? AND owner_id=? AND kind='demo'").get(id, owner);
    if (!row) throw errors.notFound('Demo analysis not found');
    return row;
}

function metaOf(row) {
    try { return JSON.parse(row.meta || '{}'); } catch { return {}; }
}

function aiStatus(row) {
    const dir = directory(row.id);
    if (fs.existsSync(path.join(dir, 'ai-report.json'))) return 'completed';
    const job = db.prepare("SELECT status,stage FROM replay_jobs WHERE kind='ai' AND digest=? ORDER BY created_at DESC LIMIT 1").get(row.id);
    if (job) return job.status === 'ready' ? 'completed' : job.status === 'failed' ? 'failed' : (job.stage || 'queued');
    return aiAnalysis.isConfigured() ? 'not_generated' : 'not_configured';
}

function publicDemo(row) {
    const meta = metaOf(row);
    const status = row.status === 'ready' ? 'completed'
        : row.status === 'failed' ? 'failed'
            : ['parsing', 'analyzing', 'reporting'].includes(row.stage) ? row.stage : 'queued';
    return {
        demo_id: row.id,
        status,
        stage: row.stage,
        progress: row.status === 'ready' ? 100 : null,
        message: row.error || (row.status === 'ready' ? '报告已保存' : row.stage),
        report_available: row.status === 'ready',
        target_player_id: meta.target_player_id ?? null,
        target_selection: meta.target_selection ?? 'auto_top_fragger',
        file_name: meta.file_name ?? null,
        size_bytes: meta.size_bytes ?? null,
        demo_sha256: meta.demo_sha256 ?? null,
        map: meta.summary?.map ?? null,
        score: meta.summary?.score ?? null,
        rounds: meta.summary?.rounds ?? null,
        summary: meta.summary ?? null,
        ai_status: aiStatus(row),
        created_at: row.created_at,
        analyzed_at: row.status === 'ready' ? row.updated_at : null
    };
}

async function sniff(file) {
    const handle = await fsp.open(file, 'r');
    try {
        const header = Buffer.alloc(16);
        const { bytesRead } = await handle.read(header, 0, 16, 0);
        // GOTV exports are sometimes gzip-compressed; the magic is then 1f 8b.
        if (bytesRead >= 2 && header[0] === 0x1f && header[1] === 0x8b) return 'gzip';
        if (bytesRead < 8) return 'invalid';
        if (header.subarray(0, 7).equals(CS2_MAGIC)) return 'cs2';
        if (header.subarray(0, CSGO_MAGIC.length).equals(CSGO_MAGIC)) return 'csgo';
        return 'invalid';
    } finally {
        await handle.close();
    }
}

function readyDir(req) {
    const row = demoRow(req.user.id, req.params.id);
    if (row.status !== 'ready') throw errors.conflict('Report is not ready');
    return { row, dir: directory(row.id) };
}

async function sendJsonFile(res, file) {
    await fsp.access(file);
    res.type('json');
    res.write('{"code":0,"message":"success","data":');
    await pipeline(fs.createReadStream(file), res, { end: false });
    res.end('}');
}

async function jsonlPage(file, offset, limit) {
    if (!fs.existsSync(file)) return { items: [], next_offset: null };
    const stream = fs.createReadStream(file);
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    const items = [];
    let index = 0;
    let more = false;
    try {
        for await (const line of lines) {
            if (!line) continue;
            if (index++ < offset) continue;
            if (items.length === limit) { more = true; break; }
            items.push(JSON.parse(line));
        }
    } finally {
        lines.close();
        stream.destroy();
    }
    return { items, next_offset: more ? offset + items.length : null };
}

/** GET /demo-analyses/parser — lets the frontend explain a 503 before uploading. */
router.get('/parser', wrap(async (req, res) => {
    // ?refresh=1 re-probes after the operator installs awpy, instead of waiting
    // for the 30 s negative cache to expire.
    const status = await demoParser.probe({ force: req.query.refresh === '1' });
    success(res, {
        available: status.available,
        python: status.python,
        awpy: status.awpy,
        polars: status.polars,
        reason: status.reason,
        max_size_bytes: MAX_DEMO_BYTES,
        ai: {
            configured: aiAnalysis.isConfigured(),
            model: aiAnalysis.configuration().model,
            auto: process.env.AI_AUTO_ANALYZE === 'true'
        }
    });
}));

router.post('/', (req, res, next) => {
    if (uploading >= 2) return next(errors.conflict('Upload busy; retry later'));
    try { capacity(req.user.id); } catch (error) { return next(error); }
    uploading += 1;
    upload(req, res, (error) => {
        uploading -= 1;
        if (!error) return next();
        if (error.code === 'LIMIT_FILE_SIZE') return next(errors.fileTooLarge('Demo exceeds 512 MiB'));
        if (error.code === 'LIMIT_UNEXPECTED_FILE') return next(errors.invalidParameter('Multipart field must be "file"'));
        return next(errors.invalidParameter(error.message));
    });
}, wrap(async (req, res) => {
    const file = req.files?.file?.[0];
    if (!file) throw errors.invalidParameter('Multipart field "file" is required');
    const temp = file.path;
    try {
        const kind = await sniff(temp);
        if (kind === 'csgo') throw errors.invalidParameter('CS:GO (Source 1) demos are not supported; upload a CS2 demo');
        if (kind === 'gzip') throw errors.invalidParameter('Gzip-compressed demos are not supported; extract the .dem file first');
        if (kind !== 'cs2') throw errors.invalidParameter('File is not a CS2 demo (missing PBDEMS2 header)');

        const requested = req.body?.target_player_id;
        if (requested !== undefined && !/^\d{1,20}$/.test(String(requested))) {
            throw errors.invalidParameter('target_player_id must be a SteamID64');
        }
        const target = requested ? String(requested) : '';

        const status = await demoParser.probe();
        if (!status.available) {
            throw new ApiError(CODES.DEMO_PARSER_UNAVAILABLE,
                `Demo parser is unavailable: ${status.reason}`, 503);
        }

        const hash = crypto.createHash('sha256');
        for await (const chunk of fs.createReadStream(temp)) hash.update(chunk);
        const digest = `${hash.digest('hex')}:${target || 'auto'}`;

        const existing = db.prepare("SELECT * FROM replay_jobs WHERE owner_id=? AND digest=? AND version=?")
            .get(req.user.id, digest, DEMO_VERSION);
        if (existing && existing.status !== 'failed') {
            return success(res, { ...publicDemo(existing), reused: true },
                existing.status === 'ready' ? 'success' : 'queued', existing.status === 'ready' ? 200 : 202);
        }
        if (existing) {
            // A failed parse is usually a bad file, but allow a retry with the
            // same bytes after the user fixed the file on their side.
            db.prepare('DELETE FROM replay_jobs WHERE id=?').run(existing.id);
            await fsp.rm(directory(existing.id), { recursive: true, force: true });
        }

        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const dir = directory(id);
        await fsp.mkdir(dir, { recursive: true });
        await fsp.rename(temp, path.join(dir, 'match.dem'));
        await fsp.writeFile(path.join(dir, 'task.json'), JSON.stringify({
            analysis_id: id,
            uploaded_at: now,
            target_player_id: target || null,
            target_selection: target ? 'explicit' : 'auto_top_fragger',
            file_name: file.originalname?.slice(0, 120) || 'match.dem',
            max_rounds: 60
        }));
        try {
            db.prepare(`INSERT INTO replay_jobs(id,owner_id,digest,version,kind,status,stage,created_at,updated_at,meta)
                        VALUES(?,?,?,?,'demo','queued','queued',?,?,?)`).run(id, req.user.id, digest, DEMO_VERSION, now, now,
                JSON.stringify({
                    file_name: file.originalname?.slice(0, 120) || 'match.dem',
                    size_bytes: file.size,
                    target_player_id: target || null,
                    target_selection: target ? 'explicit' : 'auto_top_fragger'
                }));
        } catch (error) {
            await fsp.rm(dir, { recursive: true, force: true });
            const concurrent = db.prepare("SELECT * FROM replay_jobs WHERE owner_id=? AND digest=? AND version=?")
                .get(req.user.id, digest, DEMO_VERSION);
            if (concurrent) return success(res, { ...publicDemo(concurrent), reused: true }, 'queued', 202);
            throw error;
        }
        return success(res, publicDemo(demoRow(req.user.id, id)), 'queued', 202);
    } finally {
        await fsp.unlink(temp).catch(() => {});
    }
}));

router.get('/', wrap(async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 50);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
        throw errors.invalidParameter('Invalid pagination');
    }
    const total = db.prepare("SELECT count(*) AS n FROM replay_jobs WHERE kind='demo' AND owner_id=?").get(req.user.id).n;
    const rows = db.prepare("SELECT * FROM replay_jobs WHERE kind='demo' AND owner_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?")
        .all(req.user.id, pageSize, (page - 1) * pageSize);
    success(res, { items: rows.map(publicDemo), page, pageSize, total });
}));

router.get('/:id', wrap(async (req, res) => success(res, publicDemo(demoRow(req.user.id, req.params.id)))));

router.get('/:id/report', wrap(async (req, res) => {
    const { dir } = readyDir(req);
    await sendJsonFile(res, path.join(dir, 'cloud-report.json'));
}));

router.get('/:id/details', wrap(async (req, res) => {
    const { dir } = readyDir(req);
    await sendJsonFile(res, path.join(dir, 'report.json'));
}));

router.get('/:id/rounds/:round', wrap(async (req, res) => {
    const { dir } = readyDir(req);
    if (!/^\d{1,3}$/.test(req.params.round)) throw errors.invalidParameter('Invalid round');
    try {
        await sendJsonFile(res, path.join(dir, `round-${Number(req.params.round)}.json`));
    } catch (error) {
        if (error.code === 'ENOENT') throw errors.notFound('Round not found');
        throw error;
    }
}));

router.get('/:id/rounds/:round/map', wrap(async (req, res) => {
    const { dir } = readyDir(req);
    const round = req.params.round;
    if (!/^(\d{1,3}|context)$/.test(round)) throw errors.invalidParameter('Invalid round');
    const offset = Number(req.query.offset ?? 0);
    const limit = Number(req.query.limit ?? 200);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000 ||
        !Number.isInteger(limit) || limit < 1 || limit > 500) {
        throw errors.invalidParameter('Invalid pagination');
    }
    success(res, await jsonlPage(path.join(dir, `map-${round === 'context' ? 'context' : Number(round)}.jsonl`), offset, limit));
}));

router.get('/:id/evidence/:event', wrap(async (req, res) => {
    const { dir } = readyDir(req);
    const index = JSON.parse(await fsp.readFile(path.join(dir, 'evidence-index.json'), 'utf8'));
    if (!Object.hasOwn(index, req.params.event)) throw errors.notFound('Evidence not found');
    const entry = index[req.params.event];
    const handle = await fsp.open(path.join(dir, 'evidence.bin'), 'r');
    try {
        const bytes = Buffer.alloc(entry.length);
        await handle.read(bytes, 0, entry.length, entry.offset);
        success(res, JSON.parse(bytes.toString('utf8')));
    } finally {
        await handle.close();
    }
}));

router.get('/:id/ai', wrap(async (req, res) => {
    const row = demoRow(req.user.id, req.params.id);
    const file = path.join(directory(row.id), 'ai-report.json');
    try {
        const raw = await fsp.readFile(file, 'utf8');
        return success(res, JSON.parse(raw));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    const job = db.prepare("SELECT status,stage,error FROM replay_jobs WHERE kind='ai' AND digest=? ORDER BY created_at DESC LIMIT 1").get(row.id);
    return success(res, {
        ai_status: aiAnalysis.isConfigured() ? 'not_generated' : 'not_configured',
        analysis_id: row.id,
        model: aiAnalysis.configuration().model,
        queued: Boolean(job && ['queued', 'running'].includes(job.status)),
        stage: job?.stage ?? null,
        last_error: job?.status === 'failed' ? job.error : null,
        demo_ready: row.status === 'ready'
    });
}));

/**
 * Generate the AI coach. The provider call happens in a queued child process,
 * so the HTTP request returns immediately and a slow provider never blocks the
 * parse queue or the API event loop.
 */
router.post('/:id/ai', wrap(async (req, res) => {
    const row = demoRow(req.user.id, req.params.id);
    if (row.status !== 'ready') throw errors.conflict('Report is not ready');
    if (!aiAnalysis.isConfigured()) {
        throw new ApiError(CODES.AI_NOT_CONFIGURED,
            'AI analysis is not configured. Set DEEPSEEK_API_KEY on the server.', 503);
    }
    const existing = path.join(directory(row.id), 'ai-report.json');
    const force = req.query.force === 'true';
    const priorJobs = db.prepare("SELECT id,status FROM replay_jobs WHERE kind='ai' AND digest=?").all(row.id);
    if (priorJobs.some((job) => job.status === 'running')) {
        throw errors.conflict('AI analysis is already running');
    }
    if (force) {
        // A forced regeneration replaces the previous attempt, so the queue can
        // reuse the same dedupe key and the old artifact cannot mask a failure.
        for (const job of priorJobs) {
            db.prepare('DELETE FROM replay_jobs WHERE id=?').run(job.id);
            await fsp.rm(directory(job.id), { recursive: true, force: true }).catch(() => {});
        }
        await fsp.unlink(existing).catch(() => {});
    } else if (fs.existsSync(existing)) {
        return success(res, JSON.parse(await fsp.readFile(existing, 'utf8')));
    }
    const jobId = enqueueDemoAi(row.id);
    return success(res, {
        demo_id: row.id,
        ai_job_id: jobId,
        ai_status: 'queued',
        message: 'AI 教练解读已排队，请轮询 GET /demo-analyses/{id}/ai'
    }, 'queued', 202);
}));

router.delete('/:id', wrap(async (req, res) => {
    const row = demoRow(req.user.id, req.params.id);
    if (row.status === 'running') throw errors.conflict('Analysis is running');
    const aiJobs = db.prepare("SELECT id FROM replay_jobs WHERE kind='ai' AND digest=?").all(row.id);
    if (aiJobs.some((job) => db.prepare('SELECT status FROM replay_jobs WHERE id=?').get(job.id)?.status === 'running')) {
        throw errors.conflict('AI analysis is running');
    }
    db.exec('BEGIN IMMEDIATE');
    try {
        for (const job of aiJobs) db.prepare('DELETE FROM replay_jobs WHERE id=?').run(job.id);
        db.prepare('DELETE FROM replay_jobs WHERE id=?').run(row.id);
        db.exec('COMMIT');
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
    for (const id of [row.id, ...aiJobs.map((job) => job.id)]) {
        await fsp.rm(directory(id), { recursive: true, force: true });
    }
    success(res);
}));

module.exports = router;
