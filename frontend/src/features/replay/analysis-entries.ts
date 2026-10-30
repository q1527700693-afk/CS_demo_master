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
  date: string
  title: string
  available: boolean
  status: string
  source: 'cloud' | 'package' | 'local'
  message: string
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
            date: run.created_at || match.created_at,
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
          player: run.summary?.target_player_name || run.target_player_id || '自动选择玩家',
          map: run.map || '',
          date: run.created_at,
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
          date: item.analyzed_at,
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
      } catch {
        /* A failed detail read cannot hide another player's record. */
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, all.length) }, worker))
  all.forEach((item) => (item.title = analysisName(item.player, item.date, item.map, item.id)))
  all.sort(
    (a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0) || a.id.localeCompare(b.id),
  )
  return { entries: all, warnings }
}
