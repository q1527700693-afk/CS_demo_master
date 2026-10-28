import { request } from '@/api/http'
export interface ShowcaseSnapshot {
  map: string
  player_name: string
  kills: number | null
  deaths: number | null
  adr: number | null
  ai_title: string
  ai_excerpt: string
}
export interface DemoShowcase {
  enabled: boolean
  analysis_id: string | null
  mode: 'stats' | 'ai'
  snapshot: ShowcaseSnapshot | null
}
export const emptyShowcase = (): DemoShowcase => ({
  enabled: false,
  analysis_id: null,
  mode: 'stats',
  snapshot: null,
})
export function normalizeShowcase(value: unknown): DemoShowcase {
  if (!value || typeof value !== 'object') return emptyShowcase()
  const r = value as DemoShowcase,
    s = r.snapshot
  return {
    enabled: r.enabled === true,
    analysis_id: typeof r.analysis_id === 'string' ? r.analysis_id.slice(0, 128) : null,
    mode: r.mode === 'ai' ? 'ai' : 'stats',
    snapshot:
      s && typeof s === 'object'
        ? {
            map: text(s.map, 100),
            player_name: text(s.player_name, 100),
            kills: finite(s.kills),
            deaths: finite(s.deaths),
            adr: finite(s.adr),
            ai_title: text(s.ai_title, 120),
            ai_excerpt: text(s.ai_excerpt, 280),
          }
        : null,
  }
}
function text(v: unknown, n: number) {
  return typeof v === 'string' ? v.slice(0, n) : ''
}
function finite(n: unknown) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null
}
const key = (owner: string) => `csdm.showcase.v1.${owner}`
export function readShowcaseDraft(owner: string) {
  try {
    return normalizeShowcase(JSON.parse(localStorage.getItem(key(owner)) || 'null'))
  } catch {
    return emptyShowcase()
  }
}
export function saveShowcaseDraft(owner: string, value: DemoShowcase) {
  localStorage.setItem(key(owner), JSON.stringify(value))
}
export const getShowcase = async (owner: string, own: boolean) =>
  normalizeShowcase(
    await request<DemoShowcase>(`/users/${own ? 'me' : encodeURIComponent(owner)}/demo-showcase`),
  )
export const updateShowcase = async (value: DemoShowcase) =>
  normalizeShowcase(
    await request<DemoShowcase>('/users/me/demo-showcase', {
      method: 'PUT',
      body: JSON.stringify({
        enabled: value.enabled,
        analysis_id: value.analysis_id,
        mode: value.mode,
      }),
    }),
  )
