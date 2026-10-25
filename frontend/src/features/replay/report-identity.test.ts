import { describe, expect, it } from 'vitest'
import sample from '../../../docs/analysis-handoff/sample-report.json'
import { assertReportIdentity } from './report-identity'

describe('report association', () => {
  it('accepts the requested report and perspective', () => {
    expect(() => assertReportIdentity(sample, sample)).not.toThrow()
  })
  for (const key of ['match_id', 'package_id', 'target_player_id', 'analysis_id'] as const) {
    it(`rejects a mismatched ${key}`, () => {
      expect(() => assertReportIdentity({ ...sample, [key]: 'other' }, sample)).toThrow('不一致')
    })
  }
  it('rejects unsupported versions before caching', () => {
    expect(() =>
      assertReportIdentity({ ...sample, report_schema_version: '2.0.0' }, sample),
    ).toThrow('版本')
  })
})
