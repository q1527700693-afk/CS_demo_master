'use strict';

/**
 * HTTP integration tests for the demo-file pipeline.
 *
 * The queue runs inline (`startQueue({ runner: runJob })`) and the Python
 * bridge is stubbed, because some hosts forbid spawning child processes at all.
 * Everything else is real: multipart upload, private storage, the job table,
 * normalization, artifact files and the report/AI HTTP contracts.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

const tmp = fs.mkdtempSync(path.join(__dirname, 'demo-tmp-'));
process.env.DB_PATH = path.join(tmp, 'app.db');
process.env.REPLAY_DIR = path.join(tmp, 'private');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'demo-test-secret';
delete process.env.DEEPSEEK_API_KEY;
delete process.env.AI_AUTO_ANALYZE;

const app = require('../src/app');
const demoParser = require('../src/services/demoParser');
const { db } = require('../src/services/replayStore');
const { runJob } = require('../src/services/replayJobRunner');
const { startQueue } = require('../src/services/replayQueue');
const { build, TARGET } = require('./fixtures/demo-parse-sample');

// --- stubs: no child process on this host ----------------------------------
demoParser.probe = async () => ({ available: true, python: 'stub', awpy: 'stub', polars: 'stub', reason: null });
demoParser.resetProbeCache = () => {};
demoParser.parseDemo = async ({ input, output }) => {
    const bytes = fs.readFileSync(input);
    const payload = build({
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        sizeBytes: bytes.length,
        fileName: 'match.dem'
    });
    fs.writeFileSync(output, JSON.stringify(payload));
    return payload;
};

const DEMO = Buffer.concat([Buffer.from('PBDEMS2\0'), Buffer.alloc(2048, 7)]);
const REAL_FETCH = global.fetch;

let server, base, token, otherToken, stopQueue;
let demoId;

function call(endpoint, options = {}, auth = token) {
    return REAL_FETCH(base + '/api/v1' + endpoint, {
        ...options,
        headers: { ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...options.headers }
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
}

async function upload(bytes = DEMO, { auth = token, name = 'match.dem', target } = {}) {
    const form = new FormData();
    form.append('file', new Blob([bytes]), name);
    if (target) form.append('target_player_id', target);
    return call('/demo-analyses', { method: 'POST', body: form }, auth);
}

async function waitForDemo(id, status = 'completed', tries = 300) {
    for (let attempt = 0; attempt < tries; attempt += 1) {
        const response = await call('/demo-analyses/' + id);
        assert.equal(response.status, 200);
        if (response.body.data.status === status) return response.body.data;
        if (response.body.data.status === 'failed') {
            throw new Error('Demo job failed: ' + JSON.stringify(response.body.data));
        }
        await delay(40);
    }
    throw new Error('Demo job timed out');
}

async function waitForAi(id, tries = 200) {
    for (let attempt = 0; attempt < tries; attempt += 1) {
        const response = await call(`/demo-analyses/${id}/ai`);
        if (response.body.data.ai_status === 'completed' || response.body.data.last_error) return response.body.data;
        await delay(40);
    }
    throw new Error('AI job timed out');
}

test.before(async () => {
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    for (const username of ['demo_user', 'demo_other']) {
        const response = await call('/auth/register', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username, password: 'long-test-password' })
        }, null);
        assert.equal(response.status, 201);
        if (!token) token = response.body.data.access_token;
        else otherToken = response.body.data.access_token;
    }
    stopQueue = startQueue({ runner: runJob });
});

test.after(async () => {
    stopQueue?.();
    await delay(100);
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
});

test('parser status describes the interpreter and the AI configuration', async () => {
    const response = await call('/demo-analyses/parser');
    assert.equal(response.status, 200);
    assert.equal(response.body.data.available, true);
    assert.equal(response.body.data.ai.configured, false);
    assert.equal(response.body.data.max_size_bytes, 512 * 1024 * 1024);
});

test('rejects files that are not CS2 demos', async () => {
    const csgo = await upload(Buffer.concat([Buffer.from('HL2DEMO'), Buffer.alloc(64, 1)]));
    assert.equal(csgo.status, 400);
    assert.match(csgo.body.message, /CS:GO/);

    const random = await upload(Buffer.from('not a demo at all'));
    assert.equal(random.status, 400);
    assert.match(random.body.message, /PBDEMS2/);

    const gzip = await upload(Buffer.from([0x1f, 0x8b, 0x08, 0x00]));
    assert.equal(gzip.status, 400);
    assert.match(gzip.body.message, /Gzip/);
});

test('validates the optional target player id', async () => {
    const bad = await upload(DEMO, { target: 'not-a-steamid' });
    assert.equal(bad.status, 400);
    assert.match(bad.body.message, /SteamID64/);
});

test('uploading a demo produces a parsed, report-ready analysis', async () => {
    const created = await upload();
    assert.equal(created.status, 202, JSON.stringify(created.body));
    demoId = created.body.data.demo_id;
    assert.equal(created.body.data.status, 'queued');
    assert.equal(created.body.data.target_selection, 'auto_top_fragger');

    const done = await waitForDemo(demoId);
    assert.equal(done.status, 'completed');
    assert.equal(done.report_available, true);
    assert.equal(done.target_player_id, TARGET);
    assert.equal(done.map, 'de_mirage');
    assert.equal(done.score.terrorist + done.score['counter-terrorist'], 2);
    assert.equal(done.ai_status, 'not_configured');

    const details = (await call(`/demo-analyses/${demoId}/details`)).body.data;
    assert.equal(details.source.kind, 'demo_file');
    assert.equal(details.source.demo.file_name, 'match.dem');
    assert.equal(details.source.demo.size_bytes, DEMO.length);
    assert.match(details.source.demo.sha256, /^[a-f0-9]{64}$/);
    assert.equal(details.statistics.modules.death_context.metrics.reloading_deaths, 1);
    assert.ok(details.findings.some((finding) => finding.rule_id === 'self_flash'));

    const report = (await call(`/demo-analyses/${demoId}/report`)).body.data;
    assert.equal(report.report_schema_version, '1.0.0');
    assert.equal(report.status, 'completed');
    assert.equal(report.perspective.player_team_id, 'team-terrorist');
    assert.equal(report.report.ai_status, 'not_configured');
});

test('rounds, map pages and evidence are readable and paginated', async () => {
    const round = (await call(`/demo-analyses/${demoId}/rounds/2`)).body.data;
    assert.equal(round.round_num, 2);
    assert.ok(Array.isArray(round.events));

    const first = (await call(`/demo-analyses/${demoId}/rounds/1/map?limit=5`)).body.data;
    assert.equal(first.items.length, 5);
    assert.equal(first.next_offset, 5);
    assert.ok(first.items.every((item) => typeof item.kind === 'string'));

    const second = (await call(`/demo-analyses/${demoId}/rounds/1/map?limit=5&offset=5`)).body.data;
    assert.notDeepEqual(first.items, second.items);
    assert.equal((await call(`/demo-analyses/${demoId}/rounds/1/map?limit=999`)).status, 400);
    assert.equal((await call(`/demo-analyses/${demoId}/rounds/99`)).status, 404);

    const evidence = (await call(`/demo-analyses/${demoId}/evidence/death_0001`)).body.data;
    assert.equal(evidence.type, 'death_context');
    assert.equal(evidence.round_num, 2);
    assert.equal(evidence.data.is_reloading, true);
    assert.equal((await call(`/demo-analyses/${demoId}/evidence/nope`)).status, 404);
});

test('AI is disabled with a clear status when no key is configured', async () => {
    const read = await call(`/demo-analyses/${demoId}/ai`);
    assert.equal(read.status, 200);
    assert.equal(read.body.data.ai_status, 'not_configured');

    const post = await call(`/demo-analyses/${demoId}/ai`, { method: 'POST' });
    assert.equal(post.status, 503);
    assert.equal(post.body.code, 50300);
});

test('AI coaching runs from the demo report in a queued job', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_BASE_URL = 'https://api.example.invalid';
    process.env.DEEPSEEK_MODEL = 'demo-test-model';

    let requested;
    global.fetch = async (url, options) => {
        if (!String(url).startsWith('https://api.example.invalid')) return REAL_FETCH(url, options);
        requested = { url: String(url), body: JSON.parse(options.body) };
        return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
                choices: [{
                    message: {
                        content: JSON.stringify({
                            summary: 'Fixture 场次的换弹与道具时机需要回看。',
                            improvement_areas: [{
                                priority: 'high',
                                category: 'utility',
                                title: '死亡时仍携带道具',
                                evidence_ids: ['death_0001', 'blind_0001'],
                                explanation: '第 2 回合死亡快照显示仍携带闪光与烟雾，且同一场存在自闪。',
                                training: ['交火前先规划道具用途', '回看投掷后的掩护位置']
                            }],
                            strengths: [{
                                title: '首杀能力',
                                evidence_ids: ['kill_0001'],
                                explanation: '第 1 回合拿到首杀。'
                            }],
                            data_limitations: ['没有可见性数据']
                        })
                    }
                }]
            })
        };
    };

    try {
        const queued = await call(`/demo-analyses/${demoId}/ai`, { method: 'POST' });
        assert.equal(queued.status, 202, JSON.stringify(queued.body));
        assert.equal(queued.body.data.ai_status, 'queued');

        const result = await waitForAi(demoId);
        assert.equal(result.ai_status, 'completed');
        assert.equal(result.model, 'demo-test-model');
        assert.equal(result.source.kind, 'demo_file');
        assert.equal(result.summary.includes('道具'), true);
        assert.deepEqual(result.improvement_areas[0].evidence_ids, ['death_0001', 'blind_0001']);

        assert.ok(requested, 'provider was not called');
        assert.equal(requested.url, 'https://api.example.invalid/chat/completions');
        const facts = requested.body.messages[1].content;
        assert.match(facts, /de_mirage/);
        assert.match(facts, /eco/);
        assert.match(facts, /death_0001/);
        assert.doesNotMatch(facts, /player_samples/);
        assert.match(requested.body.messages[0].content, /不允许|不能/);

        const again = await call(`/demo-analyses/${demoId}/ai`, { method: 'POST' });
        assert.equal(again.status, 200);
        assert.equal(again.body.data.ai_status, 'completed');
    } finally {
        global.fetch = REAL_FETCH;
    }
});

test('AI rejects evidence ids that the demo does not contain', async () => {
    global.fetch = async (url, options) => {
        if (!String(url).startsWith('https://api.example.invalid')) return REAL_FETCH(url, options);
        return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
                choices: [{
                    message: {
                        content: JSON.stringify({
                            summary: '虚构证据',
                            improvement_areas: [{
                                priority: 'high',
                                category: 'aim',
                                title: '虚构',
                                evidence_ids: ['kill_9999'],
                                explanation: '不存在的事件',
                                training: ['训练']
                            }],
                            strengths: [],
                            data_limitations: []
                        })
                    }
                }]
            })
        };
    };
    try {
        const queued = await call(`/demo-analyses/${demoId}/ai?force=true`, { method: 'POST' });
        assert.equal(queued.status, 202);
        const result = await waitForAi(demoId);
        assert.match(result.last_error || '', /unknown evidence id/);
        // The deterministic report must stay readable after an AI failure.
        assert.equal((await call(`/demo-analyses/${demoId}/report`)).status, 200);
    } finally {
        global.fetch = REAL_FETCH;
        delete process.env.DEEPSEEK_API_KEY;
    }
});

test('re-uploading the same demo reuses the analysis', async () => {
    const again = await upload();
    assert.equal(again.status, 200);
    assert.equal(again.body.data.demo_id, demoId);
    assert.equal(again.body.data.reused, true);
});

test('a different target player is a separate analysis of the same demo', async () => {
    const other = await upload(DEMO, { target: '76561198000000009' });
    assert.equal(other.status, 202);
    assert.notEqual(other.body.data.demo_id, demoId);
    assert.equal(other.body.data.target_selection, 'explicit');
    await waitForDemo(other.body.data.demo_id);
    await call(`/demo-analyses/${other.body.data.demo_id}`, { method: 'DELETE' });
});

test('ownership, authentication and deletion are enforced', async () => {
    assert.equal((await upload(DEMO, { auth: null })).status, 401);
    for (const endpoint of [`/demo-analyses/${demoId}`, `/demo-analyses/${demoId}/report`,
        `/demo-analyses/${demoId}/details`, `/demo-analyses/${demoId}/evidence/death_0001`]) {
        assert.equal((await call(endpoint, {}, otherToken)).status, 404, endpoint);
    }
    assert.equal((await call(`/demo-analyses/${demoId}`, { method: 'DELETE' }, otherToken)).status, 404);

    const list = (await call('/demo-analyses')).body.data;
    assert.ok(list.total >= 1);
    assert.equal(list.page, 1);
    assert.equal((await call('/demo-analyses?pageSize=999')).status, 400);

    const removed = await call(`/demo-analyses/${demoId}`, { method: 'DELETE' });
    assert.equal(removed.status, 200);
    assert.equal((await call(`/demo-analyses/${demoId}`)).status, 404);
});

test('AI_AUTO_ANALYZE queues the coach as soon as a demo report is ready', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_BASE_URL = 'https://api.example.invalid';
    process.env.AI_AUTO_ANALYZE = 'true';
    global.fetch = async (url, options) => {
        if (!String(url).startsWith('https://api.example.invalid')) return REAL_FETCH(url, options);
        return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
                choices: [{
                    message: {
                        content: JSON.stringify({
                            summary: 'Auto coaching.',
                            improvement_areas: [{
                                priority: 'low',
                                category: 'other',
                                title: 'Auto',
                                evidence_ids: ['kill_0001'],
                                explanation: 'Auto.',
                                training: ['Auto.']
                            }],
                            strengths: [],
                            data_limitations: []
                        })
                    }
                }]
            })
        };
    };
    try {
        const created = await upload(Buffer.concat([Buffer.from('PBDEMS2\0'), Buffer.alloc(3072, 5)]));
        assert.equal(created.status, 202);
        const id = created.body.data.demo_id;
        const done = await waitForDemo(id);
        assert.equal(done.status, 'completed');

        let result;
        for (let attempt = 0; attempt < 200; attempt += 1) {
            result = (await call(`/demo-analyses/${id}/ai`)).body.data;
            if (result.ai_status === 'completed' || result.last_error) break;
            await delay(40);
        }
        assert.equal(result.ai_status, 'completed');
        assert.equal(result.source.kind, 'demo_file');
        await call(`/demo-analyses/${id}`, { method: 'DELETE' });
    } finally {
        global.fetch = REAL_FETCH;
        delete process.env.AI_AUTO_ANALYZE;
        delete process.env.DEEPSEEK_API_KEY;
    }
});

test('an unavailable parser fails fast with 503 instead of storing the demo', async () => {
    const original = demoParser.probe;
    demoParser.probe = async () => ({ available: false, reason: 'awpy is not installed', python: null, awpy: null });
    try {
        const response = await upload(Buffer.concat([Buffer.from('PBDEMS2\0'), Buffer.alloc(64, 3)]));
        assert.equal(response.status, 503);
        assert.equal(response.body.code, 50310);
        assert.match(response.body.message, /awpy is not installed/);
    } finally {
        demoParser.probe = original;
    }
});
