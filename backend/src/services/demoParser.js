'use strict';

/**
 * Bridge between the Node backend and parser/parse_demo.py.
 *
 * The parser is a separate process because awpy is a Python package with a
 * native demo decoder: it must not run on the API event loop, and a crashed
 * parse must never take the server down. Everything here is bounded by a
 * timeout and a strict output-size limit.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { ApiError, CODES } = require('../utils/response');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_SCRIPT = path.join(REPO_ROOT, 'parser', 'parse_demo.py');
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;
const PROBE_TTL_MS = 30_000;

const CODES_PARSER_UNAVAILABLE = CODES.DEMO_PARSER_UNAVAILABLE;

class ParserUnavailableError extends ApiError {
    constructor(message) {
        super(CODES_PARSER_UNAVAILABLE, message, 503);
        this.name = 'ParserUnavailableError';
    }
}

function pythonCandidates(env = process.env) {
    if (env.DEMO_PARSER_PYTHON) return [env.DEMO_PARSER_PYTHON];
    const venv = path.join(REPO_ROOT, 'parser', '.venv');
    return [
        path.join(venv, 'Scripts', 'python.exe'),
        path.join(venv, 'bin', 'python'),
        process.platform === 'win32' ? 'python.exe' : 'python3',
        process.platform === 'win32' ? 'py' : 'python'
    ];
}

function parserScript(env = process.env) {
    return env.DEMO_PARSER_SCRIPT ? path.resolve(env.DEMO_PARSER_SCRIPT) : DEFAULT_SCRIPT;
}

/** Awpy is usually installed either in the venv or in parser/.pydeps. */
function pythonPath(env = process.env) {
    if (env.DEMO_PARSER_PYTHONPATH) return env.DEMO_PARSER_PYTHONPATH;
    const bundled = path.join(REPO_ROOT, 'parser', '.pydeps');
    return fs.existsSync(bundled) ? bundled : '';
}

function environment(env = process.env) {
    const extra = pythonPath(env);
    return {
        ...env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        ...(extra ? { PYTHONPATH: extra } : {})
    };
}

function timeoutMs(env = process.env) {
    const value = Number(env.DEMO_PARSER_TIMEOUT_MS);
    return Number.isFinite(value) && value >= 5_000 ? value : DEFAULT_TIMEOUT_MS;
}

function run(command, args, { env, timeout, cwd }) {
    return new Promise((resolve) => {
        const child = spawn(command, args, { cwd, env, windowsHide: true });
        let stdout = '', stderr = '', settled = false;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(result);
        };
        const timer = setTimeout(() => {
            child.kill();
            finish({ code: null, stdout, stderr: `${stderr}\nparser timed out after ${timeout}ms`, timedOut: true });
        }, timeout);
        child.stdout.on('data', (chunk) => { if (stdout.length < 65536) stdout += chunk.toString('utf8'); });
        child.stderr.on('data', (chunk) => { if (stderr.length < 65536) stderr += chunk.toString('utf8'); });
        child.on('error', (error) => finish({ code: -1, stdout, stderr: `${stderr}\n${error.message}`, spawnError: true }));
        child.on('close', (code) => finish({ code, stdout, stderr }));
    });
}

function parseErrorPayload(stderr) {
    for (const line of String(stderr || '').split('\n').reverse()) {
        const text = line.trim();
        if (!text.startsWith('{')) continue;
        try {
            const payload = JSON.parse(text);
            if (payload?.error?.message) return payload.error;
        } catch { /* not the structured line */ }
    }
    return null;
}

let probeCache = null;

/**
 * Verify the interpreter can import awpy. Cached briefly: the upload route and
 * the parser status endpoint must not spawn a process per request.
 */
