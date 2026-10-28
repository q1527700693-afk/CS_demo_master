/** The /local proxy belongs to the desktop development server, not a deployed site. */
export function canUseLocalReplayLibrary(): boolean {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname
  return (
    (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') &&
    typeof window.crypto?.subtle?.digest === 'function'
  )
}

/** Web Crypto randomUUID is unavailable on public HTTP, but getRandomValues remains available. */
export function newRequestKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
