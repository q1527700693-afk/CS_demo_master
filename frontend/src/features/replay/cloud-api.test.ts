import { describe, it, expect, vi } from 'vitest'
vi.mock('@/api/http', () => ({ request: vi.fn(), upload: vi.fn(), ApiError: Error }))
import {
  normalizeCloudDetails,
  normalizeCloudEvent,
  normalizeCloudRound,
  cloudKey,
  isCloudAnalysis,
  cloudRun,
} from './cloud-api'
import { analysisName } from './analysis-name'
describe('cloud compatibility boundary', () => {
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
  it('names each perspective with player, timestamp, map and a distinct analysis id', () => {
    const a = analysisName('Alice', '2026-10-30T08:04:03Z', 'de_mirage', 'abcdef01')
    const b = analysisName('Bob', '2026-10-30T08:04:03Z', 'de_mirage', 'abcdef02')
    expect(a).toContain('Alice')
    expect(a).toContain('2026')
    expect(a).toContain('荒漠迷城')
    expect(b).not.toBe(a)
    expect(analysisName(null, 'bad-date', null)).not.toContain('Invalid Date')
  })
})
