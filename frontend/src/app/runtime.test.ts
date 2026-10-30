import { describe, it, expect } from 'vitest'
import { isDesktopRuntime } from './runtime'
describe('Demo channel detection', () => {
  it('recognizes the Electron app served on loopback', () =>
    expect(isDesktopRuntime('Mozilla/5.0 Chrome/152.0.0.0 Electron/45.0.0 Safari/537.36')).toBe(
      true,
    ))
  it('keeps regular browsers in cloud mode, including localhost development', () => {
    expect(isDesktopRuntime('Mozilla/5.0 Chrome/152.0.0.0 Safari/537.36')).toBe(false)
    expect(isDesktopRuntime('')).toBe(false)
  })
})
