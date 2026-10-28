'use strict';

/**
 * Offline acceptance tool for the demo pipeline.
 *
 *   node scripts/analyze-demo.js path/to/match.dem data/demo-acceptance
 *
 * Runs the same parser bridge and normalizer as the HTTP path, without JWT,
 * SQLite or the queue. Useful on a new host to prove that awpy can be found and
 * that a real demo produces a report.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const demoParser = require('../src/services/demoParser');
const demoAnalysis = require('../src/services/demoAnalysis');

async function main() {
    const [input, outDir] = process.argv.slice(2);
    if (!input || !outDir) {
        console.error('usage: node scripts/analyze-demo.js <match.dem> <output-directory>');
        process.exitCode = 2;
        return;
    }
    const demo = path.resolve(input);
    const directory = path.resolve(outDir);
    if (!fs.existsSync(demo)) throw new Error(`demo not found: ${demo}`);
    if (fs.existsSync(directory)) throw new Error(`output directory already exists: ${directory}`);
    fs.mkdirSync(directory, { recursive: true });

    const status = await demoParser.probe({ force: true });
    console.error('parser:', JSON.stringify(status));
    if (!status.available) throw new Error(status.reason);

    const analysisId = crypto.randomUUID();
    const uploadedAt = new Date().toISOString();
    const started = Date.now();
    const payload = await demoParser.parseDemo({
        input: demo,
        output: path.join(directory, 'parse.json')
    });
    const analysis = demoAnalysis.normalize(payload, {
        analysisId,
        uploadedAt,
        targetSelection: 'auto_top_fragger'
    });
    await demoAnalysis.writeArtifacts(directory, analysis, { analysisId, uploadedAt });

    const details = analysis.details;
    console.log(JSON.stringify({
        analysis_id: analysisId,
        output: directory,
        elapsed_ms: Date.now() - started,
        map: details.match.map,
        rounds: details.match.rounds_played,
        score: details.match.score,
        target_player_id: details.target_player_id,
        target_name: details.target_player.name,
        modules: Object.fromEntries(Object.entries(details.statistics.modules)
            .map(([name, module]) => [name, module.status])),
        findings: details.findings.length,
        evidence_events: analysis.evidence.length,
        demo_sha256: details.source.demo.sha256
    }, null, 2));
}

main().catch((error) => {
    console.error('analyze-demo failed:', error.message);
    process.exitCode = 1;
});
