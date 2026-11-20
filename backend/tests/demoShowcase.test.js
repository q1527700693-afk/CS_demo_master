'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'showcase-test-'));
process.env.DB_PATH = path.join(tmp, 'app.db');
process.env.REPLAY_DIR = path.join(tmp, 'replays');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'showcase-test-secret';

const app = require('../src/app');
const { db } = require('../src/services/replayStore');
const { directory } = require('../src/services/replayStore');

let server, base, token, otherToken, userId, otherId, sourceId;
const REAL_FETCH = global.fetch;

function call(endpoint, options = {}, auth = token) {
    return REAL_FETCH(base + '/api/v1' + endpoint, {
        ...options,
        headers: { ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...options.headers }
    }).then(async (response) => ({ status: response.status, headers: response.headers, body: await response.json() }));
}

function writeSource() {
    sourceId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO replay_jobs(id,owner_id,digest,version,kind,status,stage,created_at,updated_at,meta)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(sourceId, userId, `digest-${sourceId}`, 'demo-1.0.0', 'demo', 'ready', 'ready', now, now, '{}');
    const dir = directory(sourceId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({
        match: { map: 'de_mirage' },
        target_player_id: '76561198000000001',
        target_player: { name: 'Showcase Player' },
        statistics: {
            modules: {
                basic_stats: { metrics: { kills: 24, deaths: 12, adr: 102.5 } }
            }
        }
    }));
    fs.writeFileSync(path.join(dir, 'cloud-report.json'), JSON.stringify({ match: { map: 'de_mirage' } }));
    return dir;
}

function writeAi(dir) {
    fs.writeFileSync(path.join(dir, 'ai-report.json'), JSON.stringify({
        ai_status: 'completed',
        summary: 'AI summary fallback',
        strengths: [{ title: '道具创造突破', explanation: '用关键道具打开局面。' }]
    }));
}

test.before(async () => {
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    for (const username of ['showcase_owner', 'showcase_other']) {
        const response = await call('/auth/register', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username, password: 'long-test-password', nickname: username })
        }, null);
        assert.equal(response.status, 201);
        if (!token) { token = response.body.data.access_token; userId = response.body.data.user.id; }
        else { otherToken = response.body.data.access_token; otherId = response.body.data.user.id; }
    }
    writeSource();
});

test.after(async () => {
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
});

test('disabled showcase is the default for owner and visitors', async () => {
    const mine = await call('/users/me/demo-showcase');
    assert.equal(mine.status, 200);
    assert.deepEqual(mine.body.data, { enabled: false, analysis_id: null, mode: 'stats', snapshot: null });
    const publicView = await call(`/users/${userId}/demo-showcase`, {}, null);
    assert.equal(publicView.status, 200);
    assert.equal(publicView.headers.get('cache-control'), 'no-store');
    assert.deepEqual(publicView.body.data, { enabled: false, analysis_id: null, mode: 'stats', snapshot: null });
});

test('owner can publish a server-built stats snapshot', async () => {
    const response = await call('/users/me/demo-showcase', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true, analysis_id: sourceId, mode: 'stats' })
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.enabled, true);
    assert.equal(response.body.data.analysis_id, sourceId);
    assert.deepEqual(response.body.data.snapshot, {
        map: 'de_mirage', player_name: 'Showcase Player', kills: 24, deaths: 12, adr: 102.5,
        ai_title: 'AI 本场点评', ai_excerpt: ''
    });
});

test('cross-account source selection is rejected and public read is no-store', async () => {
    const cross = await call('/users/me/demo-showcase', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true, analysis_id: sourceId, mode: 'stats' })
    }, otherToken);
    assert.equal(cross.status, 404);
    const publicView = await call(`/users/${userId}/demo-showcase`, {}, null);
    assert.equal(publicView.status, 200);
    assert.equal(publicView.body.data.enabled, true);
    assert.equal(publicView.headers.get('cache-control'), 'no-store');
});

test('AI mode requires a completed AI report and stores AI title/excerpt', async () => {
    const before = await call('/users/me/demo-showcase', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true, analysis_id: sourceId, mode: 'ai' })
    });
    assert.equal(before.status, 409);
    const dir = directory(sourceId);
    writeAi(dir);
    const after = await call('/users/me/demo-showcase', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true, analysis_id: sourceId, mode: 'ai' })
    });
    assert.equal(after.status, 200);
    assert.equal(after.body.data.mode, 'ai');
    assert.equal(after.body.data.snapshot.ai_title, '道具创造突破');
    assert.match(after.body.data.snapshot.ai_excerpt, /关键道具/);
});

test('closing clears the public snapshot and deletion revokes it', async () => {
    const closed = await call('/users/me/demo-showcase', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false, analysis_id: sourceId, mode: 'ai' })
    });
    assert.equal(closed.status, 200);
    assert.equal(closed.body.data.enabled, false);
    const publicClosed = await call(`/users/${userId}/demo-showcase`, {}, null);
    assert.equal(publicClosed.body.data.enabled, false);

    const reopened = await call('/users/me/demo-showcase', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true, analysis_id: sourceId, mode: 'stats' })
    });
    assert.equal(reopened.status, 200);
    const removed = await call(`/demo-analyses/${sourceId}`, { method: 'DELETE' });
    assert.equal(removed.status, 200);
    const afterRevoke = await call(`/users/${userId}/demo-showcase`, {}, null);
    assert.equal(afterRevoke.body.data.enabled, false);
});

test('unknown fields and non-object bodies are rejected', async () => {
    const unknown = await call('/users/me/demo-showcase', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true, analysis_id: sourceId, mode: 'stats', snapshot: {} })
    });
    assert.equal(unknown.status, 400);
});
