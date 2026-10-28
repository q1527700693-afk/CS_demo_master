import { describe, it, expect } from 'vitest'
import { normalizeAiReport } from './ai-report'
describe('AI API boundary', () => {
  it('rejects another analysis and unexpected status', () => {
    expect(() =>
      normalizeAiReport({ analysis_id: 'other', ai_status: 'completed' }, 'mine'),
    ).toThrow('不一致')
    expect(() => normalizeAiReport({ ai_status: 'bad' }, 'mine')).toThrow('状态')
  })
  it('normalizes partial model output without rendering crashes', () => {
    const r = normalizeAiReport(
      {
        ai_status: 'completed',
        improvement_areas: [{ title: '建议', evidence_ids: null, training: {} }, null],
        strengths: [null, { title: '亮点' }],
      },
      'mine',
    )
    expect(r.improvement_areas?.[0]).toMatchObject({
      evidence_ids: [],
      training: [],
      priority: 'medium',
    })
    expect(r.strengths?.[0]?.evidence_ids).toEqual([])
  })
})
