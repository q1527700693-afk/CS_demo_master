import type { Page, Replay } from '@/types'
import { listMatches } from './analysis-api'
// List endpoint and all payload fields are proposed contracts; see docs/API-CONTRACT.md.
export const listReplays = async (): Promise<Page<Replay>> => {
  const page = await listMatches()
  return {
    ...page,
    items: page.items.map((item) => {
      const own = item.match.teams.find((t) => t.team_id === item.summary?.player_team_id)
      const opponent = item.match.teams.find((t) => own && t.team_id !== own.team_id)
      const known = Boolean(
        item.match.complete &&
        own?.score !== null &&
        own?.score !== undefined &&
        opponent?.score !== null &&
        opponent?.score !== undefined,
      )
      return {
        id: item.latest_available_analysis_id || item.match_id,
        map: item.match.map,
        title: item.match.complete ? '比赛复盘' : '已记录回合 · 完整性未确认',
        createdAt: item.match.started_at || item.created_at,
        matchTimeKnown: Boolean(item.match.started_at),
        score: [own?.score ?? 0, opponent?.score ?? 0] as [number, number],
        scoreKnown: known,
        status: item.latest_available_analysis_id
          ? 'completed'
          : item.latest_analysis?.status === 'failed'
            ? 'failed'
            : 'queued',
        rating: item.summary?.rating ?? null,
        adr: item.summary?.adr ?? null,
      }
    }),
  }
}
