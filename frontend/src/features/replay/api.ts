import type { Page, Replay } from '@/types'
import { loadAnalysisEntries } from './analysis-entries'
// The overview and library include the same cloud, ZIP and native perspectives.
export const listReplays = async (): Promise<Page<Replay> & { warnings: string[] }> => {
  const { entries, warnings } = await loadAnalysisEntries()
  return {
    page: 1,
    pageSize: entries.length,
    total: entries.length,
    warnings,
    items: entries.map((item) => ({
      id: item.id,
      map: item.map,
      title: item.title,
      createdAt: item.updatedAt,
      score: item.score || [0, 0],
      scoreKnown: item.score !== null,
      status: item.available
        ? 'completed'
        : item.status === 'failed'
          ? 'failed'
          : item.status === 'awaiting_player'
            ? 'uploaded'
            : 'analyzing',
      rating: item.rating,
      adr: item.adr,
    })),
  }
}
