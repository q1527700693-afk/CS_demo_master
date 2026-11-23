import { describe, it, expect, vi } from 'vitest'
vi.mock('@/api/http', () => ({ request: vi.fn(), upload: vi.fn(), ApiError: Error }))
import {
  normalizeCloudDetails,
  normalizeCloudEvent,
  normalizeCloudRound,
  cloudKey,
  isCloudAnalysis,
  cloudRun,
  getCloudTeams,
  getCloudDust2Summary,
} from './cloud-api'
import { request } from '@/api/http'
import { analysisName } from './analysis-name'
describe('cloud compatibility boundary', () => {
  it('queries the selected team without leaking cloud namespaces or query separators', async () => {
    const signal = new AbortController().signal
    await getCloudTeams('cloud:demo/123', signal)
    expect(request).toHaveBeenLastCalledWith('/demo-analyses/demo%2F123/teams', { signal })
    await getCloudDust2Summary('cloud:demo/123', 'A & B/中文', {}, signal)
    expect(request).toHaveBeenLastCalledWith(
      '/demo-analyses/demo%2F123/dust2-summary?team=A%20%26%20B%2F%E4%B8%AD%E6%96%87&maxRounds=10&scoutRounds=6',
      { signal },
    )
  })
  it('wraps flat raw events without losing evidence or death context', () => {
    const raw = {
      event_id: 'hurt_1',
      type: 'damage',
      tick: 20,
      round_num: 1,
      data: { weapon: 'inferno', dmg_health: 10 },
    }
    expect(normalizeCloudEvent(raw).data.record).toEqual(raw.data)
    expect(
      normalizeCloudEvent({ ...raw, type: 'death_context', data: { is_reloading: true } }).data
        .is_reloading,
    ).toBe(true)
  })
  it('normalizes round stats, timing and economy while preserving unknown side', () => {
    const r = normalizeCloudRound({
      round_num: 1,
      target: { kills: 2, deaths: 1, damage: 90 },
      buy: { t: { equipment_value: 15000 } },
    })
    expect(r.target_summary).toMatchObject({ kills: 2, deaths: 1, raw_health_damage_dealt: 90 })
    expect(r.end_tick).toBeNull()
    expect(r.target_side).toBeUndefined()
  })
  it('uses only the server validated match roster when present', () => {
    const d = normalizeCloudDetails({
      source: { match_id: 'm', package_id: 'p' },
      target_player_id: '123',
      target_player: {
        steamid: '123',
        name: 'Alice',
        opponents: [{ steamid: '999', name: 'Spectator' }],
      },
      players: [{ steamid: '456', name: 'Bob' }],
      rounds: [],
      statistics: {},
    })
    expect(d.players?.map((p) => p.name)).toEqual(['Alice', 'Bob'])
  })
  it('namespaces cloud ids so they never overwrite package report caches', () => {
    expect(cloudKey('abc')).toBe('cloud:abc')
    expect(isCloudAnalysis('abc')).toBe(false)
  })
  it('names perspectives with an ordinal, player and map without match dates', () => {
    const a = analysisName('Alice', 'de_mirage', 1)
    const b = analysisName('Bob', 'de_mirage', 2)
    expect(a).toContain('Alice')
    expect(a).toMatch(/^#01 · /)
    expect(a).not.toContain('时间')
    expect(a).toContain('荒漠迷城')
    expect(b).not.toBe(a)
    expect(analysisName(null, null)).not.toContain('Invalid Date')
  })
})
