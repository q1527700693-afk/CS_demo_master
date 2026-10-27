import { apiBase, TOKEN_KEY } from '@/app/config'
import { useAuthStore } from '@/stores/auth'
import type { AnalysisReport, ReplayDetails, AnalysisRun, MatchInfo } from './contracts'
import { canUseLocalReplayLibrary } from './browser-capabilities'

export interface LocalResult {
  analysis_id: string
  match_id: string
  package_id: string
  target_player_id: string
  player_name?: string
  match: MatchInfo
  status: string
  analyzed_at: string
  saved_at: string
  complete: boolean
  directory?: string
  relative_path?: string
}

// Account namespace on this machine, not a cloud credential. JWTs never go to the companion.
export async function libraryOwner() {
  if (!canUseLocalReplayLibrary()) throw new Error('本地复盘资料库仅在本机前端服务中可用')
  const token = localStorage.getItem(TOKEN_KEY)
  if (!token) throw new Error('请先登录再读取本地复盘')
  const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')))
  if (!payload.sub) throw new Error('无法识别当前账号')
  const bytes = new TextEncoder().encode(`${location.origin}|${apiBase}|${payload.sub}`)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map((n) => n.toString(16).padStart(2, '0')).join('')
}

async function local<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? '本地结果不存在'
        : '本地保存失败，请确认本机解析服务正在运行且磁盘空间充足',
    )
  const value = await response.json()
  if (value.code !== 0) throw new Error(value.message || '本地保存失败')
  return value.data as T
}

export async function listLocalResults(): Promise<LocalResult[]> {
  const owner = await libraryOwner()
  return (await local<{ items: LocalResult[] }>(`/local/library/${owner}`)).items
}
export async function localResource<T>(key: string): Promise<T | undefined> {
  if (!canUseLocalReplayLibrary()) return undefined
  try {
    const token = localStorage.getItem(TOKEN_KEY)
    const owner = await libraryOwner()
    const data = await local<T>(`/local/library/${owner}/resource?key=${encodeURIComponent(key)}`)
    if (token !== localStorage.getItem(TOKEN_KEY)) throw new Error('登录状态已改变')
    return data
  } catch {
    return undefined
  }
}
export function localRun(item: LocalResult): AnalysisRun {
  return {
    ...item,
    status: item.status === 'completed' ? 'completed' : 'partial',
    stage: 'completed',
    progress: 100,
    message: '已保存到本机',
    report_available: true,
    created_at: item.analyzed_at,
  }
}

const saving = new Map<string, Promise<void>>()
export async function saveLocalResult(
  report: AnalysisReport,
  read: <T>(key: string) => Promise<T>,
  progress: (message: string) => void = () => {},
) {
  const owner = await libraryOwner(),
    id = report.analysis_id,
    taskKey = `${owner}:${id}`
  if (saving.has(taskKey)) return saving.get(taskKey)!
  const token = localStorage.getItem(TOKEN_KEY)
  const task = (async () => {
    const base = `/local/library/${owner}/${id}`
    const started = await local<{ complete: boolean }>(`${base}/begin`, {
      report,
      account_label: useAuthStore().user?.username || '本地账号',
    })
    if (started.complete) return
    const keys: string[] = []
    const ensureOwner = () => {
      if (token !== localStorage.getItem(TOKEN_KEY))
        throw new Error('登录状态已改变，本地保存已停止')
    }
    async function put(key: string, data: unknown) {
      ensureOwner()
      await local(`${base}/resource`, { key, data })
      keys.push(key)
    }
    async function copy<T>(key: string) {
      ensureOwner()
      const data = await read<T>(key)
      await put(key, data)
      return data
    }
    progress('正在保存报告和数据表到本机')
    await put(`/analyses/${id}/report`, report)
    const details = await copy<ReplayDetails>(`/analyses/${id}/details`)
    if (
      details.source.package_id !== report.package_id ||
      details.source.match_id !== report.match_id
    )
      throw new Error('报告身份不一致，未完成本地保存')
    await copy(`/analysis-packages/${report.package_id}/events`)
    for (const [index, round] of details.rounds.entries()) {
      progress(`正在保存本机地图数据 ${index + 1}/${details.rounds.length} 回合`)
      const root = `/analyses/${id}/rounds/${round.round_num}`
      await copy(root)
      const streams =
        details.export_scope?.scope === 'all_players_and_all_utility'
          ? ['samples', 'trajectories', 'events'].map(
              (kind) =>
                `/analysis-packages/${report.package_id}/global/${kind}?round_num=${round.round_num}&limit=500&offset=`,
            )
          : [`${root}/map?limit=500&offset=`]
      for (const stream of streams) {
        let offset: number | null = 0
        while (offset !== null) {
          const page: { next_offset: number | null } = await copy(`${stream}${offset}`)
          if (
            page.next_offset !== null &&
            (!Number.isSafeInteger(page.next_offset) || page.next_offset <= offset)
          )
            throw new Error('地图分页不完整，本地保存已停止')
          offset = page.next_offset
        }
      }
    }
    ensureOwner()
    await local(`${base}/commit`, { keys })
    progress('完整复盘结果已保存到本机')
  })()
  saving.set(taskKey, task)
  try {
    await task
  } finally {
    saving.delete(taskKey)
  }
}
