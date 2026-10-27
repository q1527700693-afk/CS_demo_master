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
test('frontend replay tab endpoints expose rounds, paginated map and events', async () => {
    const round = await call(`/analyses/${analysisId}/rounds/3`);
    assert.equal(round.status, 200, JSON.stringify(round.body));
    assert.equal(round.body.data.round_num, 3);

    const map = await call(`/analyses/${analysisId}/rounds/3/map?limit=10&offset=0`);
    assert.equal(map.status, 200, JSON.stringify(map.body));
    assert.equal(map.body.data.items.length, 10);
    assert.equal(map.body.data.next_offset, 10);

    const events = await call(`/analysis-packages/${accepted.package_id}/events`);
    assert.equal(events.status, 200, JSON.stringify(events.body));
    assert.equal(events.body.data.match_id, accepted.match_id);
    assert.equal(events.body.data.package_id, accepted.package_id);
    assert.ok(Array.isArray(events.body.data.events));
    assert.ok(events.body.data.events.length > 0);

    const otherRound = await call(`/analyses/${analysisId}/rounds/3`, {}, otherToken);
    assert.equal(otherRound.status, 404);
    const otherEvents = await call(`/analysis-packages/${accepted.package_id}/events`, {}, otherToken);
    assert.equal(otherEvents.status, 404);
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
    assert.equal((await call(`/analysis-packages/${accepted.package_id}/global`)).status,409);
    assert.equal((await call(`/analysis-packages/${accepted.package_id}/evidence?version=1.2`)).status,409);
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

const globalSample = fs.readFileSync(path.join(__dirname, 'fixtures/ZywOo-B8-vs-Vitality-Mirage-all-players-v1.2.zip'));
let globalPackage, globalAnalysis, globalDir;
test('v1.2 real ZIP over the previous expanded limit imports and exposes separate global data', async () => {
    const result = await cloudUpload(globalSample);
    assert.equal(result.status, 201, JSON.stringify(result)); globalPackage = result.body.data;
    globalDir = directory(db.prepare('SELECT storage_id FROM analysis_packages WHERE package_id=?').get(globalPackage.package_id).storage_id);
    assert.ok(fs.statSync(path.join(globalDir, 'map.json')).size > 50 * 1024 * 1024);
    assert.equal((await cloudUpload(globalSample)).body.data.reused, true);
    const summary = (await call(`/analysis-packages/${globalPackage.package_id}/global`)).body.data;
    assert.equal(summary.schema_version, '1.2.0'); assert.equal(summary.all_player_stats.length, 10);
    assert.deepEqual(summary.counts, { events: 4316, samples: 39046, trajectories: 319 });
    assert.equal(summary.global_sampling.periodic_interval_seconds, 0.5);
    assert.equal(summary.export_scope.ownership, 'source_only_no_inference');
    assert.equal(summary.rounds.length, 18);
});
test('v1.2 single-player report does not double count global streams', async () => {
    const created = await call(`/matches/${globalPackage.match_id}/analyses`, { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'global-report' }, body: JSON.stringify({ package_id: globalPackage.package_id, target_player_id: globalPackage.target_player_id }) });
    assert.equal(created.status, 202); globalAnalysis = created.body.data.analysis_id;
    let job;
    for (let i = 0; i < 1200; i++) {
        job = (await call(`/analyses/${globalAnalysis}`)).body.data;
        if (['completed', 'partial', 'failed'].includes(job.status)) break;
        assert.equal((await call('/health')).status, 200); await delay(50);
    }
    assert.equal(job.status, 'partial', JSON.stringify(job));
    const report = (await call(`/analyses/${globalAnalysis}/report`)).body.data;
    require('../src/services/replaySchema').enforce(require('../src/services/replaySchema').report, report, 'report');
    assert.equal(report.report.findings.length, 6); assert.equal(report.report.ai_status, 'not_configured');
    const details = (await call(`/analyses/${globalAnalysis}/details`)).body.data;
    assert.deepEqual(details.statistics.modules, JSON.parse(fs.readFileSync(path.join(globalDir, 'metrics.json'))).modules);
    assert.equal(details.findings.filter(f => f.rule_id === 'team_flash').length, 3);
    assert.equal(details.findings.filter(f => f.rule_id === 'death_unused_utility').length, 3);
    assert.equal(details.map.counts.all_player_samples, 39046);
    console.log('v1.2 analysis benchmark (local):', JSON.stringify(details.performance));
});
test('global events and samples have bounded seek pagination and round filtering', async () => {
    const prefix = `/analysis-packages/${globalPackage.package_id}/global`;
    const a = (await call(`${prefix}/samples?round_num=1&limit=7`)).body.data;
    const b = (await call(`${prefix}/samples?round_num=1&limit=7&offset=${a.next_offset}`)).body.data;
    assert.equal(a.items.length, 7); assert.equal(a.next_offset, 7); assert.equal(b.offset, 7);
    assert.ok(a.items.every(item => item.round_num === 1 && typeof item.state.steamid === 'string'));
    assert.notDeepEqual(a.items, b.items);
    const events = (await call(`${prefix}/events?round_num=2&limit=500`)).body.data;
    assert.ok(events.items.length > 0); assert.ok(events.items.every(e => e.round_num === 2 && e.data.scope === 'match_context'));
    assert.deepEqual((await call(`${prefix}/samples?offset=500000`)).body.data.items, []);
    for (const query of ['limit=501', 'offset=-1', 'round_num=../1', 'round_num=1&round_num=2', 'offset=1e2', 'player=123']) assert.equal((await call(`${prefix}/samples?${query}`)).status, 400, query);
    assert.equal((await call(`${prefix}/unknown`)).status, 404);
});
test('global trajectory pages preserve every source row, ownership and aligned point arrays', async () => {
    const expected = [];
    await require('../src/services/replayImport').streamMap(path.join(globalDir, 'map.json'), async (kind, item) => {
        if (kind === 'all_trajectories') expected.push(item);
    }, '1.2.0');
    let offset = 0, points = 0, count = 0;
    do {
        const page = (await call(`/analysis-packages/${globalPackage.package_id}/global/trajectories?offset=${offset}&limit=500`)).body.data;
        assert.equal(page.total, 319); assert.ok(page.items.length > 0);
        for (const item of page.items) { assert.deepEqual(item, expected[count++]); points += item.records.length; }
        offset = page.next_offset;
    } while (offset !== null);
    assert.equal(count, 319); assert.equal(points, 46904);
    assert.ok(expected.some(t => t.points.length > 200));
    assert.ok(expected.every(t => t.ownership === 'unknown' && t.thrower_player_id === null));
});
test('v1.2 retains default and v1.1 evidence contracts and has explicit full evidence', async () => {
    const prefix = `/analysis-packages/${globalPackage.package_id}/evidence`;
    const legacy = (await call(prefix)).body.data;
    const validate = new (require('ajv'))({ strict: false }).compile(require('../contracts/openapi.json').components.schemas.Evidence);
    assert.equal(validate(legacy), true, JSON.stringify(validate.errors)); assert.equal(legacy.events.length, 1111);
    const detailed = (await call(prefix + '?version=1.1')).body.data;
    const mapValidator = require('../src/services/replaySchema').forVersion('1.1.0').files.map;
    assert.equal(mapValidator(detailed.map), true, JSON.stringify(mapValidator.errors));
    assert.equal(detailed.map.all_player_samples, undefined); assert.equal(detailed.events.length, 1111);
    const full = (await call(prefix + '?version=1.2')).body.data;
    assert.equal(full.events.items.length, 1111); assert.equal(full.events.global_items.length, 4316);
    assert.equal(full.map.all_player_samples.length, 39046); assert.equal(full.map.schema_version, '1.2.0');
    assert.equal((await call(prefix + '?version=9')).status, 400);
});
test('global endpoints enforce ownership and package deletion cleans all indexed data', async () => {
    const prefix = `/analysis-packages/${globalPackage.package_id}`;
    for (const endpoint of ['/global', '/global/events', '/global/samples', '/global/trajectories', '/evidence?version=1.2']) {
        assert.equal((await call(prefix + endpoint, {}, otherToken)).status, 404);
        assert.equal((await call(prefix + endpoint, {}, null)).status, 401);
    }
    assert.equal((await call(prefix, { method: 'DELETE' })).status, 200);
    assert.equal(fs.existsSync(globalDir), false);
    assert.equal((await call(prefix + '/global')).status, 404);
});

function minimalGlobal(v) {
    for (const value of Object.values(v)) value.schema_version = '1.2.0';
    const coverage = Object.fromEntries(['stats','kills','damages','shots','blinds','bomb','item_events','round_economy','grenades','smokes','fires'].map(k => [k, { status: 'empty', source_rows: 0, retained_source_rows: 0 }]));
    const sampling = { scope: 'all_players', periodic_interval_ticks: 32, periodic_interval_seconds: 0.5, visibility: 'not_evaluated', round_scope: 'recorded_non_knife_rounds', missing_states: 'not_interpolated' };
    v['manifest.json'].export_scope = { scope: 'all_players_and_all_utility', round_scope: 'recorded_non_knife_rounds', target_analysis_preserved: true, global_dataset_coverage: coverage, position_sampling: sampling, utility_sampling: 'all_source_rows', ownership: 'source_only_no_inference' };
    v['metrics.json'].all_player_stats = [];
    v['events.json'].global_items = []; v['events.json'].global_coverage = structuredClone(coverage);
    Object.assign(v['map.json'], { global_sampling: sampling, all_player_samples: [], all_trajectories: [] });
}
function oneTrajectory(v) {
    const t = { trajectory_id: 'test-global', entity_id: 1, entity_serial: 2, type: 'smoke', thrower_player_id: null, ownership: 'unknown', start_tick: 100, end_tick: 100, sample_stride_rows: 1,
        points: [[null, 2, 3]], point_ticks: [100], records: [{ tick: 100, entity_id: 1, entity_serial: 2, type: 'smoke', x: null, y: 2, z: 3, thrower_steamid: null }] };
    v['map.json'].all_trajectories = [t];
    for (const c of [v['manifest.json'].export_scope.global_dataset_coverage, v['events.json'].global_coverage]) c.grenades = { status: 'available', source_rows: 1, retained_source_rows: 1 };
    return t;
}
for (const [name, mutate, reason] of [
    ['mixed versions', v => { v['events.json'].schema_version = '1.1.0'; }, /Schema|envelope/],
    ['missing global array', v => { delete v['map.json'].all_player_samples; }, /Schema/],
    ['numeric global SteamID', v => { v['metrics.json'].all_player_stats = [{ steamid: 123 }]; }, /SteamID/],
    ['global event coverage', v => { v['events.json'].global_coverage.kills.source_rows = 1; }, /coverage/],
    ['duplicate global event', v => { const e = { event_id: 'global-test', type: 'kill', tick: 100, time_seconds: 1, round_num: 1, data: { source_dataset: 'kills', scope: 'match_context', record: {} } }; v['events.json'].global_items = [e, e]; }, /event ID/],
    ['global sample roster', v => { v['map.json'].all_player_samples = [{ tick: 100, time_seconds: 1, round_num: 1, state: { tick: 100, steamid: '123', x: null, y: null, z: null } }]; }, /roster/],
    ['unaligned global trajectory', v => { oneTrajectory(v).point_ticks = [100, 101]; }, /alignment/],
    ['changed global coordinates', v => { oneTrajectory(v).points[0][0] = 0; }, /point mismatch/],
    ['inferred global ownership', v => { const t = oneTrajectory(v); t.ownership = 'known'; t.thrower_player_id = v['manifest.json'].target_player_id; }, /ownership/],
    ['global coverage point loss', v => { oneTrajectory(v); v['manifest.json'].export_scope.global_dataset_coverage.grenades.retained_source_rows = 2; }, /coverage/],
]) test(`v1.2 rejects ${name}`, async () => {
    const bytes = await alteredZip(v => { minimalGlobal(v); mutate(v); });
    const r = await cloudUpload(bytes); assert.equal(r.status, 400, JSON.stringify(r)); assert.match(r.body.message, reason);
});
test('v1.2 preserves null coordinates and conflict ownership without inferring an owner', async () => {
    const bytes = await alteredZip(v => {
        minimalGlobal(v); const t = oneTrajectory(v);
        t.ownership = 'conflicting'; t.end_tick = 101;
        t.records[0].thrower_steamid = '111'; t.records.push({ ...t.records[0], tick: 101, thrower_steamid: '222' });
        t.points.push([null, 2, 3]); t.point_ticks.push(101);
        for (const c of [v['manifest.json'].export_scope.global_dataset_coverage, v['events.json'].global_coverage]) c.grenades = { status: 'available', source_rows: 2, retained_source_rows: 2 };
        // Header order is deliberately changed; validation must not depend on it.
        delete v['map.json'].schema_version; v['map.json'].schema_version = '1.2.0';
    });
    const r = await cloudUpload(bytes); assert.equal(r.status, 201, JSON.stringify(r));
    const prefix = `/analysis-packages/${r.body.data.package_id}`;
    const t = (await call(prefix + '/global/trajectories')).body.data.items[0];
    assert.equal(t.points[0][0], null); assert.equal(t.thrower_player_id, null); assert.equal(t.ownership, 'conflicting');
    await call(prefix, { method: 'DELETE' });
});
test('v1.2 rejects declared expanded size above 256 MiB before extraction', async () => {
    const bytes = Buffer.from(globalSample);
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); assert.ok(central >= 0);
    bytes.writeUInt32LE(257 * 1024 * 1024, central + 24);
    const r = await cloudUpload(bytes); assert.equal(r.status, 413); assert.match(r.body.message, /256 MiB/);
});