async function probe({ force = false, env = process.env } = {}) {
    const now = Date.now();
    if (!force && probeCache && now - probeCache.at < PROBE_TTL_MS) return probeCache.value;

    const script = parserScript(env);
    const reasons = [];
    if (!fs.existsSync(script)) {
        const value = { available: false, reason: `parser script not found: ${script}`, python: null, awpy: null };
        probeCache = { at: now, value };
        return value;
    }
    for (const candidate of pythonCandidates(env)) {
        if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) {
            reasons.push(`${candidate}: not found`);
            continue;
        }
        const result = await run(candidate, [script, '--check'], {
            env: environment(env), timeout: 60_000, cwd: REPO_ROOT
        });
        if (result.code === 0) {
            let parsed = {};
            try { parsed = JSON.parse(result.stdout.trim().split('\n').pop()); } catch { /* best effort */ }
            const value = { available: true, reason: null, python: candidate, awpy: parsed.awpy ?? null, polars: parsed.polars ?? null };
            probeCache = { at: now, value };
            return value;
        }
        const payload = parseErrorPayload(result.stderr);
        reasons.push(`${candidate}: ${payload?.message || (result.stderr || '').trim().slice(0, 200) || `exit ${result.code}`}`);
    }
    const value = {
        available: false,
        reason: `awpy is not installed for any interpreter (${reasons.join(' | ').slice(0, 400)}). ` +
            'Run "pip install awpy" (see parser/README.md).',
        python: null,
        awpy: null
    };
    probeCache = { at: now, value };
    return value;
}

function resetProbeCache() {
    probeCache = null;
}

/**
 * Parse one demo file. Resolves with the validated parser payload.
 * @param {object} options
 * @param {string} options.input absolute path to the .dem file
 * @param {string} options.output absolute path for the JSON result
 * @param {string} [options.targetPlayer]
 * @param {number} [options.maxRounds]
 * @param {number} [options.sampleEvery]
 */
async function parseDemo({ input, output, targetPlayer, maxRounds, sampleEvery, env = process.env }) {
    const status = await probe({ env });
    if (!status.available) throw new ParserUnavailableError(status.reason);

    const args = [parserScript(env), '--input', input, '--output', output];
    if (targetPlayer) args.push('--target-player', String(targetPlayer));
    if (Number.isInteger(maxRounds) && maxRounds > 0) args.push('--max-rounds', String(maxRounds));
    if (Number.isInteger(sampleEvery) && sampleEvery >= 8) args.push('--sample-every', String(sampleEvery));

    const result = await run(status.python, args, {
        env: environment(env), timeout: timeoutMs(env), cwd: REPO_ROOT
    });
    if (result.timedOut) {
        throw new ApiError(CODES.INTERNAL_ERROR, 'Demo parsing timed out; try a smaller demo', 500);
    }
    if (result.code === 3) {
        throw new ParserUnavailableError(parseErrorPayload(result.stderr)?.message || status.reason);
    }
    if (result.code === 2) {
        const payload = parseErrorPayload(result.stderr);
        throw new ApiError(CODES.INVALID_PARAMETER, payload?.message || 'Invalid or unreadable demo file', 400);
    }
    if (result.code !== 0) {
        const payload = parseErrorPayload(result.stderr);
        throw new ApiError(CODES.INTERNAL_ERROR,
            `Demo parsing failed: ${(payload?.message || result.stderr || '').trim().slice(0, 240) || `exit ${result.code}`}`, 500);
    }

    let stat;
    try {
        stat = await fsp.stat(output);
    } catch {
        throw new ApiError(CODES.INTERNAL_ERROR, 'Demo parser produced no output', 500);
    }
    if (stat.size <= 0 || stat.size > MAX_OUTPUT_BYTES) {
        throw new ApiError(CODES.FILE_TOO_LARGE, 'Parsed demo output exceeds the supported size', 413);
    }
    let payload;
    try {
        payload = JSON.parse(await fsp.readFile(output, 'utf8'));
    } catch (error) {
        throw new ApiError(CODES.INTERNAL_ERROR, `Demo parser returned invalid JSON: ${error.message}`, 500);
    }
    return payload;
}

module.exports = {
    parseDemo,
    probe,
    resetProbeCache,
    pythonCandidates,
    parserScript,
    pythonPath,
    environment,
    timeoutMs,
    CODES_PARSER_UNAVAILABLE,
    DEFAULT_SCRIPT
};
