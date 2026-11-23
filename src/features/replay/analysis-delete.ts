import { ApiError, request } from '@/api/http'
import { isDesktopRuntime } from '@/app/runtime'
import { deleteCloudDemo, isCloudAnalysis } from './cloud-api'
import { deleteLocalResult } from './local-library'
import { forgetReport } from './analysis-api'
import type { AnalysisEntry } from './analysis-entries'

export async function deleteAnalysisEntry(item: AnalysisEntry) {
  if (isCloudAnalysis(item.id)) await deleteCloudDemo(item.id)
  else {
    try {
      await request(`/analyses/${encodeURIComponent(item.id)}`, { method: 'DELETE' })
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e
    }
    if (isDesktopRuntime()) await deleteLocalResult(item.id)
  }
  forgetReport(item.id)
  window.dispatchEvent(new Event('replays:changed'))
}
