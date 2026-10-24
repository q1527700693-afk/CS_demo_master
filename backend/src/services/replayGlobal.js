'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { finished } = require('node:stream/promises');
const { errors } = require('../utils/response');
const KINDS = ['events', 'samples', 'trajectories'];
const ENTRY_BYTES = 12;

// Fixed-size offset indexes keep paginated reads bounded even for large maps.
function createGlobalWriter(dir) {
    const streams = new Map(), counts = Object.fromEntries(KINDS.map(k => [k, { all: 0 }]));
    const offsets = Object.fromEntries(KINDS.map(k => [k, 0]));
    let failure;
    function output(name) {
        if (!streams.has(name)) {
            const stream = fs.createWriteStream(path.join(dir, name));
            stream.on('error', error => { failure = error; }); streams.set(name, stream);
        }
        return streams.get(name);
    }
    async function write(name, bytes) {
        if (failure) throw failure;
        const stream = output(name);
        if (!stream.write(bytes)) await once(stream, 'drain');
    }
    for (const kind of KINDS) { output(`global-${kind}.jsonl`); output(`global-${kind}-all.idx`); }
    return {
        counts,
        async append(kind, item, rounds) {
            const bytes = Buffer.from(JSON.stringify(item) + '\n'), index = Buffer.alloc(ENTRY_BYTES);
            if (bytes.length > 8 * 1024 * 1024) throw new Error('Global record exceeds 8 MiB');
            index.writeBigUInt64LE(BigInt(offsets[kind])); index.writeUInt32LE(bytes.length, 8);
            await write(`global-${kind}.jsonl`, bytes); offsets[kind] += bytes.length;
            for (const key of ['all', ...new Set(rounds.length ? rounds.map(String) : ['context'])]) {
                await write(`global-${kind}-${key}.idx`, index);
                counts[kind][key] = (counts[kind][key] || 0) + 1;
            }
        },
        async finish() {
            await Promise.all([...streams.values()].map(stream => { const done = finished(stream); stream.end(); return done; }));
            if (failure) throw failure;
            await fs.promises.writeFile(path.join(dir, 'global-index.json'), JSON.stringify(counts));
        },
        abort() { for (const stream of streams.values()) stream.destroy(); },
    };
}

async function readGlobalPage(dir, kind, query) {
    if (!KINDS.includes(kind)) throw errors.notFound('Unknown global dataset');
    if (Object.keys(query).some(key => !['round_num', 'offset', 'limit'].includes(key))) throw errors.invalidParameter('Unknown pagination parameter');
    const round = query.round_num ?? 'all';
    if (typeof round !== 'string' || !/^(all|context|[1-9]\d{0,2})$/.test(round)) throw errors.invalidParameter('Invalid round_num');
    const integer = (value, fallback) => value === undefined ? fallback : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
    const offset = integer(query.offset, 0), limit = integer(query.limit, 200);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 500000 || !Number.isInteger(limit) || limit < 1 || limit > 500) throw errors.invalidParameter('Invalid pagination');
    const counts = JSON.parse(await fs.promises.readFile(path.join(dir, 'global-index.json'), 'utf8'));
    const total = counts[kind][round] || 0, items = [];
    if (offset < total) {
        const index = await fs.promises.open(path.join(dir, `global-${kind}-${round}.idx`), 'r');
        let data;
        try {
            data = await fs.promises.open(path.join(dir, `global-${kind}.jsonl`), 'r');
            const entries = Buffer.alloc(Math.min(limit, total - offset) * ENTRY_BYTES);
            const read = await index.read(entries, 0, entries.length, offset * ENTRY_BYTES);
            if (read.bytesRead !== entries.length) throw new Error('Incomplete global index');
            let bytesRead = 0;
            for (let i = 0; i < entries.length; i += ENTRY_BYTES) {
                const position = Number(entries.readBigUInt64LE(i)), length = entries.readUInt32LE(i + 8);
                // Keep complete trajectories. An individual large record is returned alone.
                if (items.length && bytesRead + length > 2 * 1024 * 1024) break;
                if (length > 8 * 1024 * 1024) throw new Error('Global record exceeds storage limit');
                const bytes = Buffer.alloc(length), read = await data.read(bytes, 0, length, position);
                if (read.bytesRead !== length) throw new Error('Incomplete global record');
                items.push(JSON.parse(bytes.toString('utf8'))); bytesRead += length;
            }
        } finally { await index.close(); await data?.close(); }
    }
    return { items, total, offset, next_offset: offset + items.length < total ? offset + items.length : null };
}

function globalMapValidation(manifest, rounds) {
    const roster = new Set(manifest.players.map(p => p.player_id)), trajectoryIds = new Set(), entities = new Set();
    let points = 0;
    function check(ok, message) { if (!ok) throw new Error(message); }
    return {
        item(kind, item) {
            if (kind === 'all_player_samples') {
                check(roster.has(item.state.steamid), 'Global sample player absent from roster');
                check(item.tick === item.state.tick, 'Global sample tick mismatch');
                const round = rounds.find(r => r.round_num === item.round_num);
                check(!round || ((round.start_tick === null || item.tick >= round.start_tick) && item.tick <= round.end_tick), 'Global sample outside round');
            }
            if (kind !== 'all_trajectories') return;
            check(item.trajectory_id.length <= 128 && !trajectoryIds.has(item.trajectory_id), 'Duplicate or oversized global trajectory ID');
            trajectoryIds.add(item.trajectory_id);
            const entity = JSON.stringify([item.entity_id, item.entity_serial]);
            check(!entities.has(entity), 'Duplicate global trajectory entity'); entities.add(entity);
            check(item.points.length === item.point_ticks.length && item.points.length === item.records.length, 'Global trajectory alignment mismatch');
            const owners = new Set(); let first = Infinity, last = -Infinity;
            for (let i = 0; i < item.records.length; i++) {
                const record = item.records[i];
                check(record.tick === item.point_ticks[i] && [record.x, record.y, record.z].every((value, axis) => value === item.points[i][axis]), 'Global trajectory point mismatch');
                check(record.entity_id === item.entity_id && record.entity_serial === item.entity_serial, 'Global trajectory entity mismatch');
                first = Math.min(first, record.tick); last = Math.max(last, record.tick);
                if (record.thrower_steamid != null) owners.add(record.thrower_steamid);
            }
            check(item.start_tick === first && item.end_tick === last, 'Global trajectory tick bounds mismatch');
            const ownership = owners.size > 1 ? 'conflicting' : owners.size === 1 ? 'known' : 'unknown';
            check(item.ownership === ownership && item.thrower_player_id === (owners.size === 1 ? [...owners][0] : null), 'Global trajectory ownership mismatch');
            points += item.points.length;
        },
        finish(meta) {
            if (manifest.schema_version !== '1.2.0') return;
            const declared = manifest.export_scope.position_sampling;
            check(Object.keys(declared).every(key => declared[key] === meta.global_sampling[key]), 'Global sampling mismatch');
            check(points === manifest.export_scope.global_dataset_coverage.grenades.retained_source_rows, 'Global trajectory coverage mismatch');
        },
    };
}
module.exports = { createGlobalWriter, readGlobalPage, globalMapValidation };
