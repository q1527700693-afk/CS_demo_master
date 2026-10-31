'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, directory } = require('./replayStore');
const { errors } = require('../utils/response');

function playedAt(value) {
    if (value == null || value === '') return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
        throw errors.invalidParameter('played_at must be an ISO timestamp with a timezone');
    }
    const date = new Date(value);
    if (date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 2100) throw errors.invalidParameter('Invalid match date');
    return date.toISOString();
}
function roster(payload) {
    const players = new Map((payload.players || []).map(p => [String(p.steamid), p]));
    return (payload.stats || []).filter(p => p.steamid && /^\d{1,20}$/.test(String(p.steamid)))
        .map(p => ({ player_id: String(p.steamid), name: p.name || players.get(String(p.steamid))?.name || String(p.steamid) }));
}
function focusPayload(payload, target) {
    if (!roster(payload).some(p => p.player_id === target)) throw errors.invalidParameter('Player is not in this match');
    return { ...payload, target_player_id: target,
        target_samples: payload.all_player_samples ? payload.all_player_samples.filter(s => s.steamid === target) : payload.target_samples,
        target_death_snapshots: payload.all_death_snapshots ? payload.all_death_snapshots.filter(s => s.steamid === target) : payload.target_death_snapshots };
}
async function clearAi(id) {
    const jobs = db.prepare("SELECT id,status FROM replay_jobs WHERE kind='ai' AND digest=?").all(id);
    if (jobs.some(j => j.status === 'running')) throw errors.conflict('AI analysis is running');
    for (const job of jobs) {
        db.prepare('DELETE FROM replay_jobs WHERE id=?').run(job.id);
        await fs.rm(directory(job.id), { recursive: true, force: true });
    }
    for (const name of ['ai-report.json', 'ai-meta.json']) await fs.unlink(path.join(directory(id), name)).catch(e => { if (e.code !== 'ENOENT') throw e; });
}
async function selectPerspective(source, target, date, force = false) {
    if (source.status !== 'ready') throw errors.conflict('Demo is still parsing');
    const sourceMeta = JSON.parse(source.meta || '{}');
    const payload = JSON.parse(await fs.readFile(path.join(directory(source.id), 'parse.json'), 'utf8'));
    focusPayload(payload, target); // Validate before writing or replacing anything.
    const explicitTime = playedAt(date);
    const timestamp = explicitTime || sourceMeta.played_at || payload.match_started_at || null;
    const timeSource = explicitTime ? 'user_input' : sourceMeta.played_at_source || (sourceMeta.played_at ? 'user_input' : payload.match_started_at ? 'demo' : 'unknown');
    const sha = sourceMeta.demo_sha256 || payload.demo.sha256;
    const digest = `${sha}:${target}`;
    const existing = db.prepare("SELECT * FROM replay_jobs WHERE kind='demo' AND owner_id=? AND (digest=? OR (json_extract(meta,'$.demo_sha256')=? AND json_extract(meta,'$.target_player_id')=?)) AND coalesce(json_extract(meta,'$.selection_mode'),'')!='choose' ORDER BY updated_at DESC LIMIT 1")
        .get(source.owner_id, digest, sha, target);
    if (existing && ['queued', 'running'].includes(existing.status)) return existing;
    const previous = existing ? JSON.parse(existing.meta || '{}') : {};
    if (!force && existing?.status === 'ready' && previous.replay_version === '1.2.1' && (previous.played_at || null) === timestamp) return existing;
    if (!existing && db.prepare("SELECT count(*) AS n FROM replay_jobs WHERE owner_id=? AND kind='demo' AND coalesce(json_extract(meta,'$.selection_mode'),'')!='choose'").get(source.owner_id).n >= 20) throw errors.conflict('Please delete an old analysis before creating another');
    const id = existing?.id || crypto.randomUUID(), dir = directory(id), now = new Date().toISOString();
    await fs.mkdir(dir, { recursive: true });
    // Each perspective owns its input links: deleting another perspective cannot break it.
    if (id !== source.id) {
        await fs.copyFile(path.join(directory(source.id), 'parse.json'), path.join(dir, 'parse.json'));
        try { await fs.link(path.join(directory(source.id), 'match.dem'), path.join(dir, 'match.dem')); }
        catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
    if (existing) await clearAi(id);
    const meta = {file_name: sourceMeta.file_name, size_bytes: sourceMeta.size_bytes,
        demo_sha256: sha, target_player_id: target, target_selection: 'explicit', played_at: timestamp, played_at_source:timeSource,
        replay_version: '1.2.1'};
    await fs.writeFile(path.join(dir, 'task.json'), JSON.stringify({analysis_id:id, uploaded_at:now,
        target_player_id:target, target_selection:'explicit', played_at:timestamp, played_at_source:timeSource,
        file_name:meta.file_name, cached_parse: !!payload.all_player_samples, max_rounds:60}));
    if (existing) db.prepare("UPDATE replay_jobs SET status='queued',stage='queued',attempts=0,error=NULL,lease_until=NULL,updated_at=?,meta=? WHERE id=?")
        .run(now, JSON.stringify(meta), id);
    else db.prepare("INSERT INTO replay_jobs(id,owner_id,digest,version,kind,status,stage,created_at,updated_at,meta) VALUES(?,?,?,'demo-1.0.0','demo','queued','queued',?,?,?)")
        .run(id, source.owner_id, digest, now, now, JSON.stringify(meta));
    return db.prepare('SELECT * FROM replay_jobs WHERE id=?').get(id);
}
module.exports = {playedAt, roster, focusPayload, selectPerspective};
