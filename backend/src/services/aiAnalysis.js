'use strict';

const Ajv = require('ajv');
const { ApiError, CODES } = require('../utils/response');

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOKENS = 2_000;
const DEFAULT_PROMPT_VERSION = 'coach-1.0.0';

const RESPONSE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'improvement_areas', 'strengths', 'data_limitations'],
    properties: {
        summary: { type: 'string', minLength: 1, maxLength: 3_000 },
        improvement_areas: {
            type: 'array',
            maxItems: 12,
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['priority', 'category', 'title', 'evidence_ids', 'explanation', 'training'],
                properties: {
                    priority: { enum: ['high', 'medium', 'low'] },
                    category: {
                        enum: ['utility', 'aim', 'movement', 'decision_making', 'teamwork', 'economy', 'other']
                    },
                    title: { type: 'string', minLength: 1, maxLength: 160 },
                    evidence_ids: {
                        type: 'array',
                        minItems: 1,
                        maxItems: 20,
                        items: { type: 'string', minLength: 1, maxLength: 128 }
                    },
                    explanation: { type: 'string', minLength: 1, maxLength: 2_000 },
                    training: {
                        type: 'array',
                        minItems: 1,
                        maxItems: 10,
                        items: { type: 'string', minLength: 1, maxLength: 500 }
                    }
                }
            }
        },
        strengths: {
            type: 'array',
            maxItems: 8,
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['title', 'evidence_ids', 'explanation'],
                properties: {
                    title: { type: 'string', minLength: 1, maxLength: 160 },
                    evidence_ids: {
                        type: 'array',
                        maxItems: 20,
                        items: { type: 'string', minLength: 1, maxLength: 128 }
                    },
                    explanation: { type: 'string', minLength: 1, maxLength: 2_000 }
                }
            }
        },
        data_limitations: {
            type: 'array',
            maxItems: 10,
            items: { type: 'string', minLength: 1, maxLength: 1_000 }
        }
    }
};

const validateResponse = new Ajv({ allErrors: true, strict: false }).compile(RESPONSE_SCHEMA);

function configuration(env = process.env) {
    const timeoutMs = Number(env.AI_TIMEOUT_MS);
    const maxTokens = Number(env.AI_MAX_TOKENS);
    return {
        apiKey: String(env.DEEPSEEK_API_KEY || '').trim(),
        baseUrl: String(env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
        model: String(env.DEEPSEEK_MODEL || DEFAULT_MODEL),
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 1_000 ? timeoutMs : DEFAULT_TIMEOUT_MS,
        maxTokens: Number.isSafeInteger(maxTokens) && maxTokens > 0 ? maxTokens : DEFAULT_MAX_TOKENS,
        promptVersion: String(env.AI_PROMPT_VERSION || DEFAULT_PROMPT_VERSION)
    };
}

function isConfigured(env = process.env) {
    return Boolean(configuration(env).apiKey);
}

function notConfiguredError() {
    return new ApiError(
        CODES.AI_NOT_CONFIGURED,
        'AI analysis is not configured. Set DEEPSEEK_API_KEY on the server.',
        503
    );
}

function upstreamError(message) {
    return new ApiError(CODES.AI_UPSTREAM_ERROR, message, 502);
}

function compactModule(module) {
    if (!module || typeof module !== 'object') {
        return null;
    }
    return {
        status: module.status,
        reason: module.reason || null,
        sample_count: module.sample_count ?? null,
        metrics: module.metrics ?? null,
        evidence_ids: Array.isArray(module.evidence_ids) ? module.evidence_ids : []
    };
}

/**
 * Keep the LLM input small and factual. The complete map/event payload must
 * never be sent to the model; evidence can be fetched separately by its ID.
 */
function buildFacts(details, analysisId = null) {
    const source = details && typeof details === 'object' ? details : {};
    const modules = {};
    for (const [name, module] of Object.entries(source.statistics?.modules || {})) {
        modules[name] = compactModule(module);
    }

    return {
        analysis_id: analysisId,
        match: source.match || null,
        target_player_id: source.target_player_id || null,
        analysis_scope: source.analysis_scope || null,
        statistics: { modules },
        findings: (source.findings || []).slice(0, 80).map((finding) => ({
            finding_id: finding.finding_id,
            rule_id: finding.rule_id,
            round_num: finding.round_num,
            tick: finding.tick,
            evidence_ids: finding.evidence_ids || [],
            observation: finding.observation,
            review_prompt: finding.review_prompt
        })),
        key_rounds: (source.key_rounds || []).slice(0, 30),
        movement: source.movement || null,
        data_quality: source.data_quality || null,
        limitations: source.limitations || []
    };
}

function knownEvidenceIds(details) {
    const ids = new Set();
    const add = (values) => {
        if (!Array.isArray(values)) return;
        for (const value of values) {
            if (typeof value === 'string' && value) ids.add(value);
        }
    };

    for (const module of Object.values(details?.statistics?.modules || {})) {
        add(module?.evidence_ids);
    }
    for (const finding of details?.findings || []) {
        if (typeof finding?.finding_id === 'string') ids.add(finding.finding_id);
        add(finding?.evidence_ids);
    }
    for (const round of details?.key_rounds || []) {
        add(round?.evidence_ids);
    }
    return ids;
}

function parseModelJson(content) {
    const text = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
        return JSON.parse(text);
    } catch (error) {
        throw upstreamError('AI returned invalid JSON');
    }
}

