'use strict';
const express = require('express');
const multer = require('multer');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { pipeline } = require('node:stream/promises');
const { authenticate } = require('../middlewares/auth');
const { success, errors } = require('../utils/response');
const { db, root, VERSION, directory, owned, publicJob } = require('../services/replayStore');
const router = express.Router();
router.use(authenticate);
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const upload = multer({ dest: path.join(root, 'incoming'), limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 0, parts: 2 } }).single('file');
let uploading = 0;
router.post('/', (req, res, next) => {
    const pending = db.prepare("SELECT count(*) AS n FROM replay_jobs WHERE status IN ('queued','running')").get().n;
    const own = db.prepare("SELECT count(*) AS n FROM replay_jobs WHERE owner_id=? AND status IN ('queued','running')").get(req.user.id).n;
    if (pending >= 50 || own >= 3 || uploading >= 2) return res.status(429).json({ code: 42900, message: 'Analysis queue full; retry later', data: null });
    if (db.prepare('SELECT count(*) AS n FROM replay_jobs').get().n >= 100 || db.prepare('SELECT count(*) AS n FROM replay_jobs WHERE owner_id=?').get(req.user.id).n >= 20) return res.status(429).json({ code: 42900, message: 'Storage quota reached; remove old analyses', data: null });
    uploading++;
    upload(req, res, error => {
        uploading--;
        if (error) return next(error.code === 'LIMIT_FILE_SIZE' ? errors.fileTooLarge('ZIP must be at most 20 MiB') : errors.invalidParameter(error.message));
        next();
    });
}, wrap(async (req, res) => {
    if (!req.file) throw errors.invalidParameter('Multipart field file is required');
    try {
        const hash = crypto.createHash('sha256');
        for await (const chunk of fs.createReadStream(req.file.path)) hash.update(chunk);
        const digest = hash.digest('hex');
        const old = db.prepare('SELECT * FROM replay_jobs WHERE owner_id=? AND digest=? AND version=?').get(req.user.id, digest, VERSION);
        if (old) return success(res, { ...publicJob(old), reused: true }, 'success', old.status === 'ready' ? 200 : 202);
        const id = crypto.randomUUID(), now = new Date().toISOString();
        const dest = directory(id); await fs.promises.mkdir(dest);
        await fs.promises.rename(req.file.path, path.join(dest, 'package.zip'));
        try {
            db.prepare('INSERT INTO replay_jobs(id,owner_id,digest,version,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id, req.user.id, digest, VERSION, now, now);
        } catch (e) {
            await fs.promises.rm(dest, { recursive: true, force: true });
            const concurrent = db.prepare('SELECT * FROM replay_jobs WHERE owner_id=? AND digest=? AND version=?').get(req.user.id, digest, VERSION);
            if (concurrent) return success(res, { ...publicJob(concurrent), reused: true }, 'success', 202);
            throw e;
        }
        return success(res, publicJob(owned(id, req.user.id)), 'queued', 202);
    } finally { await fs.promises.unlink(req.file.path).catch(() => {}); }
}));
router.get('/', (req, res) => success(res, db.prepare("SELECT * FROM replay_jobs WHERE owner_id=? AND kind='legacy' ORDER BY created_at DESC LIMIT 100").all(req.user.id).map(publicJob)));
router.get('/:id', (req, res, next) => { try { success(res, publicJob(owned(req.params.id, req.user.id))); } catch (e) { next(e); } });
function ready(req) { const job = owned(req.params.id, req.user.id); if (job.status !== 'ready') throw errors.conflict('Report is not ready'); return directory(job.id); }
async function sendStored(res, file) {
    await fs.promises.access(file);
    res.type('json'); res.write('{"code":0,"message":"success","data":');
    await pipeline(fs.createReadStream(file), res, { end: false }); res.end('}');
}
router.get('/:id/report', wrap(async (req, res) => sendStored(res, path.join(ready(req), 'report.json'))));
router.get('/:id/rounds/:round', wrap(async (req, res) => {
    const dir = ready(req); if (!/^\d{1,3}$/.test(req.params.round)) throw errors.invalidParameter('Invalid round');
    try { await sendStored(res, path.join(dir, `round-${Number(req.params.round)}.json`)); }
    catch (e) { if (e.code === 'ENOENT') throw errors.notFound('Round not found'); throw e; }
}));
router.get('/:id/rounds/:round/map', wrap(async (req, res) => {
    const dir = ready(req), round = req.params.round;
    if (!/^(\d{1,3}|context)$/.test(round)) throw errors.invalidParameter('Invalid round');
    const offset = Number(req.query.offset ?? 0), limit = Number(req.query.limit ?? 200);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000 || !Number.isInteger(limit) || limit < 1 || limit > 500) throw errors.invalidParameter('Invalid pagination');
    const file = path.join(dir, `map-${round === 'context' ? round : Number(round)}.jsonl`);
    if (!fs.existsSync(file)) return success(res, { items: [], next_offset: null });
    const stream = fs.createReadStream(file); const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    const items = []; let index = 0, more = false;
    try { for await (const line of lines) {
        if (index++ < offset) continue;
        if (items.length === limit) { more = true; break; }
        items.push(JSON.parse(line));
    } } finally { lines.close(); stream.destroy(); }
    success(res, { items, next_offset: more ? offset + items.length : null });
}));
router.get('/:id/evidence/:event', wrap(async (req, res) => {
    const dir = ready(req);
    const all = JSON.parse(await fs.promises.readFile(path.join(dir, 'evidence-index.json'), 'utf8'));
    if (!Object.hasOwn(all, req.params.event)) throw errors.notFound('Evidence not found');
    const entry = all[req.params.event], file = await fs.promises.open(path.join(dir, 'evidence.bin'), 'r');
    try { const bytes = Buffer.alloc(entry.length); await file.read(bytes, 0, entry.length, entry.offset); success(res, JSON.parse(bytes.toString('utf8'))); }
    finally { await file.close(); }
}));
router.delete('/:id', wrap(async (req, res) => {
    const job = owned(req.params.id, req.user.id);
    if (job.status === 'running') throw errors.conflict('Wait for running analysis to finish');
    db.prepare('DELETE FROM replay_jobs WHERE id=?').run(job.id);
    await fs.promises.rm(directory(job.id), { recursive: true, force: true }); success(res);
}));
module.exports = router;
