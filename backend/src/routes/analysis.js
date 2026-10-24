'use strict';
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const { setTimeout: delay } = require('node:timers/promises');
const { pipeline } = require('node:stream/promises');
const { authenticate } = require('../middlewares/auth');
const { success, errors } = require('../utils/response');
const { db, root, directory, VERSION } = require('../services/replayStore');
const router = express.Router();
router.use(['/analysis-packages','/analyses','/matches'], authenticate);
const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res)).catch(next);
const upload = multer({ dest: path.join(root,'incoming'), limits: { fileSize: 50*1024*1024, files: 1, fields: 0, parts: 2 } }).single('file');
let uploading = 0;
function capacity(owner) {
    const counts = db.prepare("SELECT count(*) AS total, sum(CASE WHEN status IN ('queued','running') THEN 1 ELSE 0 END) AS pending FROM replay_jobs").get();
    if (counts.total >= 100 || counts.pending >= 50 || db.prepare('SELECT count(*) AS n FROM replay_jobs WHERE owner_id=?').get(owner).n >= 20 || db.prepare("SELECT count(*) AS n FROM replay_jobs WHERE owner_id=? AND status IN ('queued','running')").get(owner).n >= 3) throw errors.conflict('Analysis capacity reached; retry later or remove old packages');
}
async function discard(id) {
    db.prepare('DELETE FROM replay_jobs WHERE id=?').run(id);
    await fs.promises.rm(directory(id),{recursive:true,force:true});
}
function getPackage(owner,id) {
    const p = db.prepare('SELECT * FROM analysis_packages WHERE owner_id=? AND package_id=?').get(owner,id);
    if (!p) throw errors.notFound('Package not found'); return p;
}
function run(row) {
    return { analysis_id: row.id, match_id: row.match_id, package_id: row.package_id, target_player_id: row.target_player_id,
        status: row.status === 'ready' ? row.result_status : row.status,
        stage: row.status === 'ready' ? 'saved' : row.status === 'running' ? 'evaluating' : row.status,
        progress: row.status === 'ready' ? 100 : null, message: row.error || (row.status === 'ready' ? '报告已保存' : row.stage),
        report_available: row.status === 'ready', created_at: row.created_at, analyzed_at: row.status === 'ready' ? row.updated_at : null };
}
const joined = 'SELECT j.*,r.match_id,r.package_id,r.target_player_id,r.result_status,r.summary,r.idempotency_key,r.request_body FROM replay_jobs j JOIN analysis_runs r ON r.analysis_id=j.id';
function getRun(owner,id) {
    const r = db.prepare(joined+' WHERE j.owner_id=? AND j.id=?').get(owner,id);
    if (!r) throw errors.notFound('Analysis not found'); return r;
}
async function streamFile(res,file) { await pipeline(fs.createReadStream(file),res,{end:false}); }
async function stored(res,file) {
    await fs.promises.access(file); res.type('json'); res.write('{"code":0,"message":"success","data":'); await streamFile(res,file); res.end('}');
}
router.post('/analysis-packages', (req,res,next) => {
    try { if (uploading >= 2) throw errors.conflict('Upload busy; retry later'); }
    catch(e) { return next(e); }
    uploading++;
    upload(req,res,error => { uploading--; if (error) return next(error.code === 'LIMIT_FILE_SIZE' ? errors.fileTooLarge('ZIP exceeds 50 MiB') : errors.invalidParameter(error.message)); next(); });
}, wrap(async (req,res) => {
    if (!req.file) throw errors.invalidParameter('Multipart file is required');
    let job;
    try {
        const hash = crypto.createHash('sha256'); for await (const c of fs.createReadStream(req.file.path)) hash.update(c);
        const digest = hash.digest('hex');
        job = db.prepare("SELECT * FROM replay_jobs WHERE owner_id=? AND digest=? AND version='import-1.1.0'").get(req.user.id,digest);
        if (!job) {
            capacity(req.user.id);
            const id=crypto.randomUUID(), now=new Date().toISOString(), dir=directory(id);
            await fs.promises.mkdir(dir); await fs.promises.rename(req.file.path,path.join(dir,'package.zip'));
            try { db.prepare("INSERT INTO replay_jobs(id,owner_id,digest,version,kind,created_at,updated_at) VALUES(?,?,?,'import-1.1.0','import',?,?)").run(id,req.user.id,digest,now,now); }
            catch(e) {
                await fs.promises.rm(dir,{recursive:true,force:true});
                if (!db.prepare("SELECT id FROM replay_jobs WHERE owner_id=? AND digest=? AND version='import-1.1.0'").get(req.user.id,digest)) throw e;
            }
            job=db.prepare("SELECT * FROM replay_jobs WHERE owner_id=? AND digest=? AND version='import-1.1.0'").get(req.user.id,digest);
        }
    } finally { await fs.promises.unlink(req.file.path).catch(()=>{}); }
    const deadline=Date.now()+150000;
    while (!['ready','failed'].includes(job.status) && Date.now()<deadline) {
        await delay(150); job=db.prepare('SELECT * FROM replay_jobs WHERE id=?').get(job.id);
        if (!job) throw errors.invalidParameter('Validation failed; retry upload');
    }
    if (job.status==='failed') {
        await discard(job.id);
        throw /exceeds|too large|Too many/i.test(job.error) ? errors.fileTooLarge(job.error) : errors.invalidParameter(job.error);
    }
    if (job.status!=='ready') throw errors.conflict('Validation still queued; retry the same upload');
    const {manifest:m,signature}=JSON.parse(await fs.promises.readFile(path.join(directory(job.id),'validated.json'),'utf8'));
    let p=db.prepare('SELECT * FROM analysis_packages WHERE owner_id=? AND package_id=?').get(req.user.id,m.package_id);
    if (p && p.signature!==signature) {
        if(p.storage_id!==job.id) await discard(job.id);
        throw errors.conflict('Package ID already exists with different content');
    }
    const prior=db.prepare('SELECT manifest FROM analysis_packages WHERE owner_id=? AND match_id=? LIMIT 1').get(req.user.id,m.match_id);
    if(prior && JSON.parse(prior.manifest).source.demo_sha256!==m.source.demo_sha256) {
        if(!p) await discard(job.id);
        throw errors.conflict('Match ID already belongs to a different Demo');
    }
    const reused=!!p;
    if (!p) {
        db.prepare('INSERT INTO analysis_packages(owner_id,package_id,match_id,target_player_id,storage_id,signature,uploaded_at,manifest) VALUES(?,?,?,?,?,?,?,?)').run(req.user.id,m.package_id,m.match_id,m.target_player_id,job.id,signature,job.created_at,JSON.stringify(m));
        p=getPackage(req.user.id,m.package_id);
    }
    if(p.storage_id!==job.id) await discard(job.id);
    success(res,{match_id:p.match_id,package_id:p.package_id,target_player_id:p.target_player_id,uploaded_at:p.uploaded_at,reused},'success',201);
}));
router.post('/matches/:match/analyses',wrap(async(req,res)=>{
    const key=req.get('Idempotency-Key'), body=req.body;
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(key||'') || !body || typeof body.package_id!=='string' || typeof body.target_player_id!=='string' || Object.keys(body).some(k=>!['package_id','target_player_id'].includes(k))) throw errors.invalidParameter('Idempotency-Key, package_id and target_player_id are required');
    const canonical=JSON.stringify([req.params.match,body.package_id,body.target_player_id]);
    const existing=db.prepare('SELECT * FROM analysis_runs WHERE owner_id=? AND idempotency_key=?').get(req.user.id,key);
    if (existing) {
        if (existing.request_body!==canonical) throw errors.conflict('Idempotency key reused for a different request');
        return success(res,run(getRun(req.user.id,existing.analysis_id)),'success',202);
    }
    const p=getPackage(req.user.id,body.package_id);
    if (p.match_id!==req.params.match || p.target_player_id!==body.target_player_id) throw errors.conflict('Match/package/player mismatch');
    capacity(req.user.id);
    const id=crypto.randomUUID(), now=new Date().toISOString(), dir=directory(id);
    await fs.promises.mkdir(dir);
    try {
        await fs.promises.copyFile(path.join(directory(p.storage_id),'package.zip'),path.join(dir,'package.zip'));
        await fs.promises.writeFile(path.join(dir,'task.json'),JSON.stringify({analysis_id:id,uploaded_at:p.uploaded_at,manifest:JSON.parse(p.manifest)}));
        db.exec('BEGIN IMMEDIATE');
        try {
            getPackage(req.user.id,body.package_id);
            db.prepare("INSERT INTO replay_jobs(id,owner_id,digest,version,kind,created_at,updated_at) VALUES(?,?,?,?,'analysis',?,?)").run(id,req.user.id,id,VERSION,now,now);
            db.prepare('INSERT INTO analysis_runs(analysis_id,owner_id,package_id,match_id,target_player_id,idempotency_key,request_body,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,req.user.id,p.package_id,p.match_id,p.target_player_id,key,canonical,now);
            db.exec('COMMIT');
        } catch(e) {db.exec('ROLLBACK');throw e;}
    } catch(e) {
        await fs.promises.rm(dir,{recursive:true,force:true});
        const concurrent=db.prepare('SELECT * FROM analysis_runs WHERE owner_id=? AND idempotency_key=?').get(req.user.id,key);
        if (concurrent && concurrent.request_body===canonical) return success(res,run(getRun(req.user.id,concurrent.analysis_id)),'success',202);
        if (concurrent) throw errors.conflict('Idempotency key conflict'); throw e;
    }
    success(res,run(getRun(req.user.id,id)),'queued',202);
}));
router.get('/analyses/:id',wrap(async(req,res)=>success(res,run(getRun(req.user.id,req.params.id)))));
router.get('/analyses/:id/report',wrap(async(req,res)=>{
    const job=getRun(req.user.id,req.params.id); if(job.status!=='ready') throw errors.conflict('Report not ready');
    await stored(res,path.join(directory(job.id),'cloud-report.json'));
}));
router.get('/analyses/:id/details',wrap(async(req,res)=>{
    const job=getRun(req.user.id,req.params.id); if(job.status!=='ready') throw errors.conflict('Report not ready');
    await stored(res,path.join(directory(job.id),'report.json'));
}));
router.delete('/analyses/:id',wrap(async(req,res)=>{
    const job=getRun(req.user.id,req.params.id);
    if(job.status==='running') throw errors.conflict('Analysis is running');
    await discard(job.id);success(res);
}));
router.delete('/analysis-packages/:id',wrap(async(req,res)=>{
    const p=getPackage(req.user.id,req.params.id);
    const jobs=db.prepare(joined+' WHERE j.owner_id=? AND r.package_id=?').all(req.user.id,p.package_id);
    if(jobs.some(j=>j.status==='running')) throw errors.conflict('Package has a running analysis');
    db.exec('BEGIN IMMEDIATE');
    try {
        for(const job of jobs) db.prepare('DELETE FROM replay_jobs WHERE id=?').run(job.id);
        db.prepare('DELETE FROM analysis_packages WHERE owner_id=? AND package_id=?').run(req.user.id,p.package_id);
        db.prepare('DELETE FROM replay_jobs WHERE id=?').run(p.storage_id);
        db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    for(const id of [p.storage_id,...jobs.map(j=>j.id)]) await fs.promises.rm(directory(id),{recursive:true,force:true});
    success(res);
}));
router.get('/matches/:match/analyses',wrap(async(req,res)=>{
    if(!db.prepare('SELECT 1 FROM analysis_packages WHERE owner_id=? AND match_id=?').get(req.user.id,req.params.match)) throw errors.notFound('Match not found');
    const rows=db.prepare(joined+' WHERE j.owner_id=? AND r.match_id=? ORDER BY j.created_at DESC,j.rowid DESC').all(req.user.id,req.params.match);
    success(res,{items:rows.map(run)});
}));
router.get('/matches',wrap(async(req,res)=>{
    const page=Number(req.query.page??1), pageSize=Number(req.query.pageSize??100);
    if(!Number.isSafeInteger(page)||page<1||page>100000||!Number.isInteger(pageSize)||pageSize<1||pageSize>100) throw errors.invalidParameter('Invalid pagination');
    const total=db.prepare('SELECT count(DISTINCT match_id) AS n FROM analysis_packages WHERE owner_id=?').get(req.user.id).n;
    const matches=db.prepare('SELECT match_id,min(uploaded_at) AS created_at FROM analysis_packages WHERE owner_id=? GROUP BY match_id ORDER BY created_at DESC,match_id LIMIT ? OFFSET ?').all(req.user.id,pageSize,(page-1)*pageSize);
    const items=matches.map(m=>{
        const pkg=db.prepare('SELECT manifest FROM analysis_packages WHERE owner_id=? AND match_id=? ORDER BY uploaded_at DESC,rowid DESC LIMIT 1').get(req.user.id,m.match_id);
        const rows=db.prepare(joined+' WHERE j.owner_id=? AND r.match_id=? ORDER BY j.created_at DESC,j.rowid DESC').all(req.user.id,m.match_id);
        const available=rows.find(r=>r.status==='ready');
        return {...m,match:JSON.parse(pkg.manifest).match,latest_analysis:rows[0]?run(rows[0]):null,
            latest_available_analysis_id:available?.id??null,summary:available?.summary?JSON.parse(available.summary):null};
    }); success(res,{items,page,pageSize,total});
}));
router.get('/analysis-packages/:id/evidence',wrap(async(req,res)=>{
    const p=getPackage(req.user.id,req.params.id), dir=directory(p.storage_id), m=JSON.parse(p.manifest);
    if(req.query.version && req.query.version!=='1.1') throw errors.invalidParameter('Unsupported evidence version');
    res.type('json');res.write('{"code":0,"message":"success","data":'+JSON.stringify({match_id:p.match_id,package_id:p.package_id}).slice(0,-1)+',"events":');
    if(req.query.version==='1.1') {
        // A separate small events projection avoids parsing the large map on the API thread.
        await streamFile(res,path.join(dir,'detailed-events.json'));
        res.write(',"map":');await streamFile(res,path.join(dir,'map.json'));
    } else {
        await streamFile(res,path.join(dir,'compat-events.json'));
        res.write(',"map":'+JSON.stringify({schema_version:'1.0.0',match_id:m.match_id,package_id:m.package_id,coordinate_system:'source_world',asset_version:null}).slice(0,-1)+',"trajectories":');
        await streamFile(res,path.join(dir,'compat-trajectories.json'));res.write('}');
    }res.end('}}');
}));
module.exports=router;
