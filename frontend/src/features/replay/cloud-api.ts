import { ApiError, request, upload } from '@/api/http'
import type { Page } from '@/types'
import type {
  AnalysisReport,
  ReplayDetails,
  ReplayEvent,
  ReplayMapItem,
  RoundDetail,
  AnalysisRun,
} from './contracts'
// The new backend uses flat events and different round/module field names.
// Adapt those differences once, before any existing report component sees them.
type Wire = Record<string, any>
export const isCloudAnalysis = (id: string) => id.startsWith('cloud:')
export const cloudId = (id: string) => id.replace(/^cloud:/, '')
export const cloudKey = (id: string) => `cloud:${cloudId(id)}`
export const cloudPath = (id: string) => `/demo-analyses/${encodeURIComponent(cloudId(id))}`
export interface CloudDemo {
  demo_id: string
  status: string
  stage: string
  progress: number | null
  message: string
  report_available: boolean
  roster_available?: boolean
  started_at?: string | null
  target_player_id: string | null
  file_name: string | null
  demo_sha256?: string | null
  map: string | null
  created_at: string
  analyzed_at?: string | null
  ai_status: string
  summary?: {
    target_player_id?: string
    target_player_name?: string
    map?: string
    adr?: number | null
    started_at?: string | null
  }
}
export interface ParserStatus {
  available: boolean
  capabilities?: string[]
  max_size_bytes: number
  reason?: string
  ai?: { configured: boolean; auto: boolean; model: string }
}
export const cloudParserStatus = (signal?: AbortSignal) =>
  request<ParserStatus>('/demo-analyses/parser', { signal })
export async function uploadCloudDemo(
  file: File,
  target: string,
  progress: (n: number | null) => void,
  signal?: AbortSignal,
) {
  const result = await upload<CloudDemo>(
    '/demo-analyses',
    file,
    progress,
    signal,
    target ? { target_player_id: target } : { selection_mode: 'choose' },
    600_000,
  )
  if (!result.demo_id) throw new ApiError('云端没有返回有效任务编号')
  return result
}
export const listCloudDemos = (page = 1, signal?: AbortSignal) =>
  request<Page<CloudDemo>>(`/demo-analyses?page=${page}&pageSize=100`, { signal })
