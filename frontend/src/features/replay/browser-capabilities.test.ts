import { afterEach, describe, expect, it, vi } from 'vitest'
import { canUseLocalReplayLibrary, newRequestKey } from './browser-capabilities'
import { localResource } from './local-library'

afterEach(() => vi.unstubAllGlobals())

describe('replay browser capabilities', () => {
  it('uses the local library only on a localhost page with Web Crypto', () => {
    vi.stubGlobal('window', {
      location: { hostname: '127.0.0.1' },
      crypto: { subtle: { digest: () => Promise.resolve(new ArrayBuffer(0)) } },
    })
    expect(canUseLocalReplayLibrary()).toBe(true)

    vi.stubGlobal('window', {
      location: { hostname: '120.27.206.217' },
      crypto: { subtle: { digest: () => Promise.resolve(new ArrayBuffer(0)) } },
    })
    expect(canUseLocalReplayLibrary()).toBe(false)

    vi.stubGlobal('window', {
      location: { hostname: '127.0.0.1' },
      crypto: {},
    })
    expect(canUseLocalReplayLibrary()).toBe(false)
  })

  it('creates an idempotency key when randomUUID is unavailable on public HTTP', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(0xab),
    })
    expect(newRequestKey()).toBe('ab'.repeat(16))
  })

  it('does not request local resources from a deployed server page', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('window', {
      location: { hostname: '120.27.206.217' },
      crypto: {},
    })
    vi.stubGlobal('fetch', fetch)
    expect(await localResource('/analyses/example/report')).toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
  })
})
