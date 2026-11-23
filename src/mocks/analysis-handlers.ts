/** Browser-only contract fixtures. No parsing, scoring, or server storage. */
import { delay, http, HttpResponse } from 'msw'
import { apiBase } from '@/app/config'
import { mockOwner } from './account-handlers'
import samplePackage from '../../docs/analysis-handoff/sample-package.json'
import sampleReport from '../../docs/analysis-handoff/sample-report.json'
import type { AnalysisRun, AnalysisReport } from '@/features/replay/contracts'

type Entry = { owner: string; uploaded_at: string; runs: (AnalysisRun & { created_at: string })[] }
const key = 'csdm.mock.analysis.v1'
let state: Record<string, Entry> = {}
try {
  state = JSON.parse(localStorage.getItem(key) || '{}')
} catch {
  /* No saved fixture state. */
}
const persist = () => localStorage.setItem(key, JSON.stringify(state))
const url = (path: string) => `${apiBase}${path}`
const ok = (data: unknown, status = 200) =>
  HttpResponse.json({ code: 0, message: 'success', data }, { status })
const fail = (message: string, status = 404) =>
  HttpResponse.json({ code: status * 100, message, data: null }, { status })
function advance(run: Entry['runs'][number]) {
  const elapsed = Date.now() - Date.parse(run.created_at)
  run.status = elapsed < 600 ? 'queued' : elapsed < 2200 ? 'running' : 'partial'
  run.stage =
    elapsed < 600
      ? 'queued'
      : elapsed < 1400
        ? 'evaluating'
        : elapsed < 2200
          ? 'generating_report'
          : 'saved'
  run.progress = run.stage === 'evaluating' ? 50 : run.stage === 'saved' ? 100 : null
  run.message = run.stage === 'saved' ? '演示报告已准备，尚未接入后端' : '演示：模拟云端任务阶段'
  run.report_available = run.status === 'partial'
  return run
}
function current(request: Request) {
  const id = mockOwner(request)
  return id ? state[id] : undefined
}
function reportFor(entry: Entry, run: AnalysisRun): AnalysisReport {
  return {
    ...structuredClone(sampleReport),
    ...run,
    uploaded_at: entry.uploaded_at,
    analyzed_at: new Date().toISOString(),
  } as AnalysisReport
}
export const analysisHandlers = [
  http.post(url('/analysis-packages'), async ({ request }) => {
    const owner = mockOwner(request)
    if (!owner) return fail('请先登录', 401)
    const file = (await request.formData()).get('file')
    if (
      !(file instanceof File) ||
      !file.size ||
      file.size > 50 * 1024 * 1024 ||
      !file.name.toLowerCase().endsWith('.zip')
    )
      return fail('请选择不超过 50 MB 的 ZIP', 400)
    await delay(200)
    state[owner] ??= { owner, uploaded_at: new Date().toISOString(), runs: [] }
    persist()
    return ok(
      {
        match_id: sampleReport.match_id,
        package_id: sampleReport.package_id,
        target_player_id: sampleReport.target_player_id,
        uploaded_at: state[owner].uploaded_at,
        reused: true,
      },
      201,
    )
  }),
  http.post(url('/matches/:id/analyses'), async ({ request, params }) => {
    const entry = current(request)
    if (!entry || params.id !== sampleReport.match_id) return fail('演示比赛不存在')
    const body = (await request.json()) as { package_id: string; target_player_id: string }
    if (
      body.package_id !== sampleReport.package_id ||
      body.target_player_id !== sampleReport.target_player_id
    )
      return fail('标签不一致', 400)
    const requestKey = request.headers.get('Idempotency-Key')
    if (!requestKey) return fail('缺少幂等键', 400)
    // Stable ID on retry; a new key creates another demonstration report.
    const existing = entry.runs.find((r) => r.analysis_id === requestKey)
    if (existing) return ok(advance(existing), 202)
    const run = {
      analysis_id: requestKey,
      match_id: String(params.id),
      ...body,
      created_at: new Date().toISOString(),
      status: 'queued',
      stage: 'queued',
      progress: null,
      message: '演示：等待分析',
      report_available: false,
    } as Entry['runs'][number]
    entry.runs.unshift(run)
    persist()
    return ok(run, 202)
  }),
  http.get(url('/analyses/:id'), ({ request, params }) => {
    const run = current(request)?.runs.find((r) => r.analysis_id === params.id)
    return run ? ok(advance(run)) : fail('演示任务不存在')
  }),
  http.get(url('/analyses/:id/report'), ({ request, params }) => {
    const entry = current(request),
      run = entry?.runs.find((r) => r.analysis_id === params.id)
    if (!entry || !run) return fail('演示报告不存在')
    return advance(run).report_available ? ok(reportFor(entry, run)) : fail('报告尚未就绪', 409)
  }),
  http.get(url('/matches'), ({ request }) => {
    const entry = current(request)
    const runs = entry?.runs.map(advance) || [],
      available = runs.find((r) => r.report_available)
    return ok({
      items: entry
        ? [
            {
              match_id: sampleReport.match_id,
              match: sampleReport.match,
              created_at: entry.uploaded_at,
              latest_analysis: runs[0] || null,
              latest_available_analysis_id: available?.analysis_id || null,
              summary: available
                ? { adr: 50, rating: null, player_team_id: 'team_a', status: 'partial' }
                : null,
            },
          ]
        : [],
      page: 1,
      pageSize: 100,
      total: entry ? 1 : 0,
    })
  }),
  http.get(url('/matches/:id/analyses'), ({ request, params }) => {
    const entry = current(request)
    return entry && params.id === sampleReport.match_id
      ? ok({ items: entry.runs.map(advance) })
      : fail('演示比赛不存在')
  }),
  http.get(url('/analysis-packages/:id/evidence'), ({ request, params }) =>
    current(request) && params.id === sampleReport.package_id
      ? ok({
          match_id: sampleReport.match_id,
          package_id: sampleReport.package_id,
          events: samplePackage.events.items,
          map: samplePackage.map,
        })
      : fail('演示数据不存在'),
  ),
]
