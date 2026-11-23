import { describe, it, expect, vi } from 'vitest'
import { waitForQueuedAi } from './ai-queue'
describe('queued cloud AI', () => {
  it('continues polling through queued and running until the report is complete', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ ai_status: 'not_generated', queued: true })
      .mockResolvedValueOnce({ ai_status: 'completed', summary: 'done' })
    const r = await waitForQueuedAi({ ai_status: 'queued' }, new AbortController().signal, read, 1)
    expect(r.summary).toBe('done')
    expect(read).toHaveBeenCalledTimes(2)
  })
  it('reports queued provider failures and supports cancellation', async () => {
    await expect(
      waitForQueuedAi(
        { ai_status: 'queued' },
        new AbortController().signal,
        async () => ({
          ai_status: 'not_generated',
          queued: false,
          last_error: 'upstream unavailable',
        }),
        1,
      ),
    ).rejects.toThrow('upstream unavailable')
    const c = new AbortController()
    c.abort()
    await expect(waitForQueuedAi({ ai_status: 'queued' }, c.signal, vi.fn(), 1)).rejects.toThrow(
      '取消',
    )
  })
})
