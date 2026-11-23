import { describe, expect, it, vi } from 'vitest'

describe('initial page readiness', () => {
  it('waits for initial data and tasks registered while that data loads', async () => {
    vi.resetModules()
    const { trackStartup, waitForStartupTasks } = await import('./startup-tasks')
    let finishData!: () => void
    let finishNested!: () => void
    trackStartup(
      new Promise<void>((resolve) => {
        finishData = resolve
      }),
    )
    const ready = vi.fn()
    const waiting = waitForStartupTasks().then(ready)
    await Promise.resolve()
    expect(ready).not.toHaveBeenCalled()
    trackStartup(
      new Promise<void>((resolve) => {
        finishNested = resolve
      }),
    )
    finishData()
    await Promise.resolve()
    expect(ready).not.toHaveBeenCalled()
    finishNested()
    await waiting
    expect(ready).toHaveBeenCalledOnce()
  })

  it('allows a handled request error to show its page error state, and ignores later navigation', async () => {
    vi.resetModules()
    const { trackStartup, waitForStartupTasks } = await import('./startup-tasks')
    const failed = trackStartup(Promise.reject(new Error('offline')))
    await expect(failed).rejects.toThrow('offline')
    await waitForStartupTasks()
    trackStartup(new Promise<void>(() => {}))
    await waitForStartupTasks()
  })
})
