import type { AnalysisReport, ReplayDetails, ReplayEvent } from './contracts'
import { knownSide } from './report-data'

// Product policy: short residual white flashes remain in raw evidence only.
export const MIN_EFFECTIVE_BLIND_SECONDS = 0.5
type RecordData = Record<string, unknown>
export function combatRelation(r: RecordData): 'enemy' | 'team' | 'self' | 'unknown' {
  if (r.attacker_steamid && r.attacker_steamid === r.victim_steamid) return 'self'
  const a = knownSide(r.attacker_side),
    b = knownSide(r.victim_side)
  if (!a || !b) return 'unknown'
  return a === b ? 'team' : 'enemy'
}
export function utilityKind(weapon: unknown): 'he' | 'fire' | null {
  const id = String(weapon || '')
    .toLowerCase()
    .replace(/^weapon_/, '')
  return ['hegrenade', 'he'].includes(id)
    ? 'he'
    : ['inferno', 'molotov', 'incgrenade', 'incendiary', 'fire'].includes(id)
      ? 'fire'
      : null
}
export function damageAmount(r: RecordData): number {
  return measured(r.dmg_health_real) ?? measured(r.dmg_health) ?? 0
}
function measured(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}
function damageEvidence(events: ReplayEvent[], target: string, details?: ReplayDetails | null) {
  const sides = new Map<string, ReturnType<typeof knownSide>>()
  function observe(round: number | null, id: unknown, rawSide: unknown) {
    const side = knownSide(rawSide)
    if (!side || !id || round == null) return
    const key = round + ':' + id
    sides.set(key, !sides.has(key) || sides.get(key) === side ? side : null)
  }
  for (const round of details?.rounds || []) {
    observe(round.round_num, target, round.target_side)
    observe(round.round_num, round.target_start_state?.steamid, round.target_start_state?.side)
  }
  for (const e of events) {
    const r = e.data.record
    if (!r) continue
    observe(e.round_num, r.attacker_steamid, r.attacker_side)
    observe(e.round_num, r.victim_steamid, r.victim_side)
  }
  const totals = { he: 0, fire: 0, team: 0, unknown: 0, incomplete: false }
  for (const e of events) {
    const r = e.data.record
    if (
      e.type !== 'damage' ||
      !r ||
      r.attacker_steamid !== target ||
      (e.live_elapsed_seconds ?? 0) < 0
    )
      continue
    const kind = utilityKind(r.weapon)
    if (!kind) continue
    const relation = combatRelation({
      ...r,
      attacker_side: knownSide(r.attacker_side) ?? sides.get(e.round_num + ':' + target),
      victim_side: knownSide(r.victim_side) ?? sides.get(e.round_num + ':' + r.victim_steamid),
    })
    const amount = measured(r.dmg_health_real) ?? measured(r.dmg_health)
    if (relation === 'self') continue
    if (amount == null) totals.incomplete = true
    else totals[relation === 'enemy' ? kind : relation] += amount
  }
  return totals
}
export function utilityDamage(events: ReplayEvent[], target: string) {
  const { he, fire, team } = damageEvidence(events, target)
  return { he, fire, team }
}
export function reportUtilityDamage(
  report: AnalysisReport,
  details: ReplayDetails | null,
  events: ReplayEvent[],
  completeEvents: boolean,
) {
  const facts = [report.performance, details?.performance].find(
    (f) => f?.modules?.utility && f.target_player_id === report.target_player_id,
  )
  const sources = [
    facts?.modules.utility,
    details?.statistics.modules?.utility?.metrics,
    report.report.modules.utility?.metrics,
    details?.statistics.source_player_stats,
  ]
  const metric = (key: string) =>
    sources.map((s) => measured(s?.[key])).find((n) => n != null) ?? null
  const raw = damageEvidence(events, report.target_player_id, details)
  const total = metric('utility_damage')
  const hasDamageEvents = events.some(
    (e) =>
      e.type === 'damage' &&
      e.data.record?.attacker_steamid === report.target_player_id &&
      utilityKind(e.data.record.weapon),
  )
  const covered =
    completeEvents &&
    (hasDamageEvents || !total) &&
    !details?.data_quality?.warnings?.some((w) => /(?:截断|truncat).*damages/i.test(w))
  const count = (key: string, n: number) => metric(key) ?? (covered || n > 0 ? n : null)
  return {
    he: count('he_damage', raw.he),
    fire: count('fire_damage', raw.fire),
    team: count('utility_team_damage', raw.team),
    unknown: count('utility_unclassified_damage', raw.unknown),
    total,
    partial:
      facts?.complete === false ||
      raw.incomplete ||
      (!covered &&
        ['he_damage', 'fire_damage', 'utility_team_damage'].some((k) => metric(k) == null)),
    basis: facts?.damage_basis,
  }
}

