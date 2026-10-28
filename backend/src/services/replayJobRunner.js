'use strict';

/**
 * Everything a queued job actually does, independent of how it runs.
 *
 * `replayWorker.js` runs this in a child process (production: crash and memory
 * isolation). The test suite runs the same function inline through
 * `startQueue({ runner: runJob })`, so the pipeline is covered even when the
 * host forbids spawning child processes.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const { analyze } = require('./replayAnalysis');
const { importPackage, saveCloudReport } = require('./cloudReplay');
const demoParser = require('./demoParser');
const demoAnalysis = require('./demoAnalysis');
const aiAnalysis = require('./aiAnalysis');

async function readJson(file) {
    return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function runImport(dir) {
    await importPackage(dir);
}

async function runAnalysis(dir, onStage, kind = 'analysis') {
    const report = await analyze(dir, (stage) => onStage({ stage }));
    // Legacy `/demos` jobs build their report straight from package.zip and have
    // no task.json; only the new package flow assembles the cloud report.
    if (kind === 'analysis') {
        await saveCloudReport(dir, report, await readJson(path.join(dir, 'task.json')));
    }
    return report;
}

async function runDemo(dir, onStage) {
    const task = await readJson(path.join(dir, 'task.json'));
    onStage({ stage: 'parsing' });
    const payload = await demoParser.parseDemo({
        input: path.join(dir, 'match.dem'),
        output: path.join(dir, 'parse.json'),
        targetPlayer: task.target_player_id || undefined,
        maxRounds: task.max_rounds || undefined
    });
    onStage({ stage: 'analyzing' });
    const analysis = demoAnalysis.normalize(payload, {
        analysisId: task.analysis_id,
        uploadedAt: task.uploaded_at,
        targetSelection: task.target_selection || 'auto_top_fragger'
    });
    onStage({ stage: 'reporting' });
    await demoAnalysis.writeArtifacts(dir, analysis, {
        analysisId: task.analysis_id,
        uploadedAt: task.uploaded_at,
        aiConfigured: aiAnalysis.isConfigured()
    });
}

async function runAi(dir) {
    const task = await readJson(path.join(dir, 'ai-task.json'));
    const directory = task.demo_dir;
    const details = await readJson(path.join(directory, 'report.json'));
    const evidence = await readJson(path.join(directory, 'evidence-index.json')).catch(() => ({}));
    const result = await aiAnalysis.analyzeDemo(details, {
        analysisId: task.demo_job_id,
        evidenceIds: Object.keys(evidence)
    });
    await fs.writeFile(path.join(directory, 'ai-report.json'), JSON.stringify(result));
    await fs.writeFile(path.join(directory, 'ai-meta.json'), JSON.stringify({
        ai_status: 'completed',
        model: result.model,
        prompt_version: result.prompt_version,
        generated_at: result.generated_at,
        ai_job_id: path.basename(dir)
    }));
}

/**
 * @param {string} dir absolute private job directory
 * @param {string} kind import | analysis | demo | ai
 * @param {(message: {stage?: string}) => void} onStage progress reporter
 */
async function runJob(dir, kind, onStage = () => {}) {
    if (kind === 'import') return runImport(dir);
    if (kind === 'demo') return runDemo(dir, onStage);
    if (kind === 'ai') return runAi(dir);
    return runAnalysis(dir, onStage, kind);
}

module.exports = { runJob, runDemo, runAi, runAnalysis, runImport };
