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
    properties: { schema_version: { const: '1.1.0' }, match_id: { type: 'string', minLength: 1, maxLength: 128 },
        package_id: { type: 'string', minLength: 1, maxLength: 128 } } });
function envelope(value, manifest) {
    check(validateEnvelope(value), 'Invalid 1.1.0 document envelope');
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
async function unpack(file, dest) {
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
                    check(declared <= 50 * MB, 'Expanded ZIP exceeds 50 MiB');
                    const limit = entry.fileName === 'map.json' ? 80 * MB : entry.fileName === 'events.json' ? 16 * MB : 2 * MB;
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
    for (const name of FILES.filter(n => n !== 'map.json')) {
        data[name] = JSON.parse(await fsp.readFile(path.join(dest, name), 'utf8'));
        identifiers(data[name]);
    }
    const manifest = data['manifest.json'];
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
    check(Array.isArray(data['events.json'].items) && data['events.json'].items.length <= 20000, 'Invalid events');
    check(data['metrics.json'].modules && typeof data['metrics.json'].modules === 'object', 'Missing metrics modules');
    for (const [name, value] of Object.entries(data)) formal.enforce(formal.files[name.replace('.json', '')], value, name);
    const ids = new Set(), rounds = new Set(data['rounds.json'].items.map(r => r.round_num));
    check(rounds.size === data['rounds.json'].items.length, 'Duplicate round');
    for (const event of data['events.json'].items) {
        check(!ids.has(event.event_id), 'Duplicate event ID'); ids.add(event.event_id);
        check(event.round_num == null || rounds.has(event.round_num), 'Unknown event round');
    }
    for (const module of Object.values(data['metrics.json'].modules)) check(module.evidence_ids.every(id => ids.has(id)), 'Missing module evidence');
    return data;
}
// Consume one top-level array item at a time. No complete map arrays are retained.
async function streamMap(file, onItem) {
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
                check(['player_samples','target_keyframes','combat_participant_states','nearby_context','trajectories','unattributed_trajectories'].includes(key), 'Unknown map array');
                arrays.add(key); counts[key] = 0; arrayKey = key; depth++; continue;
            }
            if (arrayKey && depth === 2 && token.name === 'endArray') { arrayKey = null; depth--; continue; }
            if (depth >= (arrayKey ? 2 : 1) && !(depth === 1 && token.name === 'endObject')) {
                if (!assembler) { assembler = new Assembler(); size = 0; }
                size += String(token.value ?? '').length + 8;
                check(size < 512 * 1024 && depth < 40, 'Map record exceeds limits');
                if (token.name === 'keyValue') check(!['__proto__', 'constructor', 'prototype'].includes(token.value), 'Unsafe map key');
                assembler.consume(token);
                if (assembler.done) {
                    identifiers(assembler.current);
                    if (arrayKey) { check(++count <= 100000, 'Too many map records'); counts[arrayKey]++; formal.mapItem(arrayKey, assembler.current); await onItem(arrayKey, assembler.current); }
                    else metadata[key] = assembler.current;
                    assembler = null;
                }
            }
            if (start) depth++;
            if (end) depth--;
        }
        check(arrays.has('player_samples') && arrays.has('target_keyframes'), 'Missing map arrays');
        formal.mapHeader(metadata, counts);
        return metadata;
    } finally { input.destroy(); tokens.destroy(); }
}
module.exports = { unpack, streamMap, check, envelope };
