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

function knownEvidenceIds(details, extra = []) {
    const ids = new Set();
    const add = (values) => {
        if (!Array.isArray(values)) return;
        for (const value of values) {
            if (typeof value === 'string' && value) ids.add(value);
        }
    };

    add(extra);
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

function normalizeAiResult(result) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
    const normalized = JSON.parse(JSON.stringify(result));
    normalized.improvement_areas = Array.isArray(normalized.improvement_areas)
        ? normalized.improvement_areas.slice(0, 12).map((area) => ({
            ...area,
            evidence_ids: Array.isArray(area.evidence_ids) ? [...new Set(area.evidence_ids)].slice(0, 20) : area.evidence_ids,
            training: Array.isArray(area.training) ? area.training.slice(0, 10) : area.training
        }))
        : normalized.improvement_areas;
    normalized.strengths = Array.isArray(normalized.strengths)
        ? normalized.strengths.slice(0, 8).map((strength) => ({
            ...strength,
            evidence_ids: Array.isArray(strength.evidence_ids)
                ? [...new Set(strength.evidence_ids)].slice(0, 20)
                : strength.evidence_ids
        }))
        : normalized.strengths;
    normalized.data_limitations = Array.isArray(normalized.data_limitations)
        ? normalized.data_limitations.slice(0, 10)
        : normalized.data_limitations;
    return normalized;
}

