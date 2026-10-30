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
        }) as any,
    )
    const result = await loadAnalysisEntries()
    expect(result.entries).toHaveLength(5)
    expect(new Set(result.entries.map((e) => e.id)).size).toBe(5)
    expect(result.entries.filter((e) => e.target === 'B')).toHaveLength(2)
  })
  it('retains old records when the new cloud endpoint is unavailable', async () => {
    vi.mocked(listMatches).mockResolvedValue({ items: [], total: 0 } as any)
    vi.mocked(listCloudDemos).mockRejectedValue(new Error('not deployed'))
    expect((await loadAnalysisEntries()).warnings[0]).toContain('云端 Demo')
  })
})
