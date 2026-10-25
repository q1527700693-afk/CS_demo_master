import { apiBase, mockModules } from '@/app/config'

/** Avatar URLs belong to the API host, even when the frontend is hosted elsewhere. */
export function assetUrl(path: string | null): string {
  if (!path) return ''
  if (mockModules.profile && /^data:image\/(jpeg|png|webp);base64,/.test(path)) return path
  const origin = new URL(apiBase, window.location.href).origin
  const url = new URL(path, origin)
  return ['http:', 'https:'].includes(url.protocol) ? url.href : ''
}
