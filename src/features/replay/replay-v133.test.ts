import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AnalysisReport, ReplayDetails, ReplayEvent, ReplayMapItem } from './contracts'
import { playerRating, playerScore, collectRoundEvents } from './report-data'
import { positionAt, radarAsset } from './radar-data'
import { reportUtilityDamage } from './combat-facts'
import metadata from './radar-metadata.json'

const details = {
  target_player_id: 'p',
  rounds: [
    { round_num: 1, target_side: 'CT', winner_side: 'CT' },
    { round_num: 13, target_side: 'T', winner_side: 'T' },
    { round_num: 25, target_side: 'CT', winner_side: 'T' },
    { round_num: 28, target_side: 'T', winner_side: 'T' },
  ],
  statistics: {
    modules: { basic_stats: { metrics: { adr: 90, rating: null } } },
    source_player_stats: { kills: 4, deaths: 3, assists: 1, kast: 75, rounds_played: 4 },
  },
} as unknown as ReplayDetails
const report = { target_player_id: 'p', report: { modules: {} } } as AnalysisReport
describe('v1.3.3 replay regressions', () => {
  it('tracks both side switches and overtime, including from the opposing perspective', () => {
    expect(playerScore(details)).toEqual([3, 1])
    expect(
      playerScore({
        ...details,
        rounds: details.rounds.map((r) => ({
          ...r,
          target_side: r.target_side === 'T' ? 'CT' : 'T',
        })),
      }),
    ).toEqual([1, 3])
    expect(playerScore({ ...details, rounds: [...details.rounds, { round_num: 29 }] })).toBeNull()
    expect(
      playerScore(
        null,
        {
          teams: [
            { team_id: 'team_terrorist', name: 'T', score: 12 },
            { team_id: 'team_counter-terrorist', name: 'CT', score: 4 },
          ],
        },
        'team_terrorist',
      ),
    ).toBeNull()
  })
  it('fills missing metrics across legacy sources, preserving zero and incomplete data', () => {
    expect(playerRating(details).value).toBeCloseTo(1.39, 2)
    expect(playerRating(details).estimated).toBe(true)
    expect(
      playerRating({ ...details, statistics: { source_player_stats: { rating: 0 } } }),
    ).toEqual({ value: 0, estimated: false })
    expect(playerRating({ ...details, statistics: {} }).value).toBeNull()
  })
  it('keeps confirmed damage when another victim has no side, and shows aggregate-only reports', () => {
    const damage = (weapon: string, victim: string, amount: number, side?: string) =>
      ({
        event_id: weapon + victim,
        tick: 20,
        type: 'damage',
        round_num: 13,
        data: {
          record: {
            attacker_steamid: 'p',
            victim_steamid: victim,
            victim_side: side,
            weapon,
            dmg_health_real: amount,
            dmg_health: 100,
          },
        },
      }) as ReplayEvent
    const events = [
      damage('hegrenade', 'x', 31, 'CT'),
      damage('inferno', 'x', 12),
      damage('molotov', 'y', 4, 'T'),
      damage('hegrenade', 'z', 6),
      damage('inferno', 'p', 20),
    ]
    expect(reportUtilityDamage(report, details, events, true)).toMatchObject({
      he: 31,
      fire: 12,
      team: 4,
      unknown: 6,
    })
    expect(reportUtilityDamage(report, details, [], false)).toMatchObject({ he: null, team: null })
    expect(
      reportUtilityDamage(
        report,
        { ...details, statistics: { source_player_stats: { utility_damage: 45 } } },
        [],
        false,
      ),
    ).toMatchObject({ total: 45, he: null })
  })
  it('retains events from readable rounds when another round is unavailable', async () => {
    const result = await collectRoundEvents(details, async (n) => {
      if (n === 13) throw Error('missing')
      return {
        round_num: n,
        start_tick: 0,
        end_tick: 100,
        finding_ids: [],
        events: [{ type: 'damage', round_num: n, tick: n, data: {} } as ReplayEvent],
      }
    })
    expect(result.missing).toEqual([13])
    expect(result.events.map((e) => e.tick)).toEqual([1, 25, 28])
  })
  it('interpolates continuous live positions without borrowing future health or crossing floors or gaps', () => {
    const sample = (tick: number, x: number, health: number, z = 10): ReplayMapItem => ({
      kind: 'all_player_samples',
      tick,
      state: { x, y: 0, z, health },
    })
    const a = sample(0, 0, 100),
      b = sample(32, 100, 75)
    expect(positionAt([a, b], 6.4, 64)?.state).toMatchObject({ x: 20, health: 100 })
    expect(positionAt([a, b], 32, 64)?.state?.health).toBe(75)
    for (const end of [
      sample(32, 100, 0),
      sample(32, 100, 90, -20),
      sample(128, 100, 90),
      sample(32, 5000, 90),
    ]) {
      expect(
        positionAt([a, end], 6.4, 64, { ...radarAsset('de_nuke')!, lowerMax: 0 })?.state?.x,
      ).toBe(0)
    }
  })
  it('ships a calibrated image for every registered overview and floor', () => {
    for (const map of Object.keys(metadata)) {
      const asset = radarAsset(map)!
      for (const image of [asset.image, asset.lowerImage].filter(Boolean))
        expect(existsSync(resolve('public', image!.slice(1))), image).toBe(true)
    }
    expect(radarAsset('workshop/123/de_cbble.vpk')).toMatchObject({
      pos_x: -3615,
      pos_y: 2712,
      scale: 4.724792,
    })
    expect(radarAsset('de_boulder')?.lowerMax).toBeCloseTo(62.757324)
  })
})
