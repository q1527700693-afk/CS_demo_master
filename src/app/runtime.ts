/** Electron identifies the packaged app even though it serves a loopback URL. */
export function isDesktopRuntime(
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
): boolean {
  return /(?:^|\s)Electron\/[\d.]+(?:\s|$)/i.test(userAgent)
}
export const demoChannel = () => (isDesktopRuntime() ? 'local' : 'cloud')
