'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const aiAnalysis = require('../src/services/aiAnalysis');

const DETAILS = {
    target_player_id: '76561198000000001',
    match: { map: 'Mirage' },
    statistics: {
        modules: {
            utility: {
                status: 'completed',
                sample_count: 14,
                metrics: { flashes_thrown: 5, self_blinds: 2, teammates_blinded: 2 },
                evidence_ids: ['flash_0']
            }
        }
    },
    findings: [
        {
            finding_id: 'death_unused_utility:death_17',
            rule_id: 'death_unused_utility',
            round_num: 3,
            tick: 15735,
            evidence_ids: ['death_17'],
            observation: '死亡时仍携带道具',
            review_prompt: '回看道具使用时机。'
        }
    ],
    key_rounds: [{ round_num: 3, reasons: ['review_candidates'], evidence_ids: ['death_17'] }],
    movement: null,
    data_quality: { warnings: [] },
    limitations: []
};

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_ENV = {
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
    DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
    AI_TIMEOUT_MS: process.env.AI_TIMEOUT_MS
};

function restoreEnv() {
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
}

test.afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    restoreEnv();
});

test('AI analysis is disabled with a clear error when the key is missing', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    await assert.rejects(
        aiAnalysis.analyze(DETAILS, { analysisId: 'analysis-1' }),
        (error) => error.code === 50300 && error.status === 503
    );
});

test('AI analysis builds compact facts and validates a provider response', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_BASE_URL = 'https://example.invalid';
    process.env.DEEPSEEK_MODEL = 'test-model';

    const modelResult = {
        summary: '道具使用时机需要改进。',
        improvement_areas: [
            {
                priority: 'high',
                category: 'utility',
                title: '死亡时未使用道具',
                evidence_ids: ['death_17'],
                explanation: '本场有多次死亡时仍携带道具。',
                training: ['交火前先规划道具用途。']
            }
        ],
        strengths: [],
        data_limitations: ['烟雾弹缺少投掷者归属。']
    };

    let requestedUrl;
    let requestedBody;
    global.fetch = async (url, options) => {
        requestedUrl = url;
        requestedBody = JSON.parse(options.body);
        return {
            ok: true,
            text: async () =>
                JSON.stringify({ choices: [{ message: { content: JSON.stringify(modelResult) } }] })
        };
    };

    const result = await aiAnalysis.analyze(DETAILS, { analysisId: 'analysis-1' });
    assert.equal(result.ai_status, 'completed');
    assert.equal(result.model, 'test-model');
    assert.equal(result.improvement_areas[0].title, '死亡时未使用道具');
    assert.equal(requestedUrl, 'https://example.invalid/chat/completions');
    assert.equal(requestedBody.model, 'test-model');
    assert.equal(requestedBody.messages[0].role, 'system');
    assert.match(requestedBody.messages[1].content, /death_17/);
    assert.doesNotMatch(requestedBody.messages[1].content, /player_samples/);
});

test('AI analysis rejects evidence IDs that do not exist in the report', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    global.fetch = async () => ({
        ok: true,
        text: async () =>
            JSON.stringify({
                choices: [
                    {
                        message: {
                            content: JSON.stringify({
                                summary: '总结',
                                improvement_areas: [
                                    {
                                        priority: 'high',
                                        category: 'utility',
                                        title: '虚构证据',
                                        evidence_ids: ['does_not_exist'],
                                        explanation: '无效引用',
                                        training: ['训练']
                                    }
                                ],
                                strengths: [],
                                data_limitations: []
                            })
                        }
                    }
                ]
            })
    });

    await assert.rejects(
        aiAnalysis.analyze(DETAILS, { analysisId: 'analysis-1' }),
        (error) => error.code === 50200
    );
});

