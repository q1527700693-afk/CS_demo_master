import { describe, expect, it, vi } from 'vitest'
import { assertDetailsIdentity, completeRoundSides, numberText, roundRows } from './report-data'
import type { AnalysisReport, ReplayDetails, RoundDetail } from './contracts'

describe('report presentation preserves backend meaning', () => {
  it('shows missing values as unknown and preserves a measured zero', () => {
    expect(numberText(null)).toBe('未知')
    expect(numberText(undefined)).toBe('未知')
    expect(numberText(NaN)).toBe('未知')
    expect(numberText(0)).toBe('0')
    expect(numberText(141.6086)).toBe('141.6')
  })
  it('tracks the target side after halftime and never infers an unknown side', () => {
    const economy = [
      { side: 'counter-terrorist', equipment_value: 20000 },
      { side: 'terrorist', equipment_value: 15000 },
    ]
    const details = {
      statistics: {},
      rounds: [
        {
          round_num: 13,
          target_side: 'terrorist',
          winner_side: 'terrorist',
          team_economy: economy,
        },
        {
          round_num: 1,
          target_side: 'counter-terrorist',
          winner_side: 'terrorist',
          team_economy: economy,
        },
        { round_num: 2, target_side: null, winner_side: 'terrorist', team_economy: economy },
      ],
    } as ReplayDetails
    const rows = roundRows(details)
    expect(rows.map((r) => r.round_num)).toEqual([1, 2, 13])
    expect(rows[0]).toMatchObject({ ownEconomy: 20000, enemyEconomy: 15000, outcome: '负' })
    expect(rows[2]).toMatchObject({ ownEconomy: 15000, enemyEconomy: 20000, outcome: '胜' })
    expect(rows[1]).toMatchObject({ ownEconomy: null, enemyEconomy: null, outcome: '未知' })
    expect(rows[1]!.stats.kills).toBeUndefined()
  })
  it('rejects details from another match, package or player before drawing', () => {
    const report = { match_id: 'm', package_id: 'p', target_player_id: 's' } as AnalysisReport
    const details = {
      source: { match_id: 'm', package_id: 'p' },
      target_player_id: 's',
    } as ReplayDetails
    expect(() => assertDetailsIdentity(details, report)).not.toThrow()
    expect(() => assertDetailsIdentity({ ...details, target_player_id: 'other' }, report)).toThrow(
      '不一致',
    )
    expect(() =>
      assertDetailsIdentity({ ...details, source: { match_id: 'other', package_id: 'p' } }, report),
    ).toThrow('不一致')
    expect(() =>
      assertDetailsIdentity({ ...details, source: { match_id: 'm', package_id: 'other' } }, report),
    ).toThrow('不一致')
  })
  it('uses recorded round-start states to recover colors across a side switch', () => {
    const details = {
      target_player_id: 'player', statistics: {},
      rounds: [
        { round_num: 1, winner_side: 'terrorist', target_start_state: { steamid: 'player', side: 'terrorist' } },
        { round_num: 13, winner_side: 'terrorist', target_start_state: { steamid: 'player', side: 'counter-terrorist' } },
        { round_num: 14, winner_side: 'terrorist', target_start_state: { steamid: 'other-player', side: 'terrorist' } },
        { round_num: 15, target_side: 'terrorist', winner_side: 'unrecorded' },
      ],
    } as ReplayDetails
    expect(roundRows(details).map(row => row.outcome)).toEqual(['胜', '负', '未知', '未知'])
    expect(roundRows(details).map(row => row.target_side)).toEqual(['terrorist', 'counter-terrorist', null, 'terrorist'])
  })
  it('fills omitted summary sides from existing round endpoints and preserves complete summaries', async () => {
    const details = {
      target_player_id: 'player', statistics: {},
      rounds: [
        { round_num: 1, winner_side: 'terrorist', target_summary: { round_num: 1, kills: 2 } },
        { round_num: 13, winner_side: 'terrorist' },
        { round_num: 14, target_side: 'terrorist', winner_side: 'counter-terrorist' },
      ],
    } as ReplayDetails
    const read = vi.fn(async (round: number) => ({ round_num: round,
      target_start_state: { steamid: 'player', side: round === 1 ? 'terrorist' : 'counter-terrorist' },
      team_economy: [{ side: 'terrorist', equipment_value: 12345 }],
    }) as RoundDetail)
    const completed = await completeRoundSides(details, read)
    expect(read.mock.calls.map(([round]) => round).sort((a, b) => a - b)).toEqual([1, 13])
    expect(roundRows(completed).map(row => row.outcome)).toEqual(['胜', '负', '负'])
    expect(roundRows(completed)[0]).toMatchObject({ ownEconomy: 12345, stats: { kills: 2 } })
    expect(details.rounds[0]!.target_side).toBeUndefined()
  })
  it('keeps missing or mismatched round artifacts unknown without rejecting the whole report', async () => {
    const details = {
      target_player_id: 'player', statistics: {},
      rounds: [1, 2, 3].map(round_num => ({ round_num, winner_side: 'terrorist' })),
    } as ReplayDetails
    const completed = await completeRoundSides(details, async round => {
      if (round === 1) throw new Error('Round unavailable')
      return { round_num: round === 2 ? 99 : round,
        target_start_state: { steamid: round === 3 ? 'other-player' : 'player', side: 'terrorist' },
      } as RoundDetail
    })
    expect(roundRows(completed).map(row => row.outcome)).toEqual(['未知', '未知', '未知'])
  })
  it('limits round recovery to four concurrent requests', async () => {
    const details = {
      target_player_id: 'player', statistics: {},
      rounds: Array.from({ length: 23 }, (_, index) => ({ round_num: index + 1, winner_side: 'terrorist' })),
    } as ReplayDetails
    let active = 0, maximum = 0
    await completeRoundSides(details, async round_num => {
      maximum = Math.max(maximum, ++active)
      await new Promise(resolve => setTimeout(resolve, 1))
      active--
      return { round_num, target_side: 'terrorist' } as RoundDetail
    })
    expect(maximum).toBe(4)
  })
})
