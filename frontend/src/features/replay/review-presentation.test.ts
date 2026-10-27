import { describe, expect, it } from 'vitest'
import { radarAsset, worldToRadar, onRadarFloor, sampleAt, trajectoryPoints } from './radar-data'
import { reviewFocus, eventSentence, valueText, weaponName } from './review-presentation'
import type { AnalysisReport, ReplayDetails, ReplayEvent, ReplayMapItem } from './contracts'

describe('map alignment and time fidelity', () => {
  it('projects the world origin and a known Mirage position onto the fixed 1024px radar', () => {
    const map = radarAsset('de_mirage')!
    expect(worldToRadar(map, -3230, 1713)).toEqual({ x: 0, y: 0 })
    expect(worldToRadar(map, 1136, -160)).toEqual({ x: 873.2, y: 374.6 })
    expect(map.image).toBe('/maps/2000933/radars/de_mirage.png')
    expect(radarAsset('../../secret')).toBeNull()
    expect(radarAsset('workshop_unknown')).toBeNull()
  })
  it('keeps Nuke upper and lower levels separate, including unknown altitude', () => {
    const nuke = radarAsset('de_nuke')!
    expect(onRadarFloor(nuke, -495, false)).toBe(true)
    expect(onRadarFloor(nuke, -495, true)).toBe(false)
    expect(onRadarFloor(nuke, -600, true)).toBe(true)
    expect(onRadarFloor(nuke, undefined, false)).toBe(false)
  })
  it('never borrows a future or stale player sample and does not skip a death', () => {
    const samples = [
      { kind: 'player_samples', tick: 100, state: { health: 100 } },
      { kind: 'target_keyframes', tick: 164, state: { health: 0 } },
    ]
    expect(sampleAt(samples, 99, 64)).toBeUndefined()
    expect(sampleAt(samples, 140, 64)?.state?.health).toBe(100)
    expect(sampleAt(samples, 164, 64)?.state?.health).toBe(0)
    expect(sampleAt(samples, 230, 64)).toBeUndefined()
  })
  it('reveals only time-eligible points; untimed trajectories appear only when complete', () => {
    const path: ReplayMapItem = {
      kind: 'trajectories',
      start_tick: 100,
      end_tick: 300,
      points: [
        [0, 0, 0],
        [10, 10, 0],
        [20, 20, 0],
      ],
      point_ticks: [100, 200, 300],
    }
    expect(trajectoryPoints(path, 150, false)).toHaveLength(1)
    expect(trajectoryPoints(path, 99, false)).toHaveLength(0)
    expect(trajectoryPoints({ ...path, point_ticks: undefined }, 200, false)).toHaveLength(0)
    expect(trajectoryPoints({ ...path, point_ticks: undefined }, 300, false)).toHaveLength(3)
    expect(trajectoryPoints(path, 100, true)).toHaveLength(3)
  })
})
describe('review facts and localized presentation', () => {
  const report = { report: { findings: [] } } as unknown as AnalysisReport
  it('prioritizes a long team flash using measured duration and preserves specific evidence', () => {
    const events = [0.16, 4.11].map((duration, i) => ({
      event_id: `blind_${i}`,
      type: 'blind',
      round_num: 7 + i,
      tick: 100 + i,
      live_elapsed_seconds: 10 + i,
      data: { record: { duration, victim_name: '队友甲' } },
    }))
    const details = {
      findings: events.map((e) => ({
        finding_id: e.event_id,
        rule_id: 'team_flash',
        round_num: e.round_num,
        tick: e.tick,
        evidence_ids: [e.event_id],
        observation: '队友受闪',
        review_prompt: '回看',
      })),
    } as ReplayDetails
    const focuses = reviewFocus(report, details, events)
    expect(focuses[0]).toMatchObject({
      round: 8,
      tick: 101,
      priority: 4,
      observation: '队友甲 被致盲 4.11 秒',
      evidenceIds: ['blind_1'],
    })
    expect(focuses[1]!.priority).toBe(0)
    expect(focuses[0]!.action).not.toMatch(/可能|不代表|是否失误/)
  })
  it('lists actual unused inventory without inventing counts or fault judgments', () => {
    const event = {
      event_id: 'death',
      type: 'death_context',
      round_num: 9,
      tick: 500,
      data: { flashbangs: 2, smoke_grenades: 0, he_grenades: null },
    } as ReplayEvent
    const details = {
      findings: [
        {
          finding_id: 'd',
          rule_id: 'death_unused_utility',
          round_num: 9,
          tick: 500,
          evidence_ids: ['death'],
          observation: '携带道具阵亡',
        },
      ],
    } as ReplayDetails
    expect(reviewFocus(report, details, [event])[0]!.observation).toBe('阵亡时剩余：闪光弹 × 2')
  })
  it('keeps measured zero and unmeasured values distinct, and hides unknown wire names', () => {
    expect(valueText(0)).toBe('0')
    expect(valueText(null)).toBe('—')
    expect(weaponName('weapon_smokegrenade')).toBe('烟雾弹')
    expect(weaponName('future_weapon_1')).toBe('其他武器')
    expect(
      eventSentence({
        event_id: 'future',
        round_num: 1,
        tick: 1,
        type: 'new_server_event',
        data: { record: { event: 'future_event' } },
      }),
    ).toBe('比赛事件记录')
  })
})
