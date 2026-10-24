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