function validateAiResult(result, details, allowedEvidenceIds = null) {
    const normalized = normalizeAiResult(result);
    if (!validateResponse(normalized)) {
        const reason = validateResponse.errors?.[0]?.message || 'Invalid AI response';
        throw upstreamError(`AI response failed validation: ${reason}`);
    }

    const known = allowedEvidenceIds instanceof Set
        ? allowedEvidenceIds
        : knownEvidenceIds(details, allowedEvidenceIds || []);
    const areas = [...normalized.improvement_areas, ...normalized.strengths];
    for (const area of areas) {
        for (const evidenceId of area.evidence_ids || []) {
            if (!known.has(evidenceId)) {
                throw upstreamError(`AI referenced unknown evidence id: ${evidenceId}`);
            }
        }
    }
    return normalized;
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

async function callDeepSeek(facts, config, systemPrompt = SYSTEM_PROMPT) {
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
                    { role: 'system', content: systemPrompt },
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
    const facts = options.facts || buildFacts(details, analysisId);
    const allowed = options.allowedEvidenceIds
        ? knownEvidenceIds(details, options.allowedEvidenceIds)
        : null;
    const result = validateAiResult(
        await callDeepSeek(facts, config, options.systemPrompt || SYSTEM_PROMPT),
        details,
        allowed
    );
    return {
        ai_status: 'completed',
        analysis_id: analysisId,
        model: config.model,
        prompt_version: config.promptVersion,
        generated_at: new Date().toISOString(),
        ...result
    };
}

/**
 * Compact facts for a demo-file analysis. The model never receives raw points,
 * the full event stream or the demo binary, only what the rules measured.
 */
function buildDemoFacts(details, analysisId = null) {
    const source = details && typeof details === 'object' ? details : {};
    const modules = {};
    for (const [name, module] of Object.entries(source.statistics?.modules || {})) {
        modules[name] = compactModule(module);
    }
    const rounds = (source.rounds || []).slice(0, 60).map((round) => ({
        round_num: round.round_num,
        winner_side: round.winner_side ?? null,
        buy: round.buy ? {
            ct: round.buy.ct?.buy_type ?? null,
            t: round.buy.t?.buy_type ?? null
        } : null,
        target: {
            kills: round.target?.kills ?? 0,
            deaths: round.target?.deaths ?? 0,
            damage: round.target?.damage ?? 0,
            buy_type: round.target?.buy_type ?? null,
            equipment_value: round.target?.equipment_value ?? null
        }
    }));
    return {
        kind: 'demo_file',
        analysis_id: analysisId,
        match: source.match ? {
            map: source.match.map,
            score: source.match.score,
            rounds_played: source.match.rounds_played,
            complete: source.match.complete,
            tick_rate: source.match.tick_rate
        } : null,
        target: {
            player_id: source.target_player_id || null,
            name: source.target_player?.name ?? null,
            team: source.target_player?.team ?? null,
            selection: source.target_selection || null,
            teammates: (source.target_player?.teammates || []).map((player) => player.name)
        },
        modules,
        rounds,
        findings: (source.findings || []).slice(0, 80).map((finding) => ({
            finding_id: finding.finding_id,
            rule_id: finding.rule_id,
            round_num: finding.round_num,
            evidence_ids: finding.evidence_ids || [],
            observation: finding.observation
        })),
        key_rounds: (source.key_rounds || []).slice(0, 20),
        weapon_highlights: (source.weapon_highlights || []).slice(0, 20).map((item) => ({
            player_name: item.player_name,
            team_clan_name: item.team_clan_name,
            weapon: item.weapon,
            weapon_label: item.weapon_label,
            category: item.category,
            cost: item.cost,
            kills: item.kills,
            headshots: item.headshots,
            first_bloods: item.first_bloods,
            economy_kills: item.economy_kills,
            low_cost_kills: item.low_cost_kills,
            multi_kill_rounds: item.multi_kill_rounds,
            rounds: item.rounds,
            reason: item.reason,
            evidence_ids: item.evidence_ids
        })),
        weapon_profiles: (source.weapon_profiles || []).slice(0, 10).map((item) => ({
            name: item.name,
            team_clan_name: item.team_clan_name,
            side: item.side,
            top_weapons: (item.top_weapons || []).slice(0, 3)
        })),
        player_weapon_impact: (source.player_weapon_impact || []).slice(0, 10).map((item) => ({
            name: item.name,
            team_clan_name: item.team_clan_name,
            side: item.side,
            kills: item.kills,
            first_bloods: item.first_bloods,
            economy_kills: item.economy_kills,
            weapon_impact_score: item.weapon_impact_score,
            top_weapons: (item.top_weapons || []).slice(0, 3)
        })),
        weapon_transitions: (source.weapon_transitions || []).slice(0, 20).map((item) => ({
            player_name: item.player_name,
            round_num: item.round_num,
            from_label: item.from_label,
            to_label: item.to_label,
            confidence: item.confidence,
            evidence_hint: 'sampled_weapon_change'
        })),
        movement: source.movement || null,
        data_quality: source.data_quality || null,
        limitations: source.limitations || []
    };
}

const DEMO_SYSTEM_PROMPT = `你是 CS2 教练，正在解读一份从用户上传的 Demo 文件自动解析出的比赛数据。
你只能使用输入 JSON 中出现的回合、数值、玩家、经济和证据 ID，不能编造击杀、时间、位置、经济或因果关系。
你不曾观看比赛画面，只能依据解析数据推断；不要声称看过 Demo 或视频，不要输出综合评分。
每条 improvement_area 和 strength 至少引用一个输入中真实存在的 evidence_ids；如果某个想法在输入里找不到证据，就不要输出该条。
优先给出可训练、可验证的行为建议：道具有无使用、死亡位置、经济局目标、首杀/首死的对枪选择、换人配合。
weapon_highlights 是规则引擎提取的候选亮点，不是完整武器统计：重点点评 R8、沙鹰、双枪、SMG、霰弹枪等冷门或低成本武器在 eco/半起局的首杀、多杀、残局和 timing 击杀；普通 AK/M4/AWP 只在确实影响回合时简短提一句，不要因为使用普通长枪就夸大。所有武器击杀描述必须引用对应 evidence_ids；样本不足时明确写“样本较少”，不能推断玩家长期风格。weapon_transitions 只是快照采样到的武器变化，不一定是拾取或主动换枪，不能当成确定事件。
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

/**
 * AI coaching for a demo-file analysis. Evidence is the union of the report's
 * own ids and the ids the caller knows from the evidence index, so the model can
 * cite any measured event of this demo and nothing else.
 */
async function analyzeDemo(details, options = {}) {
    const config = configuration();
    if (!config.apiKey) throw notConfiguredError();
    const analysisId = options.analysisId || details?.source?.match_id || null;
    const facts = options.facts || buildDemoFacts(details, analysisId);
    const allowed = knownEvidenceIds(details, options.evidenceIds || []);
    const result = validateAiResult(await callDeepSeek(facts, config, DEMO_SYSTEM_PROMPT), details, allowed);
    return {
        ai_status: 'completed',
        analysis_id: analysisId,
        source: {
            kind: 'demo_file',
            match_id: details?.source?.match_id || null,
            demo_sha256: details?.source?.demo?.sha256 || null,
            target_player_id: details?.target_player_id || null
        },
        model: config.model,
        prompt_version: `${config.promptVersion}-demo`,
        generated_at: new Date().toISOString(),
        ...result
    };
}

module.exports = {
    analyze,
    analyzeDemo,
    buildFacts,
    buildDemoFacts,
    isConfigured,
    configuration,
    validateAiResult,
    knownEvidenceIds,
    PROMPT_VERSION: DEFAULT_PROMPT_VERSION,
    SYSTEM_PROMPT,
    DEMO_SYSTEM_PROMPT
};
