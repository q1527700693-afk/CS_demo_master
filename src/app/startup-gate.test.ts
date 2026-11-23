import { describe, expect, it, vi } from 'vitest'
import { StartupGate } from './startup-gate'

describe('startup minimum display', () => {
  it('keeps a quickly loaded app covered only until the minimum display has passed', () => {
    const enter = vi.fn()
    const gate = new StartupGate(enter)
    gate.appReady()
    expect(enter).not.toHaveBeenCalled()
    gate.minimumElapsed()
    expect(enter).toHaveBeenCalledTimes(1)
  })

  it('enters immediately when a slow app becomes ready after the minimum display', () => {
    const enter = vi.fn()
    const gate = new StartupGate(enter)
    gate.minimumElapsed()
    gate.minimumElapsed()
    expect(enter).not.toHaveBeenCalled()
    gate.appReady()
    expect(enter).toHaveBeenCalledTimes(1)
    gate.minimumElapsed()
    gate.appReady()
    expect(enter).toHaveBeenCalledTimes(1)
  })
})
