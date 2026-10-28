'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const demoAnalysis = require('../src/services/demoAnalysis');
const sample = require('./fixtures/demo-parse-sample');

const ANALYSIS_ID = '11111111-2222-3333-4444-555555555555';

function analysis(overrides = {}) {
    const payload = { ...sample.build(), ...overrides };
    return { payload, result: demoAnalysis.normalize(payload, { analysisId: ANALYSIS_ID, uploadedAt: '2026-10-28T00:00:00.000Z' }) };
}

test('normalizes a parsed demo into modules, findings and key rounds', () => {
    const { result } = analysis();
    const details = result.details;
    assert.equal(details.schema_version, 'report-1.0.0');
    assert.equal(details.analysis_version, 'demo-rules-1.0.0');
    assert.equal(details.source.kind, 'demo_file');
    assert.equal(details.source.match_id, `demo-${'a'.repeat(12)}`);
    assert.equal(details.target_player_id, sample.TARGET);
    assert.equal(details.match.map, 'de_mirage');
    assert.equal(details.match.score.terrorist, 1);
    assert.equal(details.match.score['counter-terrorist'], 1);
    assert.equal(details.match.rounds_played, 2);
    assert.equal(details.match.complete, true);
    assert.equal(details.data_quality.target_team_side, 'terrorist');

    const modules = details.statistics.modules;
    assert.equal(modules.basic_stats.metrics.kills, 2);
    assert.equal(modules.basic_stats.metrics.deaths, 1);
    assert.equal(modules.basic_stats.metrics.kd_ratio, 2);
    assert.equal(modules.basic_stats.metrics.adr, 90.5);
    assert.equal(modules.death_context.metrics.reloading_deaths, 1);
    assert.equal(modules.death_context.metrics.holding_utility_deaths, 1);
    assert.equal(modules.death_context.metrics.unused_utility_deaths, 1);
    assert.equal(modules.death_context.metrics.untraded_deaths, 1);
    assert.equal(modules.utility.metrics.self_flashes, 1);
    assert.equal(modules.utility.metrics.team_flashes, 1);
    assert.equal(modules.economy.metrics.buy_types.eco, 1);
    assert.equal(modules.movement.status, 'completed');
    assert.ok(modules.movement.metrics.mean_horizontal_speed > 0);

    const rules = new Set(details.findings.map((finding) => finding.rule_id));
    for (const rule of ['death_reloading', 'death_holding_utility', 'death_unused_utility',
        'untraded_death', 'self_flash', 'team_flash', 'opening_death', 'eco_loss']) {
        assert.ok(rules.has(rule), `missing rule ${rule}`);
    }
    assert.ok(details.key_rounds.length >= 1);
    assert.ok(details.rounds.find((round) => round.round_num === 2).target.deaths === 1);
    assert.equal(details.rounds.find((round) => round.round_num === 2).target.buy_type, 'eco');
});

test('every finding points at a real evidence id', () => {
    const { result } = analysis();
    const ids = new Set(result.evidence.map((event) => event.event_id));
    for (const finding of result.details.findings) {
        for (const evidenceId of finding.evidence_ids) {
            assert.ok(ids.has(evidenceId), `unknown evidence ${evidenceId}`);
        }
    }
    const index = Object.fromEntries(result.evidence.map((event) => [event.event_id, true]));
    assert.ok(index.kill_0001 && index.blind_0002 && index.death_0001);
});

test('the standard report satisfies report.schema.json', () => {
    const { result } = analysis();
    const report = demoAnalysis.cloudReport(result, {
        analysisId: ANALYSIS_ID,
        uploadedAt: '2026-10-28T00:00:00.000Z'
    });
    assert.equal(report.status, 'completed');
    assert.equal(report.match_id, `demo-${'a'.repeat(12)}`);
    assert.equal(report.target_player_id, sample.TARGET);
    assert.ok(Object.keys(report.report.modules).length >= 6);
    assert.ok(report.report.findings.every((finding) => finding.package_id === report.package_id));
    assert.equal(report.versions.prompt, 'not_configured');
});

test('map items follow the per-round JSONL shape used by the map view', () => {
    const { result } = analysis();
    const byRound = demoAnalysis.mapItems(result);
    assert.ok(byRound.has(1));
    const roundOne = byRound.get(1);
    const kinds = new Set(roundOne.map((item) => item.kind));
    assert.ok(kinds.has('player_samples'));
    assert.ok(kinds.has('target_keyframes'));
    assert.ok(kinds.has('trajectories'));
    const sampleItem = roundOne.find((item) => item.kind === 'player_samples');
    assert.equal(sampleItem.state.steamid, sample.TARGET);
    assert.ok(Number.isFinite(sampleItem.state.x));
    const trajectory = roundOne.find((item) => item.kind === 'trajectories');
    assert.equal(trajectory.points.length, trajectory.point_ticks.length);
    assert.equal(trajectory.ownership, 'known');
    assert.ok(byRound.get(2).some((item) => item.kind === 'unattributed_trajectories'));
});

test('artifacts are written for the HTTP layer and the AI queue', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-artifacts-'));
    try {
        const { result } = analysis();
        await demoAnalysis.writeArtifacts(directory, result, {
            analysisId: ANALYSIS_ID,
            uploadedAt: '2026-10-28T00:00:00.000Z'
        });
        for (const file of ['report.json', 'cloud-report.json', 'round-1.json', 'round-2.json',
            'map-1.jsonl', 'map-2.jsonl', 'evidence.bin', 'evidence-index.json', 'report-meta.json']) {
            assert.ok(fs.existsSync(path.join(directory, file)), `missing ${file}`);
        }
        const index = JSON.parse(fs.readFileSync(path.join(directory, 'evidence-index.json'), 'utf8'));
        assert.ok(Object.keys(index).length >= 10);
        const meta = JSON.parse(fs.readFileSync(path.join(directory, 'report-meta.json'), 'utf8'));
        assert.equal(meta.status, 'completed');
        assert.equal(meta.summary.map, 'de_mirage');
        const round = JSON.parse(fs.readFileSync(path.join(directory, 'round-2.json'), 'utf8'));
        assert.equal(round.round_num, 2);
        assert.ok(Array.isArray(round.finding_ids));
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('rejects payloads from an unknown parser contract', () => {
    const payload = { ...sample.build(), schema_version: 'demo-parse-9.9.9' };
    assert.throws(() => demoAnalysis.normalize(payload, { analysisId: ANALYSIS_ID }), /schema_version/);
    assert.throws(() => demoAnalysis.normalize({ ...sample.build(), kills: 'nope' }, { analysisId: ANALYSIS_ID }), /kills/);
});

test('a demo without round winners is reported as incomplete, not invented', () => {
    const payload = sample.build();
    payload.rounds = payload.rounds.map((round) => ({ ...round, winner_side: null }));
    const details = demoAnalysis.normalize(payload, { analysisId: ANALYSIS_ID }).details;
    assert.equal(details.match.complete, false);
    assert.equal(details.match.score.terrorist, 0);
    assert.equal(details.match.score['counter-terrorist'], 0);
});
