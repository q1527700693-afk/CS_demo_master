import { describe, it, expect, vi } from 'vitest'
vi.mock('./analysis-entries', () => ({ loadAnalysisEntries: vi.fn() }))
import { loadAnalysisEntries } from './analysis-entries'
import { listReplays } from './api'

describe('overview uses the complete perspective library', () => {
  it('includes cloud and native perspectives of the same demo with their names and ADR', async () => {
    vi.mocked(loadAnalysisEntries).mockResolvedValue({
      entries: [
        {
          id: 'cloud:a',
          matchId: 'same',
          player: 'Alice',
          title: '#02 · Alice · 荒漠迷城',
          map: 'de_mirage',
          available: true,
          score: null,
          adr: 90,
          rating: null,
          updatedAt: 'internal',
        },
        {
          id: 'local-b',
          matchId: 'same',
          player: 'Bob',
          title: '#01 · Bob · 荒漠迷城',
          map: 'de_mirage',
          available: true,
          score: [13, 8],
          adr: 80,
          rating: 1.1,
          updatedAt: 'internal',
        },
      ],
      warnings: [],
    } as any)
    const page = await listReplays()
    expect(page.items.map((r) => r.id)).toEqual(['cloud:a', 'local-b'])
    expect(page.items.map((r) => r.title)).toEqual([
      '#02 · Alice · 荒漠迷城',
      '#01 · Bob · 荒漠迷城',
    ])
    expect(page.items.map((r) => r.adr)).toEqual([90, 80])
    expect(page.items.map((r) => r.scoreKnown)).toEqual([false, true])
  })
  it('keeps partial-source warnings and pending player selections visible', async () => {
    vi.mocked(loadAnalysisEntries).mockResolvedValue({
      entries: [
        {
          id: 'cloud:source',
          available: false,
          status: 'awaiting_player',
          score: null,
          adr: null,
          rating: null,
        },
      ],
      warnings: ['本机资料库暂时不可用'],
    } as any)
    const result = await listReplays()
    expect(result.items[0]?.status).toBe('uploaded')
    expect(result.warnings).toEqual(['本机资料库暂时不可用'])
  })
})