/** Correct legacy aggregates only when the complete target event stream is available. */
export function reconcileCombat(
  report: AnalysisReport,
  details: ReplayDetails | null,
  events: ReplayEvent[],
) {
  const target = report.target_player_id
  const modules = Object.fromEntries(
    Object.entries(report.report.modules).map(([key, value]) => [
      key,
      { ...value, metrics: value.metrics ? { ...value.metrics } : null },
    ]),
  )
  const utility = modules.utility?.metrics
  if (utility) {
    const blinds = events.filter(
      (e) => e.type === 'blind' && e.data.record?.attacker_steamid === target,
    )
    if (blinds.length) {
      for (const key of [
        'enemies_blinded',
        'teammates_blinded',
        'self_blinds',
        'unclassified_blinds',
        'enemy_blind_seconds',
        'team_blinding_events',
      ])
        utility[key] = 0
      const ticks = new Set<number>()
      for (const e of blinds) {
        const r = e.data.record!
        if (typeof r.duration !== 'number' || r.duration < MIN_EFFECTIVE_BLIND_SECONDS) continue
        const relation = combatRelation(r)
        const key = {
          enemy: 'enemies_blinded',
          team: 'teammates_blinded',
          self: 'self_blinds',
          unknown: 'unclassified_blinds',
        }[relation]
        utility[key] = (utility[key] || 0) + 1
        if (relation === 'enemy') utility.enemy_blind_seconds! += r.duration
        if (relation === 'team') ticks.add(e.tick)
      }
      utility.team_blinding_events = ticks.size
    }
  }
  const allKills = events.filter((e) => e.type === 'kill')
  const hostileKills = allKills.filter(
    (e) =>
      combatRelation(e.data.record || {}) === 'enemy' &&
      (e.live_elapsed_seconds == null || e.live_elapsed_seconds >= 0),
  )
  if (allKills.length && modules.basic_stats?.metrics) {
    const own = hostileKills.filter((e) => e.data.record?.attacker_steamid === target)
    modules.basic_stats.metrics.kills = own.length
    modules.basic_stats.metrics.headshot_pct = own.every(
      (e) => typeof e.data.record?.headshot === 'boolean',
    )
      ? own.length
        ? (own.filter((e) => e.data.record?.headshot === true).length / own.length) * 100
        : 0
      : null
  }
  if (!details) return { report: { ...report, report: { ...report.report, modules } }, details }
  const kills = events.filter((e) => e.type === 'kill')
  const perRound = (
    details.statistics.tables?.per_round ||
    details.rounds.map((r) => r.target_summary || { round_num: r.round_num })
  ).map((row) => {
    const round = kills.filter((e) => e.round_num === row.round_num)
    return {
      ...row,
      assists: hostileKills.filter(
        (e) =>
          e.round_num === row.round_num &&
          e.data.record?.assister_steamid === target &&
          e.data.record?.attacker_steamid !== target,
      ).length,
      kills: round.filter(
        (e) =>
          e.data.record?.attacker_steamid === target &&
          combatRelation(e.data.record) === 'enemy' &&
          (e.live_elapsed_seconds == null || e.live_elapsed_seconds >= 0),
      ).length,
      team_kills: round.filter(
        (e) =>
          e.data.record?.attacker_steamid === target && combatRelation(e.data.record) === 'team',
      ).length,
    }
  })
  // No kill events is valid for a zero-kill match, but legacy packages without raw kills retain their totals.
  if (!kills.length)
    return { report: { ...report, report: { ...report.report, modules } }, details }
  if (modules.basic_stats?.metrics)
    modules.basic_stats.metrics.kills = perRound.reduce((n, r) => n + (r.kills || 0), 0)
  const byWeapon = details.statistics.tables?.by_weapon?.map((w) => ({
    ...w,
    kills: kills.filter(
      (e) =>
        e.data.record?.attacker_steamid === target &&
        combatRelation(e.data.record) === 'enemy' &&
        (e.live_elapsed_seconds == null || e.live_elapsed_seconds >= 0) &&
        String(e.data.record?.weapon).replace(/^weapon_/, '') === w.weapon,
    ).length,
  }))
  const keyRounds = details.key_rounds.map((r) => ({
    ...r,
    reasons: r.reasons.filter(
      (reason) =>
        reason !== 'multikill' ||
        (perRound.find((s) => s.round_num === r.round_num)?.kills || 0) >= 2,
    ),
  }))
  return {
    report: { ...report, report: { ...report.report, modules } },
    details: {
      ...details,
      statistics: {
        ...details.statistics,
        tables: { ...details.statistics.tables, per_round: perRound, by_weapon: byWeapon },
      },
      rounds: details.rounds.map((r) => ({
        ...r,
        target_summary: perRound.find((s) => s.round_num === r.round_num) || r.target_summary,
      })),
      key_rounds: keyRounds,
    },
  }
}
