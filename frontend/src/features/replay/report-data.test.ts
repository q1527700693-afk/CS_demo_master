import { describe, expect, it } from 'vitest'
import { assertDetailsIdentity, numberText, roundRows } from './report-data'
import type { AnalysisReport, ReplayDetails } from './contracts'

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
})
