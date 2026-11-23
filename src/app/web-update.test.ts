import { describe, expect, it, vi } from 'vitest'
import { hasWebUpdate } from './web-update'

describe('web release checks', () => {
  const serve = (body: unknown, status = 200) =>
    vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }))

  it('detects a new build even when the product version stays at 1.3.1', async () => {
    const request = serve({ version: '1.3.1', revision: 'web-new' })
    expect(await hasWebUpdate('web-old', request)).toBe(true)
    expect(request.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store', credentials: 'omit' })
  })

  it('does not prompt again for the current build', async () => {
    expect(await hasWebUpdate('web-current', serve({ version: '1.3.1', revision: 'web-current' }))).toBe(false)
  })

  it('does not treat errors, an HTML fallback, or an incomplete marker as an update', async () => {
    for (const request of [
      serve({ version: '1.3.1', revision: 'web-new' }, 503),
      serve({ version: '1.3.1' }),
      serve({ version: '1.3.1', revision: '' }),
      vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>login</html>')),
      vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')),
    ]) {
      expect(await hasWebUpdate('web-current', request)).toBe(false)
    }
  })

  it('does not poll in development or without a built entry marker', async () => {
    const request = serve({ version: '1.3.1', revision: 'web-new' })
    expect(await hasWebUpdate('', request)).toBe(false)
    expect(request).not.toHaveBeenCalled()
  })
})
