'use strict';
const fs = require('node:fs');
const {db, directory} = require('./replayStore');

// Keep packages shared by other reports. IDs and storage paths come only from owned DB rows.
function pruneAnalysisPackage(owner, packageId) {
    if (db.prepare('SELECT 1 FROM analysis_runs WHERE owner_id=? AND package_id=?').get(owner,packageId)) return;
    const saved=db.prepare('SELECT * FROM analysis_packages WHERE owner_id=? AND package_id=?').get(owner,packageId);
    if (!saved) return;
    if (db.prepare('SELECT status FROM replay_jobs WHERE id=?').get(saved.storage_id)?.status === 'running') return;
    db.prepare('DELETE FROM analysis_packages WHERE owner_id=? AND package_id=?').run(owner,packageId);
    db.prepare('DELETE FROM replay_jobs WHERE id=? AND owner_id=?').run(saved.storage_id,owner);
    fs.rmSync(directory(saved.storage_id),{recursive:true,force:true,maxRetries:5,retryDelay:80});
}
function pruneDemoPerspectives(id) {
    const current=db.prepare('SELECT * FROM replay_jobs WHERE id=?').get(id);
    const meta=JSON.parse(current.meta || '{}');
    if (meta.selection_mode === 'choose' || !meta.demo_sha256 || !meta.target_player_id) return;
    const previous=db.prepare("SELECT id FROM replay_jobs WHERE kind='demo' AND owner_id=? AND id!=? AND status!='running' AND coalesce(json_extract(meta,'$.selection_mode'),'')!='choose' AND json_extract(meta,'$.demo_sha256')=? AND json_extract(meta,'$.target_player_id')=?")
        .all(current.owner_id,id,meta.demo_sha256,meta.target_player_id);
    for (const old of previous) {
        const jobs=db.prepare("SELECT id,status FROM replay_jobs WHERE kind='ai' AND digest=?").all(old.id);
        if (jobs.some(j=>j.status==='running')) continue;
        for (const entry of [old,...jobs]) {
            db.prepare('DELETE FROM replay_jobs WHERE id=?').run(entry.id);
            fs.rmSync(directory(entry.id),{recursive:true,force:true,maxRetries:5,retryDelay:80});
        }
    }
}
module.exports={pruneAnalysisPackage,pruneDemoPerspectives};
