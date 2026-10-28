import { describe, it, expect } from 'vitest'
import { reactive } from 'vue'
import { combatRelation, reconcileCombat, utilityDamage } from './combat-facts'
import { reviewFocus } from './review-presentation'
import type { AnalysisReport, ReplayDetails, ReplayEvent } from './contracts'
function event(type: string, id: string, record: Record<string, unknown>): ReplayEvent {
  return {
    type,
    event_id: id,
    tick: 100,
    round_num: 1,
    data: {
      record: {
        attacker_steamid: 'p',
        victim_steamid: 'enemy',
        attacker_side: 'terrorist',
        victim_side: 'counter-terrorist',
        ...record,
      },
    },
  }
}
const report = () =>
  ({
    target_player_id: 'p',
    report: {
      modules: {
        basic_stats: { metrics: { kills: 2 } },
        utility: { metrics: { enemies_blinded: 3, teammates_blinded: 2 } },
      },
      findings: [],
    },
  }) as unknown as AnalysisReport
const details = () =>
  ({
    target_player_id: 'p',
    statistics: {
      tables: {
        per_round: [{ round_num: 1, kills: 2 }],
        by_weapon: [{ weapon: 'ak47', kills: 2 }],
      },
    },
    rounds: [{ round_num: 1, target_summary: { round_num: 1, kills: 2 } }],
    key_rounds: [{ round_num: 1, reasons: ['multikill'], evidence_ids: ['tk', 'enemy'] }],
    findings: [],
  }) as unknown as ReplayDetails
describe('combat facts v1.1.0', () => {
  it('separates TK from multikills in legacy summaries and accepts reactive report objects', () => {
    const events = [
      event('kill', 'enemy', { weapon: 'ak47' }),
      event('kill', 'tk', { weapon: 'ak47', victim_steamid: 'friend', victim_side: 'terrorist' }),
    ]
    const original = reactive(report())
    const result = reconcileCombat(original, details(), events)
    expect(result.report.report.modules.basic_stats?.metrics?.kills).toBe(1)
    expect(result.details?.statistics.tables?.per_round?.[0]).toMatchObject({
      kills: 1,
      team_kills: 1,
    })
    expect(result.details?.statistics.tables?.by_weapon?.[0]?.kills).toBe(1)
    expect(result.details?.key_rounds[0]?.reasons).not.toContain('multikill')
    expect(original.report.modules.basic_stats?.metrics?.kills).toBe(2)
    expect(reviewFocus(result.report, result.details, events)[0]).toMatchObject({
      rule: 'team_kill',
      priority: 5,
      evidenceIds: ['tk'],
    })
  })
  it('counts effective HE and fire enemy damage; keeps self and team damage out', () => {
    const events = [
      event('damage', 'he', { weapon: 'weapon_hegrenade', dmg_health: 130, dmg_health_real: 80 }),
      event('damage', 'fire', { weapon: 'inferno', dmg_health: 12 }),
      event('damage', 'team', { weapon: 'molotov', dmg_health: 4, victim_side: 'terrorist' }),
      event('damage', 'self', { weapon: 'inferno', dmg_health: 8, victim_steamid: 'p' }),
      event('damage', 'unknown', { weapon: 'hegrenade', dmg_health: 40, attacker_side: null }),
      event('damage', 'bad', { weapon: 'hegrenade', dmg_health: NaN }),
    ]
    expect(utilityDamage(events, 'p')).toEqual({ he: 80, fire: 12, team: 4 })
  })
  it('filters 0.16 and 0.49 second flashes, including teammate flashes, and includes the 0.5 boundary', () => {
    const events = [
      event('blind', 'tiny', { duration: 0.16 }),
      event('blind', 'small', { duration: 0.49, victim_side: 'terrorist' }),
      event('blind', 'valid', { duration: 0.5 }),
      event('blind', 'validTeam', { duration: 2, victim_side: 'terrorist' }),
    ]
    const result = reconcileCombat(report(), null, events)
    expect(result.report.report.modules.utility?.metrics).toMatchObject({
      enemies_blinded: 1,
      teammates_blinded: 1,
      enemy_blind_seconds: 0.5,
      team_blinding_events: 1,
    })
  })
  it('uses event sides after halftime and never infers missing teams', () => {
    expect(combatRelation({ attacker_side: 'counter-terrorist', victim_side: 'terrorist' })).toBe(
      'enemy',
    )
    expect(
      combatRelation({ attacker_side: 'counter-terrorist', victim_side: 'counter-terrorist' }),
    ).toBe('team')
    expect(combatRelation({ attacker_side: null, victim_side: 'terrorist' })).toBe('unknown')
  })
})
