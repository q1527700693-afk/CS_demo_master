import { getHistory, listMatches, getReportDetails } from './analysis-api'
import { cloudKey, getCloudDetails, listCloudDemos } from './cloud-api'
import { isDesktopRuntime } from '@/app/runtime'
import { listLocalResults } from './local-library'
import { analysisName } from './analysis-name'
export interface AnalysisEntry {
  id: string
  matchId: string
  target: string
  player: string
  map: string
  sequence: number
  adr: number | null
  rating: number | null
  score: [number, number] | null
  updatedAt: string
  title: string
  available: boolean
  status: string
  source: 'cloud' | 'package' | 'local'
  message: string
}
function matchScore(
  match: { complete?: boolean; teams?: { team_id: string; score: number | null }[] },
  team?: string | null,
): [number, number] | null {
  if (!match.complete || !team) return null
  const own = match.teams?.find((t) => t.team_id === team),
    other = match.teams?.find((t) => t.team_id !== team)
  return own?.score != null && other?.score != null ? [own.score, other.score] : null
}
export async function loadAnalysisEntries() {
  const entries: AnalysisEntry[] = [],
    warnings: string[] = []
  async function packages() {
    let page = 1
    while (true) {
      const result = await listMatches(page++)
      for (const match of result.items) {
        const history = await getHistory(match.match_id)
        for (const run of history.items)
          entries.push({
            id: run.analysis_id,
            matchId: run.match_id,
            target: run.target_player_id,
            player: run.target_player_id,
            map: match.match.map,
            sequence: 0,
            adr:
              run.analysis_id === match.latest_available_analysis_id
                ? (match.summary?.adr ?? null)
                : null,
            rating:
              run.analysis_id === match.latest_available_analysis_id
                ? (match.summary?.rating ?? null)
                : null,
            score:
              run.analysis_id === match.latest_available_analysis_id
                ? matchScore(match.match, match.summary?.player_team_id)
                : null,
            updatedAt: run.analyzed_at || run.created_at || match.created_at,
            title: '',
            available: run.report_available,
            status: run.status,
            source: 'package',
            message: run.message,
          })
      }
      if (!result.items.length || page > Math.ceil(result.total / 100)) break
    }
  }
  async function cloud() {
    let page = 1
    while (true) {
      const result = await listCloudDemos(page++)
      for (const run of result.items)
        entries.push({
          id: cloudKey(run.demo_id),
          matchId: run.demo_sha256 || run.demo_id,
          target: run.target_player_id || '',
          player: run.summary?.target_player_name || run.target_player_id || '待选择玩家',
          map: run.map || '',
          sequence: 0,
          adr: run.summary?.adr ?? null,
          rating: null,
          score: null,
          updatedAt: run.analyzed_at || run.created_at,
          title: '',
          available: run.report_available,
          status: run.status,
          source: 'cloud',
          message: run.message,
        })
      if (!result.items.length || page > Math.ceil(result.total / 100)) break
    }
  }
  const results = await Promise.allSettled([packages(), cloud()])
  results.forEach((result, i) => {
    if (result.status === 'rejected')
      warnings.push(
        `${i ? '云端 Demo' : '分析包'}记录暂时无法读取：${result.reason instanceof Error ? result.reason.message : '连接失败'}`,
      )
  })
  if (isDesktopRuntime()) {
    try {
      for (const item of await listLocalResults())
        entries.push({
          id: item.analysis_id,
          matchId: item.match_id,
          target: item.target_player_id,
          player: item.player_name || item.target_player_id,
          map: item.match.map,
          sequence: 0,
          adr: null,
          rating: null,
          score: null,
          updatedAt: item.analyzed_at,
          title: '',
          available: true,
          status: item.status,
          source: 'local',
          message: item.complete ? '已完整保存到本机' : '本机报告',
        })
    } catch {
      warnings.push('本机资料库暂时不可用，已保留可读取的服务器记录。')
    }
  }
  const all = [...new Map(entries.map((item) => [item.id, item])).values()]
  let next = 0
  async function worker() {
    while (next < all.length) {
      const item = all[next++]!
      if (!item.available) continue
      try {
        const details =
          item.source === 'cloud' ? await getCloudDetails(item.id) : await getReportDetails(item.id)
        item.player = details.target_player?.name || item.player
        item.target = details.target_player_id
        const basic =
          details.statistics?.modules?.basic_stats?.metrics ||
          details.statistics?.source_player_stats
        if (typeof basic?.adr === 'number' && Number.isFinite(basic.adr)) item.adr = basic.adr
        if (typeof basic?.rating === 'number' && Number.isFinite(basic.rating))
          item.rating = basic.rating
      } catch {
        /* A failed detail read cannot hide another player's record. */
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, all.length) }, worker))
  all.sort(
    (a, b) =>
      (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) || a.id.localeCompare(b.id),
  )
  all.forEach((item, index) => {
    item.sequence = all.length - index
    item.title = analysisName(item.player, item.map, item.sequence)
  })
  return { entries: all, warnings }
}
