import { describe, it, expect } from 'vitest'
import type { AnalysisReport, ReplayDetails } from './contracts'
import { utilityUsage } from './utility-usage'
const report = () =>
  ({
    report: { modules: { utility: { metrics: { flashes_thrown: 3 } } } },
  }) as unknown as AnalysisReport
describe('utility throw display', () => {
  it('uses recorded throws including zero instead of damage-only weapon rows', () => {
    const r = report()
    r.performance = {
      utility_throws: {
        complete: true,
        source: 'weapon_fire',
        items: [
          { weapon: 'hegrenade', throws: 4 },
          { weapon: 'smokegrenade', throws: 0 },
        ],
      },
    } as NonNullable<AnalysisReport['performance']>
    const d = {
      statistics: { tables: { by_weapon: [{ weapon: 'hegrenade', raw_health_damage_dealt: 80 }] } },
    } as ReplayDetails
    const result = utilityUsage(r, d)
    expect(result.items.find((x) => x.weapon === 'hegrenade')?.count).toBe(4)
    expect(result.items.find((x) => x.weapon === 'smokegrenade')?.count).toBe(0)
  })
  it('never counts damage hits or victims as throws; preserves explicit legacy counts', () => {
    const d = {
      statistics: {
        tables: {
          by_weapon: [
            { weapon: 'hegrenade', raw_health_damage_dealt: 80 },
            { weapon: 'inferno', shots: 12 },
            { weapon: 'weapon_smokegrenade', shots: 2 },
          ],
        },
      },
    } as ReplayDetails
    const result = utilityUsage(report(), d)
    expect(result.items.find((x) => x.weapon === 'hegrenade')?.count).toBeNull()
    expect(result.items.find((x) => x.weapon === 'molotov')?.count).toBeNull()
    expect(result.items.find((x) => x.weapon === 'smokegrenade')?.count).toBe(2)
    expect(result.items.find((x) => x.weapon === 'flashbang')?.count).toBe(3)
  })
})
