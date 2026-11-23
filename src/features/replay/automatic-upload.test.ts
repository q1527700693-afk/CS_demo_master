import { describe, expect, it } from 'vitest'
import { validateAnalysisFile } from './automatic-upload'
describe('one-step replay upload boundaries', () => {
  it('accepts raw demos and existing packages at their actual limits', () => {
    expect(validateAnalysisFile({ name: 'match.DEM', size: 1024 ** 3 })).toBeNull()
    expect(validateAnalysisFile({ name: 'match.zip', size: 50 * 1024 ** 2 })).toBeNull()
  })
  it('rejects unsupported, empty and oversized files before starting a service request', () => {
    expect(validateAnalysisFile({ name: 'match.rar', size: 20 })).toContain('请选择')
    expect(validateAnalysisFile({ name: 'match.dem', size: 0 })).toContain('非空')
    expect(validateAnalysisFile({ name: 'match.dem', size: 1024 ** 3 + 1 })).toContain('1 GB')
    expect(validateAnalysisFile({ name: 'match.zip', size: 50 * 1024 ** 2 + 1 })).toContain('50 MB')
  })
})
