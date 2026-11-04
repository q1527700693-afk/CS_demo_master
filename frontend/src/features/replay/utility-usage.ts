import type { AnalysisReport, ReplayDetails } from './contracts'
const types = ['flashbang', 'smokegrenade', 'hegrenade', 'molotov', 'incgrenade', 'decoy']
const aliases: Record<string, string> = {
  flash: 'flashbang',
  smoke: 'smokegrenade',
  he: 'hegrenade',
  incendiary: 'incgrenade',
}
const valid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
export function utilityUsage(report: AnalysisReport, details: ReplayDetails | null) {
  const recorded = report.performance?.utility_throws || details?.performance?.utility_throws
  return {
    complete: recorded?.complete === true,
    items: types.map((weapon) => {
      const measured = recorded?.items.find((row) => row.weapon === weapon)
      if (measured && valid(measured.throws))
        return { weapon, count: measured.throws, lowerBound: !!measured.lower_bound }
      // ZIP exports may provide explicit weapon-fire counts. Damage rows have no count.
      const rows = details?.statistics.tables?.by_weapon || []
      const previous = rows.find((row) => {
        const key = row.weapon.replace(/^weapon_/, '')
        return (aliases[key] || key) === weapon && valid(row.shots)
      })
      const flash = report.report.modules.utility?.metrics?.flashes_thrown
      return {
        weapon,
        count: previous?.shots ?? (weapon === 'flashbang' && valid(flash) ? flash : null),
        lowerBound: false,
      }
    }),
  }
}
