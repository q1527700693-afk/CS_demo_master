import type { AnalysisReport, ReplayDetails, ReplayEvent } from './contracts'

// Product policy: short residual white flashes remain in raw evidence only.
export const MIN_EFFECTIVE_BLIND_SECONDS = 0.5
type RecordData = Record<string, unknown>
export function combatRelation(r: RecordData): 'enemy' | 'team' | 'self' | 'unknown' {
  if (r.attacker_steamid && r.attacker_steamid === r.victim_steamid) return 'self'
  const sides = ['terrorist', 'counter-terrorist']
  if (!sides.includes(String(r.attacker_side)) || !sides.includes(String(r.victim_side)))
    return 'unknown'
  return r.attacker_side === r.victim_side ? 'team' : 'enemy'
}
export function utilityKind(weapon: unknown): 'he' | 'fire' | null {
  const id = String(weapon || '').replace(/^weapon_/, '')
  return ['hegrenade', 'he'].includes(id)
    ? 'he'
    : ['inferno', 'molotov', 'incgrenade', 'incendiary', 'fire'].includes(id)
      ? 'fire'
      : null
}
export function damageAmount(r: RecordData): number {
  const value = Number(r.dmg_health_real ?? r.dmg_health)
  return Number.isFinite(value) ? Math.max(0, value) : 0
}
export function utilityDamage(events: ReplayEvent[], target: string) {
  const totals = { he: 0, fire: 0, team: 0 }
  for (const e of events) {
    const r = e.data.record
    if (e.type !== 'damage' || !r || r.attacker_steamid !== target) continue
    const kind = utilityKind(r.weapon)
    if (!kind) continue
    if (combatRelation(r) === 'enemy') totals[kind] += damageAmount(r)
    if (combatRelation(r) === 'team') totals.team += damageAmount(r)
  }
  return totals
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
