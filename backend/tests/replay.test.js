'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const tmp = fs.mkdtempSync(path.join(__dirname, 'replay-tmp-'));
process.env.DB_PATH = path.join(tmp, 'app.db');
process.env.REPLAY_DIR = path.join(tmp, 'private');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'replay-test-secret';
delete process.env.DEEPSEEK_API_KEY;
const app = require('../src/app');
const { db, directory } = require('../src/services/replayStore');
const { startQueue } = require('../src/services/replayQueue');
const sample = fs.readFileSync(path.resolve(process.env.REPLAY_SAMPLE || path.join(__dirname, 'fixtures/sample-analysis-v1.1.zip')));
let server, base, token, otherToken, stop;
async function call(endpoint, options = {}, auth = token) {
    const r = await fetch(base + '/api/v1' + endpoint, { ...options, headers: { ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...options.headers } });
    return { status: r.status, body: await r.json() };
}
async function upload(bytes = sample, auth = token) {
    const form = new FormData(); form.append('file', new Blob([bytes]), 'analysis.zip');
    return call('/demos', { method: 'POST', body: form }, auth);
}
async function wait(id) {
    for (let i = 0; i < 300; i++) {
        const r = await call('/demos/' + id);
        if (['ready', 'failed'].includes(r.body.data.status)) return r.body.data;
        await delay(50);
    } throw new Error('Analysis timed out');
}
test.before(async () => {
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    for (const username of ['replay_user', 'other_user']) {
        const r = await call('/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'long-test-password' }) }, null);
        assert.equal(r.status, 201); if (!token) token = r.body.data.access_token; else otherToken = r.body.data.access_token;
    }
    stop = startQueue();
});
test.after(async () => {
    stop?.(); await delay(100); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
});
let id;
test('real ZIP produces evidence-backed report, statistics and streaming map', async () => {
    const created = await upload(); assert.equal(created.status, 202, JSON.stringify(created)); id = created.body.data.job_id;
    const donePromise = wait(id);
    for (let i = 0; i < 5; i++) { assert.equal((await call('/health')).status, 200); await delay(80); }
    const done = await donePromise; assert.equal(done.status, 'ready', JSON.stringify(done));
    const report = (await call(`/demos/${id}/report`)).body.data;
    assert.equal(report.rounds.length, 23);
    assert.equal(report.statistics.modules.basic_stats.metrics.kills, 33);
    assert.equal(report.map.counts.player_samples, 3760);
    assert.equal(report.map.counts.unattributed_trajectories, 131);
    assert.equal(report.findings.filter(f => f.rule_id === 'death_reloading').length, 1);
    assert.equal(report.findings.filter(f => f.rule_id === 'self_flash').length, 2);
    assert.equal(report.findings.filter(f => f.rule_id === 'death_holding_utility').length, 1);
    assert.equal(report.findings.filter(f => f.rule_id === 'death_unused_utility').length, 13);
    assert.equal(report.ai_status, 'not_requested');
    assert.ok(report.movement.measured_fire_ticks > 0);
    console.log('Replay benchmark (local, not 2-core cloud):', JSON.stringify(report.performance));
    const evidence = await call(`/demos/${id}/evidence/death_132`);
    assert.equal(evidence.body.data.round_num, 18); assert.equal(evidence.body.data.data.is_reloading, true);
    assert.equal((await call(`/demos/${id}/rounds/18`)).body.data.round_num, 18);
    const page = (await call(`/demos/${id}/rounds/1/map?limit=10`)).body.data;
    assert.equal(page.items.length, 10); assert.equal(page.next_offset, 10);
    const next = (await call(`/demos/${id}/rounds/1/map?limit=10&offset=10`)).body.data;
    assert.notDeepEqual(page.items, next.items);
    assert.equal((await call(`/demos/${id}/rounds/1/map?limit=999`)).status, 400);
});
test('identical upload reuses completed report', async () => {
    const r = await upload(); assert.equal(r.status, 200); assert.equal(r.body.data.job_id, id); assert.equal(r.body.data.reused, true);
});
test('authentication and per-user authorization cover report, evidence, map and deletion', async () => {
    assert.equal((await upload(sample, null)).status, 401);
    for (const endpoint of [`/demos/${id}`, `/demos/${id}/report`, `/demos/${id}/evidence/death_132`, `/demos/${id}/rounds/1/map`]) assert.equal((await call(endpoint, {}, otherToken)).status, 404);
    assert.equal((await call(`/demos/${id}`, { method: 'DELETE' }, otherToken)).status, 404);
    assert.equal((await fetch(base + `/uploads/../data/replays/${id}/package.zip`)).status, 404);
});
test('malformed ZIP fails asynchronously without interrupting API', async () => {
    const r = await upload(Buffer.from('not a ZIP')); assert.equal(r.status, 202);
    assert.equal((await wait(r.body.data.job_id)).status, 'failed');
    assert.equal((await call('/health')).status, 200);
});
async function alteredZip(mutate) {
    const yauzl = require('yauzl'), { ZipFile } = require('yazl');
    const values = {};
    const reader = await new Promise((resolve, reject) => yauzl.fromBuffer(sample, { lazyEntries: true }, (e,z) => e ? reject(e) : resolve(z)));
    await new Promise((resolve, reject) => {
        reader.on('error', reject); reader.on('end', resolve);
        reader.on('entry', entry => reader.openReadStream(entry, (err, stream) => {
            if (err) return reject(err); const chunks = [];
            stream.on('error', reject); stream.on('data', c => chunks.push(c));
            stream.on('end', () => { values[entry.fileName] = JSON.parse(Buffer.concat(chunks)); reader.readEntry(); });
        })); reader.readEntry();
    });
    const extra = mutate(values);
    for (const name of ['metrics.json','rounds.json','events.json','map.json']) {
        const bytes = Buffer.from(JSON.stringify(values[name]));
        values['manifest.json'].files[name] = { sha256: crypto.createHash('sha256').update(bytes).digest('hex'), size_bytes: bytes.length };
    }
    if (extra === 'hash') values['manifest.json'].files['metrics.json'].sha256 = '0'.repeat(64);
    const zip = new ZipFile(), chunks = [];
    const done = new Promise((resolve, reject) => { zip.outputStream.on('data', c => chunks.push(c)); zip.outputStream.on('end', () => resolve(Buffer.concat(chunks))); zip.outputStream.on('error', reject); });
    for (const [name, value] of Object.entries(values)) zip.addBuffer(Buffer.from(JSON.stringify(value)), name);
    if (extra === 'duplicate') zip.addBuffer(Buffer.from('{}'), 'metrics.json');
    zip.end(); return done;
}
for (const [name, mutate, reason] of [
    ['hash mismatch', () => 'hash', /Integrity/],
    ['old schema', v => { v['manifest.json'].schema_version = '1.0.0'; }, /envelope/],
    ['mixed match IDs', v => { v['events.json'].match_id = 'other-match'; }, /identity/],
    ['numeric SteamID', v => { v['manifest.json'].target_player_id = 123; }, /SteamID/],
    ['duplicate ZIP entries', () => 'duplicate', /duplicate/],
    ['duplicate event IDs', v => { v['events.json'].items[1].event_id = v['events.json'].items[0].event_id; }, /event ID/],
    ['wrong map player', v => { v['map.json'].player_samples[0].state.steamid = '123'; }, /target mismatch/],
    ['invalid map array', v => { v['map.json'].player_samples = null; }, /map arrays/],
    ['missing evidence', v => { v['metrics.json'].modules.utility.evidence_ids.push('missing'); }, /evidence/],
    ['unsafe map header', v => { Object.defineProperty(v['map.json'],'__proto__',{value:{polluted:true},enumerable:true}); }, /Unsafe map key/],
]) test(`rejects ${name}`, async () => {
    const r = await upload(await alteredZip(mutate)); assert.equal(r.status, 202);
    const job = await wait(r.body.data.job_id); assert.equal(job.status, 'failed'); assert.match(job.error, reason);
    await call(`/demos/${job.job_id}`, { method: 'DELETE' });
});
test('expired worker lease is recovered from persisted job', async () => {
    const job = db.prepare('SELECT * FROM replay_jobs WHERE id=?').get(id);
    const next = crypto.randomUUID(); fs.mkdirSync(directory(next)); fs.writeFileSync(path.join(directory(next), 'package.zip'), sample);
    db.prepare("INSERT INTO replay_jobs(id,owner_id,digest,version,status,attempts,lease_until,created_at,updated_at) VALUES(?,?,?,'test','running',1,1,?,?)").run(next, job.owner_id, next, job.created_at, job.created_at);
    assert.equal((await wait(next)).status, 'ready');
    assert.equal(db.prepare('SELECT attempts FROM replay_jobs WHERE id=?').get(next).attempts, 2);
});
test('owner can remove report and stored files', async () => {
    assert.equal((await call(`/demos/${id}`, { method: 'DELETE' })).status, 200);
    assert.equal(fs.existsSync(directory(id)), false);
    assert.equal((await call(`/demos/${id}`)).status, 404);
});

let accepted, analysisId;
async function cloudUpload(bytes=sample, auth=token) {
    const body=new FormData();body.append('file',new Blob([bytes]),'analysis.zip');
    return call('/analysis-packages',{method:'POST',body},auth);
}
function createAnalysis(key, changes={}) {
    return call(`/matches/${accepted.match_id}/analyses`,{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':key},body:JSON.stringify({package_id:accepted.package_id,target_player_id:accepted.target_player_id,...changes})});
}
test('handoff upload validates before 201 and does not run analysis',async()=>{
    const r=await cloudUpload();assert.equal(r.status,201,JSON.stringify(r));accepted=r.body.data;
    assert.equal(db.prepare('SELECT count(*) AS n FROM analysis_runs').get().n,0);
    assert.equal(typeof accepted.match_id,'string');assert.equal(accepted.target_player_id,'76561199836146468');
    assert.equal((await cloudUpload()).body.data.reused,true);
    const changed=await alteredZip(v=>{v['manifest.json'].analysis_scope.nickname_query='different';});
    assert.equal((await cloudUpload(changed)).status,409);
    const invalid=await alteredZip(v=>{v['metrics.json'].extra=true;});
    const bad=await cloudUpload(invalid);assert.equal(bad.status,400);assert.match(bad.body.message,/Schema/);
});
test('handoff idempotency and task/report identity satisfy formal contract',async()=>{
    const r=await createAnalysis('contract-1');assert.equal(r.status,202,JSON.stringify(r));analysisId=r.body.data.analysis_id;
    const again=await createAnalysis('contract-1');assert.equal(again.body.data.analysis_id,analysisId);
    assert.equal((await createAnalysis('contract-1',{target_player_id:'wrong'})).status,409);
    assert.equal((await createAnalysis('other-key',{target_player_id:'wrong'})).status,409);
    let job;
    for(let i=0;i<600;i++) {job=(await call(`/analyses/${analysisId}`)).body.data;if(['completed','partial','failed'].includes(job.status))break;await delay(50);}
    assert.equal(job.status,'partial',JSON.stringify(job));assert.equal(job.report_available,true);assert.equal(job.progress,100);
    const result=await call(`/analyses/${analysisId}/report`);assert.equal(result.status,200);
    const Ajv=require('ajv'), ajv=new Ajv({strict:false});
    const validate=ajv.compile(require('../contracts/report.schema.json'));
    assert.equal(validate(result.body.data),true,JSON.stringify(validate.errors));
    for(const key of ['match_id','package_id','target_player_id']) assert.equal(result.body.data[key],accepted[key]);
    assert.equal(result.body.data.analysis_id,analysisId);assert.equal(result.body.data.report.ai_status,'not_configured');
    assert.deepEqual(result.body.data.report.scores,{});
    assert.equal(result.body.data.report.findings.length,19);
});
test('AI endpoint is wired but safely disabled without an API key', async () => {
    const state = await call(`/analyses/${analysisId}/ai`);
    assert.equal(state.status, 200, JSON.stringify(state.body));
    assert.equal(state.body.data.ai_status, 'not_configured');

    const triggered = await call(`/analyses/${analysisId}/ai`, { method: 'POST' });
    assert.equal(triggered.status, 503, JSON.stringify(triggered.body));
    assert.equal(triggered.body.code, 50300);
});

test('compatible and detailed evidence preserve contract without misattributing trajectories',async()=>{
    const r=await call(`/analysis-packages/${accepted.package_id}/evidence`);assert.equal(r.status,200);
    const Ajv=require('ajv');const validate=new Ajv({strict:false}).compile(require('../contracts/openapi.json').components.schemas.Evidence);
    assert.equal(validate(r.body.data),true,JSON.stringify(validate.errors));
    assert.equal(r.body.data.map.trajectories.length,0);assert.equal(r.body.data.events.length,1314);
    const detailed=await call(`/analysis-packages/${accepted.package_id}/evidence?version=1.1`);
    assert.equal(detailed.body.data.map.schema_version,'1.1.0');assert.equal(detailed.body.data.map.unattributed_trajectories.length,131);
    assert.equal(detailed.body.data.map.player_samples.length,3760);
});
test('match history keeps available report when newest analysis fails; owners isolated',async()=>{
    const r=await createAnalysis('contract-2'), newer=r.body.data.analysis_id;
    db.prepare("UPDATE replay_jobs SET status='failed',stage='failed',error='simulated interruption' WHERE id=?").run(newer);
    const list=await call('/matches?page=1&pageSize=10');assert.equal(list.body.data.total,1);
    const match=list.body.data.items[0];assert.equal(match.latest_analysis.analysis_id,newer);
    assert.equal(match.latest_available_analysis_id,analysisId);assert.equal(match.summary.rating,null);
    assert.equal((await call(`/matches/${accepted.match_id}/analyses`)).body.data.items.length,2);
    assert.equal((await call('/matches?page=0')).status,400);
    for(const p of [`/analyses/${analysisId}`,`/analyses/${analysisId}/report`,`/analysis-packages/${accepted.package_id}/evidence`,`/matches/${accepted.match_id}/analyses`]) assert.equal((await call(p,{},otherToken)).status,404);
    assert.equal((await call('/matches',{},otherToken)).body.data.total,0);
    assert.equal((await cloudUpload(sample,null)).status,401);
});
test('concurrent idempotent creates reuse one run; new resources stay out of legacy routes',async()=>{
    const [a,b]=await Promise.all([createAnalysis('concurrent'),createAnalysis('concurrent')]);
    assert.equal(a.status,202);assert.equal(b.status,202);assert.equal(a.body.data.analysis_id,b.body.data.analysis_id);
    const id=a.body.data.analysis_id;
    assert.equal((await call(`/demos/${id}`)).status,404);
    assert.equal((await call(`/analyses/${analysisId}/details`)).body.data.rounds.length,23);
    // Keep the fixture deterministic by failing this queued job before the queue tick.
    db.prepare("UPDATE replay_jobs SET status='failed',stage='failed' WHERE id=? AND status='queued'").run(id);
    for(let i=0;i<600;i++) {const j=(await call(`/analyses/${id}`)).body.data;if(j.status!=='running'&&j.status!=='queued')break;await delay(50);}
});
test('deleting a package removes all its reports and files and is owner-only',async()=>{
    assert.equal((await call(`/analysis-packages/${accepted.package_id}`,{method:'DELETE'},otherToken)).status,404);
    const p=db.prepare('SELECT * FROM analysis_packages WHERE package_id=?').get(accepted.package_id);
    const runs=db.prepare('SELECT analysis_id FROM analysis_runs WHERE package_id=?').all(accepted.package_id);
    const result=await call(`/analysis-packages/${accepted.package_id}`,{method:'DELETE'});assert.equal(result.status,200,JSON.stringify(result));
    assert.equal(fs.existsSync(directory(p.storage_id)),false);
    for(const r of runs) {assert.equal(fs.existsSync(directory(r.analysis_id)),false);assert.equal((await call(`/analyses/${r.analysis_id}/report`)).status,404);}
    assert.equal((await call('/matches')).body.data.total,0);
});
