'use strict';

/**
 * Public "Demo highlight" snapshot.
 *
 * The browser may choose an analysis, but it may never submit the snapshot
 * itself. This service owns source validation, snapshot creation, public read
 * rules and revocation.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const { db } = require('../config/database');
const { directory } = require('./replayStore');
const { errors } = require('../utils/response');

const MODES = new Set(['stats', 'ai']);
const EMPTY = Object.freeze({ enabled: false, analysis_id: null, mode: 'stats', snapshot: null });

function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
}

function text(value, max) {
    return typeof value === 'string' ? value.slice(0, max) : '';
}

function normalizeAnalysisId(value) {
    return String(value || '').replace(/^cloud:/, '');
}

function disabled() {
    return { ...EMPTY };
}

async function readJson(file) {
    try {
        return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
        throw error;
    }
}

function userExists(userId) {
    return Boolean(db.prepare('SELECT id FROM users WHERE id=?').get(Number(userId)));
}

/**
 * Find an analysis owned by this user and load its server-side artifacts.
 * A missing/non-ready source is not disclosed as a private resource.
 */
async function resolveSource(userId, analysisId) {
    const raw = String(analysisId || '').trim();
    const id = normalizeAnalysisId(raw);
    if (!id) return { error: 'missing' };
    const job = db.prepare('SELECT * FROM replay_jobs WHERE id=? AND owner_id=?').get(id, Number(userId));
    if (!job) return { error: 'not_found' };
    if (job.status !== 'ready') return { error: 'not_ready' };
    const dir = directory(job.id);
    const [details, cloud, ai] = await Promise.all([
        readJson(path.join(dir, 'report.json')),
        readJson(path.join(dir, 'cloud-report.json')),
        readJson(path.join(dir, 'ai-report.json'))
    ]);
    if (!details && !cloud) return { error: 'not_ready' };
    return { raw, id, job, dir, details, cloud, ai };
}

function playerName(details, cloud) {
    const targetId = details?.target_player_id || cloud?.target_player_id || null;
    const fromDetails = details?.target_player?.name;
    if (fromDetails) return fromDetails;
    const fromCloud = cloud?.target_player?.name;
    if (fromCloud) return fromCloud;
    const fromPlayers = (details?.players || []).find((player) => String(player.player_id || player.steamid) === String(targetId));
    return fromPlayers?.name || '分析玩家';
}

function snapshotFromSource(source) {
    const details = source.details || {};
    const cloud = source.cloud || {};
    const report = cloud.report || {};
    const basic =
        details.statistics?.modules?.basic_stats?.metrics ||
        report.modules?.basic_stats?.metrics ||
        details.statistics?.source_player_stats ||
        {};
    const ai = source.ai || {};
    const strength = Array.isArray(ai.strengths) ? ai.strengths[0] : null;
    return {
        map: text(details.match?.map || cloud.match?.map || '', 100),
        player_name: text(playerName(details, cloud), 100),
        kills: finite(basic.kills),
        deaths: finite(basic.deaths),
        adr: finite(basic.adr),
        ai_title: text(strength?.title || 'AI 本场点评', 120),
        ai_excerpt: text(strength?.explanation || ai.summary || '', 280)
    };
}

function rowShape(row) {
    if (!row || !row.enabled || !row.analysis_id || !row.snapshot_json) return disabled();
    let snapshot;
    try {
        snapshot = JSON.parse(row.snapshot_json);
    } catch {
        return disabled();
    }
    return {
        enabled: true,
        analysis_id: String(row.analysis_id),
        mode: row.mode === 'ai' ? 'ai' : 'stats',
        snapshot: {
            map: text(snapshot.map, 100),
            player_name: text(snapshot.player_name, 100),
            kills: finite(snapshot.kills),
            deaths: finite(snapshot.deaths),
            adr: finite(snapshot.adr),
            ai_title: text(snapshot.ai_title, 120),
            ai_excerpt: text(snapshot.ai_excerpt, 280)
        }
    };
}

