#!/usr/bin/env node
'use strict';

/**
 * Offline Dust2 rule-engine probe.
 *
 * This consumes a parser output JSON, not a raw .dem:
 *
 *   node backend/scripts/analyze-demo.js match.dem /tmp/demo-out
 *   cd backend
 *   node scripts/analyze-dust2-parse.js /tmp/demo-out/parse.json T 12
 *
 * Omitting the round number analyses the first 10 rounds and prints a match
 * summary. The output is intentionally facts/checks, not AI narration.
 */
const fs = require('node:fs');
const path = require('node:path');
const dust2 = require('../src/services/dust2Tactics');

function usage() {
    console.error('usage: node scripts/analyze-dust2-parse.js <parse.json> <T|CT> [round] [--pretty]');
}

function main() {
    const args = process.argv.slice(2).filter((arg) => arg !== '--pretty');
    const [input, side, roundArg] = args;
    if (!input || !side) {
        usage();
        process.exitCode = 2;
        return;
    }
    if (!['T', 'CT'].includes(String(side).toUpperCase())) {
        throw new Error('side must be T or CT');
    }
    const payload = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
    const result = roundArg
        ? dust2.analyzeTeamRound(payload, Number(roundArg), side)
        : dust2.analyzeTeamMatch(payload, side, { maxRounds: 10 });
    console.log(JSON.stringify(result, null, 2));
}

try {
    main();
} catch (error) {
    console.error('analyze-dust2-parse failed:', error.message);
    process.exitCode = 1;
}
