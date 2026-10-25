import type { ReplayMapItem } from './contracts'

export const PLAYER_COLORS = {
  ct: '#59a9ff',
  t: '#ffd34e',
  selfCt: '#4ee39a',
  selfT: '#ff626b',
  unknown: '#aab6c2',
}
export function playerColor(side: string | null | undefined, self = false) {
  const s = side?.toLowerCase()
  if (s === 'counter-terrorist' || s === 'ct') return self ? PLAYER_COLORS.selfCt : PLAYER_COLORS.ct
  if (s === 'terrorist' || s === 't') return self ? PLAYER_COLORS.selfT : PLAYER_COLORS.t
  return PLAYER_COLORS.unknown
}
export const UTILITY_STYLES = {
  smoke: {
    label: '烟雾弹',
    color: '#c5d6e8',
    path: 'M-8 5C-15 5-14-5-7-5C-7-14 6-14 8-5C16-5 16 6 8 6H-8Z',
  },
  flash: { label: '闪光弹', color: '#fff5ad', path: 'M2-13-8 1H-1L-3 13 9-3H2Z' },
  he: {
    label: '高爆手雷',
    color: '#ff83d1',
    path: 'M0-13 4-6 12-8 8 0 13 6 4 7 0 14-4 7-13 6-8 0-12-8-4-6Z',
  },
  fire: {
    label: '燃烧弹',
    color: '#ff954a',
    path: 'M0-14C4-5 12-3 10 5C8 15-9 15-10 5C-12-1-5-4-4-10L0-4Z',
  },
  decoy: {
    label: '诱饵弹',
    color: '#b69aff',
    path: 'M-11-4H-6L1-10V10L-6 4H-11ZM5-5Q11 0 5 5M8-9Q18 0 8 9',
  },
  unknown: { label: '未分类道具', color: '#9fafbd', path: 'M0-11 11 0 0 11-11 0ZM0-6V2M0 5V7' },
} as const
export function utilityStyle(type?: string) {
  const t = (type || '').toLowerCase().replace(/^weapon_/, '')
  const kind = /smoke/.test(t)
    ? 'smoke'
    : /flash/.test(t)
      ? 'flash'
      : /molotov|fire|inc/.test(t)
        ? 'fire'
        : /decoy/.test(t)
          ? 'decoy'
          : /^(he|hegrenade|he_grenade|frag|grenade)$/.test(t)
            ? 'he'
            : 'unknown'
  return { kind, ...UTILITY_STYLES[kind] }
}
// Never run sampleAt over an interleaved multi-player stream.
export function groupPlayerSamples(items: ReplayMapItem[], targetId: string, global: boolean) {
  const groups = new Map<string, ReplayMapItem[]>()
  for (const item of items) {
    if (
      !(global
        ? item.kind === 'all_player_samples'
        : ['player_samples', 'target_keyframes'].includes(item.kind))
    )
      continue
    const id = item.state?.steamid || (global ? null : targetId)
    if (!id) continue
    const list = groups.get(id) || []
    list.push(item)
    groups.set(id, list)
  }
  for (const list of groups.values()) list.sort((a, b) => (a.tick ?? 0) - (b.tick ?? 0))
  return groups
}
