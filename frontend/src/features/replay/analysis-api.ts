import { apiBase, TOKEN_KEY, mockModules } from '@/app/config'
import { ApiError, request, upload } from '@/api/http'
import type { ApiResponse, Page } from '@/types'
import type {
  AiCoachReport,
  AcceptedPackage,
  AnalysisRun,
  AnalysisReport,
  MatchRecord,
  LocalJob,
  ReplayDetails,
  ReplayMapItem,
  RoundDetail,
  ReplayEvent,
} from './contracts'
import { assertReportIdentity, type ReportIdentity } from './report-identity'
import { localResource, listLocalResults, localRun, saveLocalResult } from './local-library'
import { canUseLocalReplayLibrary } from './browser-capabilities'

export const localBase = (import.meta.env.VITE_LOCAL_PARSER_URL || 'http://127.0.0.1:8877').replace(
  /\/$/,
  '',
)
async function prepareAnalysisTransport() {
  if (!mockModules.replay) return
  try {
    const { ensureAnalysisMocks } = await import('@/mocks/browser')
    await ensureAnalysisMocks()
  } catch {
    throw new ApiError('前端演示服务未就绪，请刷新页面后重试；尚未发送文件')
  }
}
async function analysisRequest<T>(path: string, options?: RequestInit): Promise<T> {
  await prepareAnalysisTransport()
  if (
    !mockModules.replay &&
    (!options?.method || options.method === 'GET') &&
    /^(\/analyses\/[^/]+\/(report|details|rounds)|\/analysis-packages\/[^/]+\/(events|global\/))/.test(
      path,
    )
  ) {
    const saved = await localResource<T>(path)
    if (saved !== undefined) return saved
  }
  return request<T>(path, options)
}
export const uploadPackage = async (
  file: File,
  progress: (n: number | null) => void,
  signal?: AbortSignal,
) => {
  await prepareAnalysisTransport()
  return upload<AcceptedPackage>('/analysis-packages', file, progress, signal)
}
export const startAnalysis = async (
  p: Pick<AcceptedPackage, 'match_id' | 'package_id' | 'target_player_id'>,
  key: string,
) => {
  const run = await analysisRequest<AnalysisRun>(
    `/matches/${encodeURIComponent(p.match_id)}/analyses`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify({ package_id: p.package_id, target_player_id: p.target_player_id }),
    },
  )
  if (
    !run.analysis_id ||
    ['match_id', 'package_id', 'target_player_id'].some(
      (k) => run[k as keyof typeof p] !== p[k as keyof typeof p],
    )
  )
    throw new ApiError('云端任务标签与上传包不一致')
  return run
}
export const getAnalysis = async (id: string) => {
  const run = await analysisRequest<AnalysisRun>(`/analyses/${encodeURIComponent(id)}`)
  if (run.analysis_id !== id) throw new ApiError('返回的任务编号不一致')
  return run
}
export const listMatches = (page = 1) =>
  analysisRequest<Page<MatchRecord>>(`/matches?page=${page}&pageSize=100`)
export const getHistory = async (id: string) => {
  const saved =
    mockModules.replay || !canUseLocalReplayLibrary()
      ? []
      : (await listLocalResults().catch(() => [])).filter((r) => r.match_id === id).map(localRun)
  try {
    const remote = await analysisRequest<{ items: AnalysisRun[] }>(
      `/matches/${encodeURIComponent(id)}/analyses`,
    )
    return {
      items: [
        ...remote.items,
        ...saved.filter((s) => !remote.items.some((r) => r.analysis_id === s.analysis_id)),
      ],
    }
  } catch (e) {
    if (saved.length) return { items: saved }
    throw e
  }
}
export const getReportDetails = (id: string) =>
  analysisRequest<ReplayDetails>(`/analyses/${encodeURIComponent(id)}/details`)
export const getRound = (id: string, round: number, signal?: AbortSignal) =>
  analysisRequest<RoundDetail>(`/analyses/${encodeURIComponent(id)}/rounds/${round}`, { signal })
export const getRoundMap = (id: string, round: number, offset: number, signal?: AbortSignal) =>
  analysisRequest<{ items: ReplayMapItem[]; next_offset: number | null }>(
    `/analyses/${encodeURIComponent(id)}/rounds/${round}/map?limit=500&offset=${offset}`,
    { signal },
  )
export const getGlobalMapPage = <T>(
  id: string,
  kind: 'samples' | 'trajectories' | 'events',
  round: number,
  offset: number,
  signal?: AbortSignal,
) =>
  analysisRequest<{ items: T[]; next_offset: number | null; total: number }>(
    `/analysis-packages/${encodeURIComponent(id)}/global/${kind}?round_num=${round}&limit=500&offset=${offset}`,
    { signal },
  )
export const getEvidence = (id: string) =>
  analysisRequest<{
    match_id: string
    package_id: string
    events: {
      event_id: string
      type: string
      tick: number
      round_num: number | null
      data: Record<string, unknown>
    }[]
    map: { trajectories: { event_id: string; type: string; points: [number, number, number][] }[] }
  }>(`/analysis-packages/${encodeURIComponent(id)}/evidence`)