function validateAiResult(result, details) {
    if (!validateResponse(result)) {
        const reason = validateResponse.errors?.[0]?.message || 'Invalid AI response';
        throw upstreamError(`AI response failed validation: ${reason}`);
    }

    const known = knownEvidenceIds(details);
    const areas = [...result.improvement_areas, ...result.strengths];
    for (const area of areas) {
        for (const evidenceId of area.evidence_ids || []) {
            if (!known.has(evidenceId)) {
                throw upstreamError(`AI referenced unknown evidence id: ${evidenceId}`);
            }
        }
    }
    return result;
}

const SYSTEM_PROMPT = `你是 CS2 教练。
你只能使用用户提供的结构化复盘事实，不能编造击杀、回合、时间、数值、证据或因果关系。
每个 improvement_area 必须引用输入中真实存在的 evidence_ids；找不到证据时不要生成该改进点。
优先关注可训练、可验证的行为，例如道具使用、闪光安全、死亡时未使用道具、移动射击等。
不要输出综合评分，不要声称已经观看完整 Demo。
只返回严格 JSON，结构必须是：
{
  "summary": "string",
  "improvement_areas": [
    {
      "priority": "high|medium|low",
      "category": "utility|aim|movement|decision_making|teamwork|economy|other",
      "title": "string",
      "evidence_ids": ["string"],
      "explanation": "string",
      "training": ["string"]
    }
  ],
  "strengths": [
    {
      "title": "string",
      "evidence_ids": ["string"],
      "explanation": "string"
    }
  ],
  "data_limitations": ["string"]
}`;

async function callDeepSeek(facts, config) {
    let response;
    try {
        response = await fetch(`${config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.apiKey}`
            },
            body: JSON.stringify({
                model: config.model,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: JSON.stringify(facts) }
                ],
                temperature: 0.2,
                max_tokens: config.maxTokens,
                response_format: { type: 'json_object' }
            }),
            signal: AbortSignal.timeout(config.timeoutMs)
        });
    } catch (error) {
        if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
            throw upstreamError('AI request timed out');
        }
        throw upstreamError(`AI request failed: ${String(error.message || error).slice(0, 200)}`);
    }

    const text = await response.text();
    if (!response.ok) {
        throw upstreamError(`AI upstream returned HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    let payload;
    try {
        payload = JSON.parse(text);
    } catch (error) {
        throw upstreamError('AI upstream returned invalid JSON');
    }
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
        throw upstreamError('AI upstream returned an empty response');
    }
    return parseModelJson(content);
}

async function analyze(details, options = {}) {
    const config = configuration();
    if (!config.apiKey) {
        throw notConfiguredError();
    }

    const analysisId = options.analysisId || details?.analysis_id || null;
    const facts = buildFacts(details, analysisId);
    const result = validateAiResult(await callDeepSeek(facts, config), details);
    return {
        ai_status: 'completed',
        analysis_id: analysisId,
        model: config.model,
        prompt_version: config.promptVersion,
        generated_at: new Date().toISOString(),
        ...result
    };
}

module.exports = {
    analyze,
    buildFacts,
    isConfigured,
    configuration,
    validateAiResult,
    knownEvidenceIds,
    PROMPT_VERSION: DEFAULT_PROMPT_VERSION
};