const DEMO_DETAILS = {
    schema_version: 'report-1.0.0',
    target_player_id: '76561198000000001',
    target_selection: 'auto_top_fragger',
    source: {
        kind: 'demo_file',
        match_id: 'demo-abcdef123456',
        demo: { file_name: 'match.dem', size_bytes: 100, sha256: 'b'.repeat(64) }
    },
    match: { map: 'de_mirage', score: { terrorist: 8, 'counter-terrorist': 2 }, rounds_played: 10, complete: true, tick_rate: 64 },
    target_player: { name: 'Tester', team: 'terrorist', teammates: [{ name: 'Mate' }] },
    statistics: {
        modules: {
            death_context: { status: 'completed', sample_count: 5, metrics: { deaths: 5 }, evidence_ids: ['death_0001'] },
            economy: { status: 'completed', sample_count: 10, metrics: { buy_types: { eco: 2 } }, evidence_ids: [] }
        }
    },
    findings: [
        {
            finding_id: 'death_unused_utility:death_0001',
            rule_id: 'death_unused_utility',
            round_num: 3,
            evidence_ids: ['death_0001'],
            observation: '死亡时仍携带道具'
        }
    ],
    rounds: [
        { round_num: 3, winner_side: 'terrorist', buy: { ct: { buy_type: 'eco' }, t: { buy_type: 'full' } }, target: { kills: 2, deaths: 1, damage: 120, buy_type: 'full', equipment_value: 9000 } }
    ],
    key_rounds: [{ round_num: 3, reasons: ['review_candidates'], evidence_ids: ['death_0001'] }],
    movement: { status: 'observed', measured_intervals: 100 },
    data_quality: { warnings: [] },
    limitations: ['仅来自 Demo 解析']
};

test('demo facts stay compact and expose the demo context the coach needs', () => {
    const facts = aiAnalysis.buildDemoFacts(DEMO_DETAILS, 'analysis-9');
    assert.equal(facts.kind, 'demo_file');
    assert.equal(facts.match.map, 'de_mirage');
    assert.equal(facts.match.score.terrorist, 8);
    assert.equal(facts.rounds[0].buy.ct, 'eco');
    assert.equal(facts.rounds[0].target.damage, 120);
    assert.equal(facts.findings[0].evidence_ids[0], 'death_0001');
    const text = JSON.stringify(facts);
    assert.doesNotMatch(text, /player_samples/);
    assert.doesNotMatch(text, /points/);
});

test('demo coaching cites demo evidence and reports its source', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    process.env.DEEPSEEK_BASE_URL = 'https://example.invalid';
    let requestedBody;
    global.fetch = async (url, options) => {
        requestedBody = JSON.parse(options.body);
        return {
            ok: true,
            text: async () => JSON.stringify({
                choices: [{
                    message: {
                        content: JSON.stringify({
                            summary: '经济局与道具时机需要回看。',
                            improvement_areas: [{
                                priority: 'high',
                                category: 'economy',
                                title: '经济局目标不清晰',
                                evidence_ids: ['hurt_0002'],
                                explanation: '第 3 回合 eco 失利。',
                                training: ['提前约定 eco 目标']
                            }],
                            strengths: [],
                            data_limitations: ['缺少可见性']
                        })
                    }
                }]
            })
        };
    };

    const result = await aiAnalysis.analyzeDemo(DEMO_DETAILS, {
        analysisId: 'analysis-9',
        evidenceIds: ['hurt_0002']
    });
    assert.equal(result.ai_status, 'completed');
    assert.equal(result.source.kind, 'demo_file');
    assert.equal(result.source.demo_sha256, 'b'.repeat(64));
    assert.equal(result.prompt_version, 'coach-1.0.0-demo');
    assert.match(requestedBody.messages[0].content, /Demo/);
    assert.match(requestedBody.messages[1].content, /de_mirage/);
});

test('demo coaching rejects evidence outside the parsed demo', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    global.fetch = async () => ({
        ok: true,
        text: async () => JSON.stringify({
            choices: [{
                message: {
                    content: JSON.stringify({
                        summary: 'x',
                        improvement_areas: [{
                            priority: 'low', category: 'aim', title: 'x',
                            evidence_ids: ['kill_9999'], explanation: 'x', training: ['x']
                        }],
                        strengths: [], data_limitations: []
                    })
                }
            }]
        })
    });
    await assert.rejects(
        aiAnalysis.analyzeDemo(DEMO_DETAILS, { analysisId: 'analysis-9', evidenceIds: ['hurt_0002'] }),
        (error) => error.code === 50200 && /unknown evidence id/.test(error.message)
    );
});