export async function getCloudDemo(id: string, signal?: AbortSignal) {
  const value = await request<CloudDemo>(cloudPath(id), { signal })
  if (value.demo_id !== cloudId(id)) throw new ApiError('云端任务编号不一致')
  return value
}
export const deleteCloudDemo = (id: string) => request<void>(cloudPath(id), { method: 'DELETE' })
export const cloudRun = (r: CloudDemo): AnalysisRun => ({
  analysis_id: cloudKey(r.demo_id),
  match_id: r.demo_sha256 ? `demo-${r.demo_sha256.slice(0, 12)}` : '',
  package_id: '',
  target_player_id: r.summary?.target_player_id || r.target_player_id || '',
  status: r.status === 'completed' ? 'completed' : r.status === 'failed' ? 'failed' : 'running',
  stage: r.stage,
  progress: r.progress,
  message: r.message,
  report_available: r.report_available,
  created_at: r.created_at,
  analyzed_at: r.analyzed_at,
})
export function normalizeCloudEvent(e: Wire): ReplayEvent {
  const record = e.data?.record || e.data || {}
  return {
    ...e,
    data: e.type === 'death_context' ? { ...record, record } : { ...e.data, record },
    type: e.type === 'bomb' ? 'bomb_action' : e.type,
  } as ReplayEvent
}
export function normalizeCloudRound(r: Wire): RoundDetail {
  const stats = r.target_summary || {
    round_num: r.round_num,
    kills: r.target?.kills,
    deaths: r.target?.deaths,
    assists: r.target?.assists,
    raw_health_damage_dealt: r.target?.damage,
  }
  return {
    ...r,
    start_tick: r.start_tick ?? null,
    end_tick: r.end_tick ?? null,
    target_summary: stats,
    team_economy: r.team_economy || [
      { side: 'terrorist', equipment_value: r.buy?.t?.equipment_value ?? null },
      { side: 'counter-terrorist', equipment_value: r.buy?.ct?.equipment_value ?? null },
    ],
    events: (r.events || []).map(normalizeCloudEvent),
    finding_ids: r.finding_ids || [],
  } as RoundDetail
}
export function normalizeCloudDetails(raw: Wire): ReplayDetails {
  if (!raw.source?.match_id || !raw.source?.package_id || !raw.target_player_id)
    throw new ApiError('云端详情缺少身份字段')
  const player = raw.target_player || {}
  const rounds = (raw.rounds || []).map(normalizeCloudRound)
  return {
    ...raw,
    target_player: {
      ...player,
      player_id: player.player_id || player.steamid || raw.target_player_id,
      name: player.name || raw.target_player_id,
    },
    players: [
      player,
      ...(Array.isArray(raw.players)
        ? raw.players
        : [...(player.teammates || []), ...(player.opponents || [])]),
    ]
      .filter((p) => p.steamid || p.player_id)
      .map((p) => ({
        player_id: String(p.steamid || p.player_id),
        name: p.name || String(p.steamid || p.player_id),
      })),
    rounds,
    findings: raw.findings || [],
    key_rounds: raw.key_rounds || [],
    statistics: {
      ...raw.statistics,
      tables: raw.statistics?.tables || {
        per_round: rounds.map((r: RoundDetail) => r.target_summary),
      },
    },
    movement: {
      ...raw.movement,
      measured_fire_ticks: raw.movement?.measured_fire_ticks ?? 0,
      eligible_fire_ticks: raw.movement?.eligible_fire_ticks ?? 0,
    },
    map: raw.map || { counts: {} },
  } as ReplayDetails
}
export async function getCloudDetails(id: string, signal?: AbortSignal) {
  return normalizeCloudDetails(await request<Wire>(`${cloudPath(id)}/details`, { signal }))
}
export async function getCloudReport(id: string, signal?: AbortSignal): Promise<AnalysisReport> {
  const r = await request<AnalysisReport>(`${cloudPath(id)}/report`, { signal })
  if (r.analysis_id !== cloudId(id)) throw new ApiError('云端报告与任务编号不一致')
  const modules = Object.fromEntries(
    Object.entries(r.report.modules).map(([key, value]) => [
      key,
      { ...value, metrics: value.metrics ? { ...value.metrics } : null },
    ]),
  )
  const basic = modules.basic_stats?.metrics
  if (basic) {
    basic.kast_pct ??= basic.kast ?? null
    basic.opening_kills ??= modules.opening_duels?.metrics?.opening_kills ?? null
    basic.opening_deaths ??= modules.opening_duels?.metrics?.opening_deaths ?? null
  }
  const death = modules.death_context?.metrics
  if (death) {
    death.deaths_with_context ??= modules.death_context?.sample_count ?? null
    death.deaths_reloading ??= death.reloading_deaths ?? null
    death.deaths_holding_grenade ??= death.holding_utility_deaths ?? null
    death.deaths_with_unused_utility ??= death.unused_utility_deaths ?? null
  }
  const side = r.perspective.player_team_id?.replace(/^team-/, '').replace(/_/g, '-')
  const team = r.match.teams.find((t) => t.team_id.replace(/_/g, '-') === side)
  return {
    ...r,
    analysis_id: cloudKey(r.analysis_id),
    perspective: { player_team_id: team?.team_id || null },
    report: { ...r.report, modules },
  }
}
export const getCloudRound = async (id: string, round: number, signal?: AbortSignal) =>
  normalizeCloudRound(await request<Wire>(`${cloudPath(id)}/rounds/${round}`, { signal }))
export async function getCloudMap(id: string, round: number, offset: number, signal?: AbortSignal) {
  const p = await request<{ items: Wire[]; next_offset: number | null }>(
    `${cloudPath(id)}/rounds/${round}/map?offset=${offset}&limit=500`,
    { signal },
  )
  return {
    ...p,
    items: p.items.map((i) => ({
      ...i,
      points: i.points?.map((p: Wire | number[]) => (Array.isArray(p) ? p : [p.x, p.y, p.z])),
    })) as ReplayMapItem[],
  }
}
export async function getCloudEvents(id: string, details?: ReplayDetails, signal?: AbortSignal) {
  const d = details || (await getCloudDetails(id, signal))
  const events: ReplayEvent[] = []
  let next = 0
  async function worker() {
    while (next < d.rounds.length) {
      const r = d.rounds[next++]!
      const data = await getCloudRound(id, r.round_num, signal)
      events.push(...data.events)
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, d.rounds.length) }, worker))
  return {
    ...d.source,
    events: [...new Map(events.map((e) => [e.event_id, e])).values()].sort(
      (a, b) => a.tick - b.tick,
    ),
  }
}

export const getCloudPlayers = (id: string, signal?: AbortSignal) =>
  request<{
    players: { player_id: string; name: string }[]
    started_at: string | null
    map: string
  }>(`${cloudPath(id)}/players`, { signal })
export const selectCloudPlayer = (
  id: string,
  target: string,
  signal?: AbortSignal,
  force = false,
) =>
  request<CloudDemo>(`${cloudPath(id)}/analyses`, {
    method: 'POST',
    body: JSON.stringify({ target_player_id: target, force }),
    signal,
  })
