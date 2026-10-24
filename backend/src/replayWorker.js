'use strict';
const { analyze } = require('./services/replayAnalysis');
const fs = require('node:fs/promises');
const path = require('node:path');
const { importPackage, saveCloudReport } = require('./services/cloudReplay');
// Also bound orphaned workers if the API process exits unexpectedly.
setTimeout(() => process.exit(1), 120000).unref();
async function work() {
    const dir = process.argv[2], kind = process.argv[3];
    if (kind === 'import') return importPackage(dir);
    const report = await analyze(dir, stage => process.send?.({ stage }));
    if (kind === 'analysis') await saveCloudReport(dir, report, JSON.parse(await fs.readFile(path.join(dir, 'task.json'), 'utf8')));
}
work()
    .then(() => { process.send?.({ ready: true }); process.disconnect?.(); })
    .catch(error => { process.send?.({ error: error.message.slice(0, 300) }); process.exitCode = 1; process.disconnect?.(); });
