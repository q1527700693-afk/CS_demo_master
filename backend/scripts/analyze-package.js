'use strict';
// Offline acceptance helper; production requests must use authenticated HTTP APIs.
const fs = require('node:fs/promises');
const path = require('node:path');
const { analyze } = require('../src/services/replayAnalysis');
const { importPackage, saveCloudReport } = require('../src/services/cloudReplay');
const { randomUUID } = require('node:crypto');
(async () => {
    const [input, output] = process.argv.slice(2);
    if (!input || !output) throw new Error('Usage: node scripts/analyze-package.js <ZIP> <new-output-directory>');
    const dest = path.resolve(output);
    await fs.mkdir(dest); // Fail rather than overwrite an existing report directory.
    await fs.copyFile(path.resolve(input), path.join(dest, 'package.zip'));
    const uploaded_at = new Date().toISOString();
    await importPackage(dest);
    const { manifest } = JSON.parse(await fs.readFile(path.join(dest, 'validated.json'), 'utf8'));
    const report = await analyze(dest);
    await saveCloudReport(dest, report, { manifest, uploaded_at, analysis_id: randomUUID() });
    console.log(JSON.stringify({ report: path.join(dest, 'cloud-report.json'), details: path.join(dest, 'report.json'), rounds: report.rounds.length,
        findings: report.findings.length, ...report.performance }, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
