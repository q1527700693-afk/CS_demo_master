'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('Dust2 knowledge base passes structural validation', () => {
    const script = path.resolve(__dirname, '../scripts/validate-dust2-knowledge.js');
    const output = execFileSync(process.execPath, [script], { encoding: 'utf8' });
    assert.match(output, /Dust2 knowledge OK/);
    assert.match(output, /zones: 18/);
    assert.match(output, /utilities: 10/);
    assert.match(output, /tactics: 6/);
});
