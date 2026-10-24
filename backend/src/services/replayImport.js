'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const yauzl = require('yauzl');
const { parserStream: parser } = require('stream-json');
const { default: Assembler } = require('stream-json/assembler.js');
const Ajv = require('ajv');
const formal = require('./replaySchema');
const FILES = ['manifest.json', 'metrics.json', 'rounds.json', 'events.json', 'map.json'];
const MB = 1024 * 1024;
function check(ok, message) { if (!ok) throw new Error(message); }
const validateEnvelope = new Ajv().compile({ type: 'object', required: ['schema_version', 'match_id', 'package_id'],
    properties: { schema_version: { enum: ['1.1.0', '1.2.0'] }, match_id: { type: 'string', minLength: 1, maxLength: 128 },
        package_id: { type: 'string', minLength: 1, maxLength: 128 } } });
function envelope(value, manifest) {
    check(validateEnvelope(value), 'Invalid document envelope');
    check(value.schema_version === manifest.schema_version, 'Mixed document envelope versions');
    check(value.match_id === manifest.match_id && value.package_id === manifest.package_id, 'Package identity mismatch');
}
function identifiers(value, depth = 0) {
    check(depth < 40, 'JSON nesting exceeds limit');
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
        if (/(steamid|steam_id|player_id)$/.test(key)) check(child === null || typeof child === 'string', 'SteamID must be a string');
        if (typeof child === 'number') check(Number.isFinite(child), 'Non-finite number');
        check(!['__proto__', 'constructor', 'prototype'].includes(key), 'Unsafe JSON key');
        identifiers(child, depth + 1);
    }
}
async function unpack(file, dest, onGlobalEvent = async () => {}) {
    const zip = await new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, validateEntrySizes: true }, (e, z) => e ? reject(e) : resolve(z)));
    const entries = new Map(); let declared = 0;
    try {
        await new Promise((resolve, reject) => {
            zip.on('error', reject); zip.on('end', resolve);
            zip.on('entry', (entry) => {
                try {
                    check(FILES.includes(entry.fileName) && !entries.has(entry.fileName), 'Unknown or duplicate ZIP entry');
                    check(!(entry.generalPurposeBitFlag & 1), 'Encrypted ZIP unsupported');
                    check(((entry.externalFileAttributes >>> 16) & 0xf000) !== 0xa000, 'ZIP symlinks unsupported');
                    declared += entry.uncompressedSize;
                    check(declared <= 256 * MB, 'Expanded ZIP exceeds 256 MiB');
                    const limit = entry.fileName === 'map.json' ? 256 * MB : entry.fileName === 'events.json' ? 64 * MB : 2 * MB;
                    check(entry.uncompressedSize <= limit, `File too large: ${entry.fileName}`);
                    entries.set(entry.fileName, entry); zip.readEntry();
                } catch (e) { reject(e); }
            }); zip.readEntry();
        });
    } finally { zip.close(); }
    check(entries.size === 5, 'ZIP must contain exactly five required files');
    // Reopen with autoClose disabled: the central-directory scan above closes its handle.
    const reader = await new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: false }, (e, z) => e ? reject(e) : resolve(z)));
    const hashes = {};
    try {
        for (const [name, entry] of entries) {
            const input = await new Promise((resolve, reject) => reader.openReadStream(entry, (e, s) => e ? reject(e) : resolve(s)));
            let bytes = 0; const hash = crypto.createHash('sha256');
            await pipeline(input, new Transform({ transform(chunk, encoding, done) {
                bytes += chunk.length;
                if (bytes > entry.uncompressedSize) return done(new Error('Expanded size mismatch'));
                hash.update(chunk); done(null, chunk);
            } }), fs.createWriteStream(path.join(dest, name), { flags: 'w' }));
            check(bytes === entry.uncompressedSize, 'Expanded size mismatch');
            hashes[name] = { sha256: hash.digest('hex'), size_bytes: bytes };
        }
    } finally { reader.close(); }
    const data = {};
    for (const name of ['manifest.json', 'metrics.json', 'rounds.json']) {
        data[name] = JSON.parse(await fsp.readFile(path.join(dest, name), 'utf8'));
        identifiers(data[name]);
    }
    const manifest = data['manifest.json'];
    if (manifest.schema_version === '1.1.0') {
        check(declared <= 50 * MB, 'Expanded v1.1 ZIP exceeds 50 MiB');
        check(entries.get('events.json').uncompressedSize <= 16 * MB, 'Events file exceeds 16 MiB');
    }
    for (const value of Object.values(data)) envelope(value, manifest);
    check(typeof manifest.target_player_id === 'string', 'Missing target player');
    check(manifest.analysis_scope?.target_player_id === manifest.target_player_id &&
        manifest.analysis_scope?.identity_confirmation === 'user_confirmed_roster_selection' &&
        manifest.analysis_scope?.identity_verified === false &&
        manifest.analysis_scope?.scope === 'target_player_and_related_context', 'Invalid analysis scope');
    check(Array.isArray(manifest.players) && manifest.players.some(p => (p.player_id ?? p.steamid) === manifest.target_player_id), 'Target absent from roster');
    for (const name of FILES.filter(n => n !== 'manifest.json')) {
        check(manifest.files?.[name]?.sha256 === hashes[name].sha256 && manifest.files[name].size_bytes === hashes[name].size_bytes, `Integrity check failed: ${name}`);
    }
    check(Array.isArray(data['rounds.json'].items) && data['rounds.json'].items.length <= 100, 'Invalid rounds');
    check(data['metrics.json'].modules && typeof data['metrics.json'].modules === 'object', 'Missing metrics modules');
    const validators = formal.forVersion(manifest.schema_version);
    for (const [name, value] of Object.entries(data)) formal.enforce(validators.files[name.replace('.json', '')], value, name);
    const ids = new Set(), rounds = new Set(data['rounds.json'].items.map(r => r.round_num));
    check(rounds.size === data['rounds.json'].items.length, 'Duplicate round');
    const targetEvents = [], globalIds = new Set(), globalCounts = {};
    let targetBytes = 0;
    const eventMeta = await streamDocument(path.join(dest, 'events.json'), 'events', manifest.schema_version, async (kind, event) => {
        const seen = kind === 'items' ? ids : globalIds;
        check(event.event_id.length <= 128 && !seen.has(event.event_id), 'Duplicate event ID or oversized ID'); seen.add(event.event_id);
        check(event.round_num == null || event.round_num === 0 || rounds.has(event.round_num), 'Unknown event round');
        if (kind === 'items') {
            targetBytes += Buffer.byteLength(JSON.stringify(event));
            check(targetEvents.length < 20000 && targetBytes <= 16 * MB, 'Target events exceeds limits');
            targetEvents.push(event);
        } else {
            check(globalIds.size <= 200000, 'Too many global events');
            const source = event.data.source_dataset;
            globalCounts[source] = (globalCounts[source] || 0) + 1;
            await onGlobalEvent(event);
        }
    });
    envelope(eventMeta, manifest);
    if (manifest.schema_version === '1.2.0') {
        const coverage = eventMeta.global_coverage, declaredCoverage = manifest.export_scope.global_dataset_coverage;
        check(JSON.stringify(Object.keys(coverage).sort()) === JSON.stringify(Object.keys(declaredCoverage).sort()), 'Global coverage keys mismatch');
        for (const [key, value] of Object.entries(coverage)) {
            const expected = declaredCoverage[key];
            check(value.status === expected.status && value.source_rows === expected.source_rows && value.retained_source_rows === expected.retained_source_rows, 'Global coverage mismatch');
            check(value.retained_source_rows <= value.source_rows, 'Invalid global coverage count');
        }
        for (const key of ['kills','damages','shots','blinds','item_events','bomb','smokes','fires']) check((globalCounts[key] || 0) === coverage[key].retained_source_rows, 'Global event coverage mismatch');
        const stats = data['metrics.json'].all_player_stats, roster = new Set(manifest.players.map(p => p.player_id));
        check(new Set(stats.map(p => p.steamid)).size === stats.length && stats.every(p => roster.has(p.steamid)), 'Invalid all-player stats roster');
        check(stats.length === coverage.stats.retained_source_rows, 'Global stats coverage mismatch');
    }
    data['events.json'] = { ...eventMeta, items: targetEvents };
    for (const module of Object.values(data['metrics.json'].modules)) check(module.evidence_ids.every(id => ids.has(id)), 'Missing module evidence');
    return data;
}
// Consume one top-level array item at a time. No complete map arrays are retained.
async function streamDocument(file, name, version, onItem) {
    const rules = formal.forVersion(version).arrays[name];
    const input = fs.createReadStream(file);
    const tokens = input.pipe(parser({ streamKeys: false, streamStrings: false, streamNumbers: false }));
    input.on('error', e => tokens.destroy(e));
    let depth = 0, key, arrayKey = null, assembler = null, count = 0, size = 0;
    const metadata = {}; const keys = new Set(), arrays = new Set(), counts = {};
    try {
        for await (const token of tokens) {
            const start = token.name === 'startObject' || token.name === 'startArray';
            const end = token.name === 'endObject' || token.name === 'endArray';
            if (depth === 1 && token.name === 'keyValue') {
                check(!['__proto__', 'constructor', 'prototype'].includes(token.value), 'Unsafe map key');
                check(!keys.has(token.value), 'Duplicate map field'); keys.add(token.value); key = token.value; continue;
            }
            if (depth === 1 && token.name === 'startArray') {
                check(Object.hasOwn(rules, key), `Unknown ${name} array`);
                arrays.add(key); counts[key] = 0; arrayKey = key; depth++; continue;
            }
            if (arrayKey && depth === 2 && token.name === 'endArray') { arrayKey = null; depth--; continue; }
            if (depth >= (arrayKey ? 2 : 1) && !(depth === 1 && token.name === 'endObject')) {
                if (!assembler) { assembler = new Assembler(); size = 0; }
                size += String(token.value ?? '').length + 8;
                check(size < (arrayKey === 'all_trajectories' ? 8 * MB : 512 * 1024) && depth < 40, `${name} record exceeds limits`);
                if (token.name === 'keyValue') check(!['__proto__', 'constructor', 'prototype'].includes(token.value), 'Unsafe map key');
                assembler.consume(token);
                if (assembler.done) {
                    identifiers(assembler.current);
                    if (arrayKey) {
                        const limit = name === 'events' ? (version === '1.2.0' ? 220000 : 20000) : (version === '1.2.0' ? 500000 : 100000);
                        check(++count <= limit, `Too many ${name} records`); counts[arrayKey]++;
                        formal.item(name, arrayKey, assembler.current, version); await onItem(arrayKey, assembler.current);
                    }
                    else metadata[key] = assembler.current;
                    assembler = null;
                }
            }
            if (start) depth++;
            if (end) depth--;
        }
        if (name === 'map') check(arrays.has('player_samples') && arrays.has('target_keyframes'), 'Missing map arrays');
        formal.header(name, metadata, counts, version);
        return metadata;
    } finally { input.destroy(); tokens.destroy(); }
}
async function streamMap(file, onItem, version = '1.1.0') { return streamDocument(file, 'map', version, onItem); }
module.exports = { unpack, streamMap, streamDocument, check, envelope };