function rowFor(userId) {
    return db.prepare('SELECT * FROM demo_showcases WHERE user_id=?').get(Number(userId));
}

function clear(userId) {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO demo_showcases(user_id,enabled,analysis_id,mode,snapshot_json,updated_at)
        VALUES(?,0,NULL,'stats',NULL,?)
        ON CONFLICT(user_id) DO UPDATE SET enabled=0,analysis_id=NULL,mode='stats',snapshot_json=NULL,updated_at=excluded.updated_at`)
        .run(Number(userId), now);
    return disabled();
}

async function getMine(user) {
    const row = rowFor(user.id);
    if (!row) return disabled();
    if (!row.enabled) return disabled();
    const source = await resolveSource(user.id, row.analysis_id);
    if (source.error) {
        clear(user.id);
        return disabled();
    }
    return rowShape(row);
}

async function getPublic(userId) {
    if (!userExists(userId)) throw errors.notFound('User not found');
    const row = rowFor(userId);
    if (!row) return disabled();
    if (!row.enabled) return disabled();
    const source = await resolveSource(userId, row.analysis_id);
    if (source.error) {
        clear(userId);
        return disabled();
    }
    return rowShape(row);
}

function aiIsReady(source) {
    return source.ai?.ai_status === 'completed' && Array.isArray(source.ai.strengths);
}

async function putMine(user, body = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw errors.invalidParameter('Request body must be an object');
    }
    const allowed = new Set(['enabled', 'analysis_id', 'mode']);
    for (const key of Object.keys(body)) {
        if (!allowed.has(key)) throw errors.invalidParameter(`Unknown field: ${key}`);
    }
    if (typeof body.enabled !== 'boolean') throw errors.invalidParameter('enabled must be boolean');
    if (!body.enabled) {
        // The UI may still send its previous selection while switching off.
        return clear(user.id);
    }
    if (typeof body.analysis_id !== 'string' || !body.analysis_id.trim() || body.analysis_id.length > 128) {
        throw errors.invalidParameter('analysis_id is required');
    }
    const mode = body.mode ?? 'stats';
    if (!MODES.has(mode)) throw errors.invalidParameter('mode must be stats or ai');
    const source = await resolveSource(user.id, body.analysis_id);
    if (source.error === 'missing') throw errors.invalidParameter('analysis_id is required');
    if (source.error === 'not_found') throw errors.notFound('Analysis not found');
    if (source.error === 'not_ready') throw errors.conflict('Analysis is not completed');
    if (mode === 'ai' && !aiIsReady(source)) {
        throw errors.conflict('Generate the AI coaching report before selecting AI mode');
    }
    const snapshot = snapshotFromSource(source);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO demo_showcases(user_id,enabled,analysis_id,mode,snapshot_json,updated_at)
        VALUES(?,1,?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET enabled=1,analysis_id=excluded.analysis_id,
        mode=excluded.mode,snapshot_json=excluded.snapshot_json,updated_at=excluded.updated_at`)
        .run(Number(user.id), source.raw, mode, JSON.stringify(snapshot), now);
    return rowShape(rowFor(user.id));
}

function revokeForAnalysis(userId, analysisId) {
    const raw = String(analysisId || '').trim();
    if (!raw) return;
    const id = normalizeAnalysisId(raw);
    const now = new Date().toISOString();
    const rows = db.prepare('SELECT * FROM demo_showcases WHERE user_id=?').all(Number(userId));
    for (const row of rows) {
        if (normalizeAnalysisId(row.analysis_id) !== id) continue;
        db.prepare(`UPDATE demo_showcases SET enabled=0,analysis_id=NULL,mode='stats',snapshot_json=NULL,updated_at=? WHERE user_id=?`)
            .run(now, Number(userId));
    }
}

module.exports = {
    getMine,
    putMine,
    getPublic,
    revokeForAnalysis,
    resolveSource,
    EMPTY
};
