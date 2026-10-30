import { describe, it, expect, vi } from 'vitest'
vi.mock('@/app/runtime', () => ({ isDesktopRuntime: () => false }))
vi.mock('./analysis-api', () => ({
  listMatches: vi.fn(),
  getHistory: vi.fn(),
  getReportDetails: vi.fn(),
}))
vi.mock('./cloud-api', () => ({
  cloudKey: (id: string) => `cloud:${id}`,
  getCloudDetails: vi.fn(),
  listCloudDemos: vi.fn(),
}))
import { listMatches, getHistory, getReportDetails } from './analysis-api'
import { listCloudDemos, getCloudDetails } from './cloud-api'
import { loadAnalysisEntries } from './analysis-entries'
describe('independent analysis history', () => {
  it('keeps each player and each run rather than only the latest match result', async () => {
    vi.mocked(listMatches).mockResolvedValue({
      items: [
        { match_id: 'same', match: { map: 'de_mirage' }, created_at: '2026-10-30T08:00:00Z' },
      ],
      total: 1,
    } as any)
    vi.mocked(getHistory).mockResolvedValue({
      items: [
        {
          analysis_id: 'old-A',
          match_id: 'same',
          target_player_id: 'A',
          report_available: true,
          status: 'completed',
        },
        {
          analysis_id: 'old-B',
          match_id: 'same',
          target_player_id: 'B',
          report_available: true,
          status: 'completed',
        },
        {
          analysis_id: 'new-A',
          match_id: 'same',
          target_player_id: 'A',
          report_available: true,
          status: 'completed',
        },
      ],
    } as any)
    vi.mocked(getReportDetails).mockImplementation(
      async (id) =>
        ({
          target_player_id: id.endsWith('B') ? 'B' : 'A',
          target_player: { name: id.endsWith('B') ? 'Bob' : 'Alice' },
          match: { started_at: '2026-10-20T08:30:00Z' },
        }) as any,
    )
    vi.mocked(listCloudDemos).mockResolvedValue({
      items: [
        {
          demo_id: 'raw-A',
          demo_sha256: 'hash',
          target_player_id: 'A',
          map: 'de_mirage',
          created_at: '2026-10-30T08:00:00Z',
          report_available: true,
          status: 'completed',
        },
        {
          demo_id: 'raw-B',
          demo_sha256: 'hash',
          target_player_id: 'B',
          map: 'de_mirage',
          created_at: '2026-10-30T08:00:00Z',
          report_available: true,
          status: 'completed',
        },
      ],
      total: 2,
    } as any)
    vi.mocked(getCloudDetails).mockImplementation(
      async (id) =>
        ({
          target_player_id: id.endsWith('B') ? 'B' : 'A',
          target_player: { name: id.endsWith('B') ? 'Bob' : 'Alice' },
          match: { started_at: '2026-10-20T08:30:00Z' },
        }) as any,
    )
    const result = await loadAnalysisEntries()
    expect(result.entries).toHaveLength(5)
    expect(result.entries.map((e) => e.sequence)).toEqual([5, 4, 3, 2, 1])
    expect(result.entries.every((e) => /^#\d+ · /.test(e.title))).toBe(true)
    expect(
      result.entries.every((e) => !e.title.includes('2026') && !e.title.includes('时间')),
    ).toBe(true)
    expect(new Set(result.entries.map((e) => e.id)).size).toBe(5)
    expect(result.entries.filter((e) => e.target === 'B')).toHaveLength(2)
  })
  it('retains old records when the new cloud endpoint is unavailable', async () => {
    vi.mocked(listMatches).mockResolvedValue({ items: [], total: 0 } as any)
    vi.mocked(listCloudDemos).mockRejectedValue(new Error('not deployed'))
    expect((await loadAnalysisEntries()).warnings[0]).toContain('云端 Demo')
  })
  it('does not copy the latest player statistics to another perspective when details are unavailable', async () => {
    vi.mocked(listMatches).mockResolvedValue({
      items: [
        {
          match_id: 'same',
          created_at: '2026-10-30T08:00:00Z',
          match: {
            map: 'de_mirage',
            complete: true,
            teams: [
              { team_id: 'a', score: 13 },
              { team_id: 'b', score: 8 },
            ],
          },
          latest_available_analysis_id: 'latest-A',
          summary: { adr: 90, rating: 1.1, player_team_id: 'a' },
        },
      ],
      total: 1,
    } as any)
    vi.mocked(getHistory).mockResolvedValue({
      items: [
        {
          analysis_id: 'latest-A',
          match_id: 'same',
          target_player_id: 'A',
          report_available: true,
          status: 'completed',
        },
        {
          analysis_id: 'older-B',
          match_id: 'same',
          target_player_id: 'B',
          report_available: true,
          status: 'completed',
        },
      ],
    } as any)
    vi.mocked(getReportDetails).mockRejectedValue(new Error('temporarily unavailable'))
    vi.mocked(listCloudDemos).mockResolvedValue({ items: [], total: 0 } as any)
    const result = await loadAnalysisEntries()
    expect(result.entries.find((e) => e.id === 'latest-A')?.adr).toBe(90)
    expect(result.entries.find((e) => e.id === 'older-B')?.adr).toBeNull()
    expect(result.entries.find((e) => e.id === 'older-B')?.score).toBeNull()
  })
})
