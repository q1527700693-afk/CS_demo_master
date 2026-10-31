#!/usr/bin/env node
'use strict';

/**
 * Offline Dust2 match report:
 *
 *   node scripts/analyze-dust2-match.js /tmp/demo-out/parse.json "TEAM A" [maxRounds]
 *
 * The team selector accepts a demo team name, a comma-separated SteamID roster,
 * or T/CT. The output is deterministic facts/recommendations; no LLM call.
 */
const fs = require('node:fs');
const path = require('node:path');
const defense = require('../src/services/dust2Defense');

function printUsage() {
    console.error('usage: node scripts/analyze-dust2-match.js <parse.json> <team-name-or-steamids> [maxRounds]');
}

function main() {
    const [input, team, maxRoundsArg] = process.argv.slice(2);
    if (!input || !team) {
        printUsage();
        process.exitCode = 2;
        return;
    }
    const payload = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
    const maxRounds = Number(maxRoundsArg) || 10;
    const summary = defense.buildMatchSummary(payload, team, { maxRounds, scoutRounds: 6 });
    console.log(JSON.stringify(summary, null, 2));
}

try {
    main();
} catch (error) {
    console.error('analyze-dust2-match failed:', error.message);
    process.exitCode = 1;
}
