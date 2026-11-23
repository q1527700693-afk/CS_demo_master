import { describe, expect, it } from 'vitest'
import { MAX_PACKAGE_SIZE, terminalStatus, validatePackage } from './validation'
describe('local parsing package upload boundaries', () => {
  it('accepts ZIP names regardless of case, including at the size limit', () => {
    expect(validatePackage({ name: 'match.ZIP', size: MAX_PACKAGE_SIZE })).toBeNull()
  })
  it('rejects raw demos, empty packages, and oversized files before upload', () => {
    expect(validatePackage({ name: 'match.dem', size: 100 })).toContain('本地解析')
    expect(validatePackage({ name: 'empty.zip', size: 0 })).toContain('为空')
    expect(validatePackage({ name: 'large.zip', size: MAX_PACKAGE_SIZE + 1 })).toContain('50 MB')
  })
  it('stops polling on failure as well as success', () => {
    expect(terminalStatus('completed')).toBe(true)
    expect(terminalStatus('partial')).toBe(true)
    expect(terminalStatus('failed')).toBe(true)
    expect(terminalStatus('analyzing')).toBe(false)
  })
})
