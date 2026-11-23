import { describe, it, expect } from 'vitest'
import { reviewFocus } from './review-presentation'
import type { AnalysisReport, ReplayDetails, ReplayEvent } from './contracts'
describe('relevant review moments', () => {
  it('drops generic losses and untraded deaths while keeping positive and negative openings', () => {
    const findings = [
      'eco_loss',
      'untraded_death',
      'unknown_rule',
      'eco_win',
      'anti_eco_loss',
      'trade_kill',
    ].map((rule, i) => ({
      finding_id: rule,
      rule_id: rule,
      round_num: i + 1,
      tick: 100,
      evidence_ids: [],
      observation: '事实',
      review_prompt: '回看',
    }))
    const details = { findings } as unknown as ReplayDetails
    const report = { target_player_id: 'p', report: { findings: [] } } as unknown as AnalysisReport
    const events = [1, 2].map((round) => ({
      event_id: 'k' + round,
      type: 'kill',
      round_num: round,
      tick: 100 * round,
      live_elapsed_seconds: 10,
      data: {
        record: {
          attacker_steamid: round === 1 ? 'p' : 'enemy',
          victim_steamid: round === 1 ? 'enemy' : 'p',
          attacker_side: 'terrorist',
          victim_side: 'counter-terrorist',
        },
      },
    })) as ReplayEvent[]
    const focuses = reviewFocus(report, details, events)
    expect(focuses.map((f) => f.rule).sort()).toEqual(
      ['eco_win', 'anti_eco_loss', 'trade_kill', 'opening_kill', 'opening_death'].sort(),
    )
    expect(focuses.find((f) => f.rule === 'opening_kill')).toMatchObject({
      title: '取得首杀',
      positive: true,
    })
    expect(focuses.every((f) => f.title !== '比赛事件')).toBe(true)
  })
})