export const getReportEvents = async (id: string) => {
  if (mockModules.replay) return getEvidence(id)
  return analysisRequest<{ match_id: string; package_id: string; events: ReplayEvent[] }>(
    `/analysis-packages/${encodeURIComponent(id)}/events`,
  )
}
const reports = new Map<string, AnalysisReport>()
const cacheKey = (id: string) => `${localStorage.getItem(TOKEN_KEY) || 'guest'}:${id}`
export function rememberReport(report: AnalysisReport) {
  if (reports.size >= 10) reports.delete(reports.keys().next().value!)
  reports.set(cacheKey(report.analysis_id), report)
}
export const cachedReport = (id: string) => reports.get(cacheKey(id))

/** Byte progress; missing Content-Length means indeterminate. */
export function transfer<T>(
  url: string,
  token: string,
  progress: (n: number | null) => void,
  options: {
    file?: File
    json?: Record<string, unknown>
    blob?: boolean
    signal?: AbortSignal
  } = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(options.file || options.json ? 'POST' : 'GET', url)
    xhr.timeout = 300_000
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    if (options.file) xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    if (options.json) xhr.setRequestHeader('Content-Type', 'application/json')
    if (options.blob) xhr.responseType = 'blob'
    const abort = () => xhr.abort()
    options.signal?.addEventListener('abort', abort, { once: true })
    const cleanup = () => options.signal?.removeEventListener('abort', abort)
    const channel = options.file ? xhr.upload : xhr
    channel.onprogress = (e) =>
      progress(e.lengthComputable && e.total > 0 ? Math.round((e.loaded / e.total) * 100) : null)
    xhr.onload = async () => {
      cleanup()
      try {
        if (options.blob && xhr.status >= 200 && xhr.status < 300) {
          progress(100)
          resolve(xhr.response as T)
          return
        }
        const text = options.blob ? await (xhr.response as Blob).text() : xhr.responseText
        const body = JSON.parse(text) as ApiResponse<T>
        if (xhr.status < 200 || xhr.status >= 300 || body.code !== 0) {
          if (xhr.status === 401 && body.code === 40002) {
            localStorage.removeItem(TOKEN_KEY)
            window.dispatchEvent(new Event('auth:expired'))
          }
          throw new ApiError(body.message, body.code, xhr.status)
        }
        progress(100)
        resolve(body.data)
      } catch (error) {
        reject(error)
      }
    }
    xhr.onerror = () => {
      cleanup()
      reject(new ApiError('连接失败，请检查本地工具或服务器是否启动'))
    }
    xhr.ontimeout = () => {
      cleanup()
      reject(new ApiError('传输超时，可以重试'))
    }
    xhr.onabort = () => {
      cleanup()
      reject(new DOMException('请求已取消', 'AbortError'))
    }
    if (options.signal?.aborted) {
      cleanup()
      reject(new DOMException('请求已取消', 'AbortError'))
      return
    }
    xhr.send(options.file || (options.json ? JSON.stringify(options.json) : null))
  })
}
export const downloadReport = async (
  id: string,
  progress: (n: number | null) => void,
  expected?: ReportIdentity,
  saveProgress: (message: string) => void = () => {},
) => {
  await prepareAnalysisTransport()
  if (!mockModules.replay) {
    const saved = await localResource<AnalysisReport>(`/analyses/${id}/report`)
    if (saved) {
      assertReportIdentity(saved, { ...expected, analysis_id: id })
      rememberReport(saved)
      return saved
    }
  }
  const token = localStorage.getItem(TOKEN_KEY) || ''
  const report = await transfer<AnalysisReport>(
    `${apiBase}/analyses/${encodeURIComponent(id)}/report`,
    token,
    progress,
  )
  if (token !== (localStorage.getItem(TOKEN_KEY) || ''))
    throw new ApiError('登录状态已改变，请重新读取报告')
  assertReportIdentity(report, { ...expected, analysis_id: id })
  if (!mockModules.replay && canUseLocalReplayLibrary())
    await saveLocalResult(report, (key) => request(key), saveProgress)
  rememberReport(report)
  return report
}
export const localHealth = (token: string) =>
  transfer<{ awpy_available: boolean }>(`${localBase}/local/health`, token, () => {})
export const startLocal = (
  file: File,
  player: string,
  token: string,
  progress: (n: number | null) => void,
) =>
  transfer<{ job_id: string }>(
    `${localBase}/local/jobs?target_player_id=${encodeURIComponent(player)}`,
    token,
    progress,
    { file },
  )
export const localStatus = (id: string, token: string) =>
  transfer<LocalJob>(`${localBase}/local/jobs/${encodeURIComponent(id)}`, token, () => {})
export const localPackage = (id: string, token: string) =>
  transfer<Blob>(`${localBase}/local/jobs/${encodeURIComponent(id)}/package`, token, () => {}, {
    blob: true,
  })

export const getAiReport = (id: string, signal?: AbortSignal) =>
  analysisRequest<AiCoachReport>(`/analyses/${encodeURIComponent(id)}/ai`, { signal })
export const generateAiReport = (id: string, signal?: AbortSignal) =>
  analysisRequest<AiCoachReport>(`/analyses/${encodeURIComponent(id)}/ai`, {
    method: 'POST',
    signal: signal ?? AbortSignal.timeout(90_000),
  })
