import { describe, expect, it } from 'vitest'
import { groupPlayerSamples, playerColor, PLAYER_COLORS, utilityStyle } from './map-presentation'
import { sampleAt } from './radar-data'
import type { ReplayMapItem } from './contracts'

describe('whole-match map presentation', () => {
  it('uses the four requested colors and changes self color after switching sides', () => {
    expect(playerColor('counter-terrorist')).toBe(PLAYER_COLORS.ct)
    expect(playerColor('terrorist')).toBe(PLAYER_COLORS.t)
    expect(playerColor('counter-terrorist', true)).toBe(PLAYER_COLORS.selfCt)
    expect(playerColor('terrorist', true)).toBe(PLAYER_COLORS.selfT)
    expect(new Set(Object.values(PLAYER_COLORS)).size).toBe(5)
    expect(playerColor(null, true)).toBe(PLAYER_COLORS.unknown)
  })
  it('isolates each player clock and ignores duplicate legacy streams', () => {
    const rows: ReplayMapItem[] = [
      { kind: 'all_player_samples', tick: 100, state: { steamid: '1', health: 100 } },
      { kind: 'all_player_samples', tick: 100, state: { steamid: '2', health: 100 } },
      { kind: 'all_player_samples', tick: 132, state: { steamid: '2', health: 0 } },
      { kind: 'player_samples', tick: 132, state: { steamid: '1', health: 50 } },
    ]
    const groups = groupPlayerSamples(rows, '1', true)
    expect(groups.size).toBe(2)
    expect(sampleAt(groups.get('1')!, 132, 64)?.state?.health).toBe(100)
    expect(sampleAt(groups.get('2')!, 132, 64)?.state?.health).toBe(0)
    expect(sampleAt(groups.get('1')!, 200, 64)).toBeUndefined()
    expect(groupPlayerSamples(rows, '1', false).get('1')).toHaveLength(1)
  })
  it('gives five grenade families distinct shapes and handles parser aliases', () => {
    const styles = ['smoke', 'flashbang', 'hegrenade', 'molotov', 'decoy'].map(utilityStyle)
    expect(new Set(styles.map((s) => s.path)).size).toBe(5)
    expect(new Set(styles.map((s) => s.color)).size).toBe(5)
    expect(utilityStyle('weapon_incgrenade').kind).toBe('fire')
    expect(utilityStyle('incendiary').kind).toBe('fire')
    expect(utilityStyle('weapon_smokegrenade').kind).toBe('smoke')
    expect(utilityStyle('new_type').kind).toBe('unknown')
  })
})
