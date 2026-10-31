import type { AiCoachReport, AiImprovementArea, AiStrength } from './contracts'

const text = (value: unknown, limit = 4000) =>
  typeof value === 'string' ? value.slice(0, limit) : ''
const strings = (value: unknown) =>
  Array.isArray(value)
    ? value
        .filter((v) => typeof v === 'string')
        .slice(0, 50)
        .map((v) => text(v))
    : []
const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((v) => v && typeof v === 'object').slice(0, 50) : []
export function normalizeAiReport(value: unknown, analysisId: string): AiCoachReport {
  if (!value || typeof value !== 'object') throw new Error('AI 报告格式无效')
  const r = value as Record<string, unknown>
  if (r.analysis_id && r.analysis_id !== analysisId) throw new Error('AI 报告与当前分析不一致')
  if (!['completed', 'not_generated', 'not_configured'].includes(String(r.ai_status)))
    throw new Error('AI 报告状态无效，请稍后重试')
  const strengths: AiStrength[] = records(r.strengths).map((v) => ({
    title: text(v.title, 200),
    explanation: text(v.explanation),
    evidence_ids: strings(v.evidence_ids),
  }))
  const areas: AiImprovementArea[] = records(r.improvement_areas).map((v) => ({
    title: text(v.title, 200),
    explanation: text(v.explanation),
    evidence_ids: strings(v.evidence_ids),
    training: strings(v.training),
    category: text(v.category, 100),
    priority: ['high', 'medium', 'low'].includes(String(v.priority))
      ? (v.priority as AiImprovementArea['priority'])
      : 'medium',
  }))
  return {
    ai_status: r.ai_status as AiCoachReport['ai_status'],
    analysis_id: analysisId,
    summary: text(r.summary),
    model: text(r.model, 100),
    prompt_version: text(r.prompt_version, 100),
    generated_at: text(r.generated_at, 100),
    improvement_areas: areas,
    strengths,
    data_limitations: strings(r.data_limitations),
  }
}
