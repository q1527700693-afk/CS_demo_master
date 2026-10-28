#!/usr/bin/env node
'use strict';

/**
 * Stand-in for parser/parse_demo.py used by the test suite.
 *
 * The real parser needs Python and awpy; this stub keeps the HTTP integration
 * tests hermetic while exercising the exact CLI contract (--check, --input,
 * --output, --target-player) and the JSON the normalizer consumes.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const args = process.argv.slice(2);
const value = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
};

if (args.includes('--check')) {
    process.stdout.write(JSON.stringify({ ok: true, awpy: 'stub', polars: 'stub' }) + '\n');
    process.exit(0);
}

if (process.env.STUB_PARSER_FAIL === '1') {
    process.stderr.write(JSON.stringify({ error: { code: 'demo_parse_failed', message: 'stub parser failure' } }) + '\n');
    process.exit(4);
}

const input = value('--input');
const output = value('--output');
if (!input || !output) {
    process.stderr.write(JSON.stringify({ error: { code: 'usage_error', message: '--input and --output are required' } }) + '\n');
    process.exit(2);
}
if (!fs.existsSync(input)) {
    process.stderr.write(JSON.stringify({ error: { code: 'usage_error', message: 'demo file not found' } }) + '\n');
    process.exit(2);
}

const bytes = fs.readFileSync(input);
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
const { build } = require('./demo-parse-sample');
const payload = build({
    sha256,
    sizeBytes: bytes.length,
    fileName: path.basename(input)
});
const target = value('--target-player');
if (target && target !== payload.target_player_id) {
    payload.warnings.push(`target player ${target} is not in the demo roster; falling back to the top fragger`);
}
fs.writeFileSync(output, JSON.stringify(payload));
process.stdout.write(JSON.stringify({ ok: true, output, bytes: fs.statSync(output).size }) + '\n');
