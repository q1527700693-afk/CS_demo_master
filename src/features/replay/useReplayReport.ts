import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errorMessage } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import { mockModules } from '@/app/config'
import {
  getAiReport,
  generateAiReport,
  cachedReport,
  downloadReport,
  getReportEvents,
  getHistory,
  getReportDetails,
  getRound,
  startAnalysis,
} from './analysis-api'
import { waitForQueuedAi } from './ai-queue'
import { isCloudAnalysis, readCloudRoundEvidence } from './cloud-api'
import { reconcileCombat } from './combat-facts'
import { normalizeAiReport } from './ai-report'
import type {
  AiCoachReport,
  AnalysisReport,
  AnalysisRun,
  ReplayDetails,
  ReplayEvent,
  RoundDetail,
} from './contracts'
import {
  assertDetailsIdentity,
  collectRoundEvents,
  completeRoundSides,
  roundRows,
} from './report-data'
import { reviewFocus } from './review-presentation'
import { newRequestKey } from './browser-capabilities'

export function useReplayReport() {
  const route = useRoute(),
    router = useRouter(),
    auth = useAuthStore()
  const report = ref<AnalysisReport | null>(null),
    details = ref<ReplayDetails | null>(null)
  const events = ref<ReplayEvent[]>([]),
    history = ref<AnalysisRun[]>([])
  const loading = ref(true),
    error = ref(''),
    detailsError = ref(''),
    eventsError = ref(''),
    historyError = ref(''),
    actionError = ref(''),
    retrying = ref(false)
  const ai = ref<AiCoachReport | null>(null),
    aiError = ref(''),
    aiLoading = ref(false)
  let aiController: AbortController | undefined
  let evidenceController: AbortController | undefined
  let generation = 0,
    aiRevision = 0
  const rows = computed(() => (details.value ? roundRows(details.value) : []))
  const focuses = computed(() =>
    report.value ? reviewFocus(report.value, details.value, events.value) : [],
  )
  async function load() {
    const current = ++generation,
      id = String(route.params.id)
    aiController?.abort()
    evidenceController?.abort()
    const controller = new AbortController()
    evidenceController = controller
    aiRevision++
    ai.value = null
    aiError.value = ''
    aiLoading.value = false
    loading.value = true
    for (const state of [error, detailsError, eventsError, historyError, actionError])
      state.value = ''
    report.value = null
    details.value = null
    events.value = []
    history.value = []
    try {
      const value = cachedReport(id) || (await downloadReport(id, () => {}))
      if (current !== generation) return
      report.value = value
      void loadAi(id, current)
      const cloud = isCloudAnalysis(id)
      const results = await Promise.allSettled([
        cloud ? Promise.resolve(null) : getReportEvents(value.package_id, id),
        getHistory(value.match_id, value.target_player_id),
        mockModules.replay ? Promise.resolve(null) : getReportDetails(id),
      ])
      if (current !== generation) return
      const [eventResult, historyResult, detailResult] = results
      if (eventResult.status === 'fulfilled' && eventResult.value) {
        if (
          eventResult.value.match_id !== value.match_id ||
          eventResult.value.package_id !== value.package_id
        )
          eventsError.value = '事件与当前比赛不一致，请重新读取。'
        else events.value = eventResult.value.events as ReplayEvent[]
      } else if (eventResult.status === 'rejected')
        eventsError.value = errorMessage(eventResult.reason)
      else eventsError.value = '回合事件未载入'
      if (historyResult.status === 'fulfilled') history.value = historyResult.value.items
      else historyError.value = errorMessage(historyResult.reason)
      if (detailResult.status === 'fulfilled' && detailResult.value) {
        try {
          assertDetailsIdentity(detailResult.value, value)
          const reads = new Map<number, Promise<RoundDetail>>()
          const readRound = (n: number) => {
            let pending = reads.get(n)
            if (!pending) {
              pending = cloud
                ? readCloudRoundEvidence(id, n, value.target_player_id, true, controller.signal)
                : getRound(id, n, controller.signal)
              reads.set(n, pending)
            }
            return pending
          }
          const rawDetails = detailResult.value
          const recovered =
            (cloud || eventResult.status === 'rejected') && rawDetails.rounds.length
              ? await collectRoundEvents(rawDetails, readRound)
              : null
          if (current !== generation) return
          if (recovered) {
            events.value = recovered.events
            eventsError.value = recovered.missing.length
              ? `有 ${recovered.missing.length} 个回合的事件未载入`
              : ''
          }
          const completed = await completeRoundSides(rawDetails, readRound)
          if (current !== generation) return
          details.value = completed
        } catch (e) {
          detailsError.value = errorMessage(e)
        }
      } else if (detailResult.status === 'rejected')
        detailsError.value = errorMessage(detailResult.reason)
      if (!eventsError.value) {
        const reconciled = reconcileCombat(value, details.value, events.value)
        report.value = reconciled.report
        details.value = reconciled.details
      }
    } catch (e) {
      if (current === generation) error.value = errorMessage(e)
    } finally {
      if (current === generation) loading.value = false
    }
  }
  async function loadAi(id: string, current: number) {
    const revision = ++aiRevision
    try {
      const raw = await getAiReport(id)
      if (raw.queued && current === generation && revision === aiRevision && !aiLoading.value) {
        aiLoading.value = true
        const controller = new AbortController()
        aiController = controller
        const timer = setTimeout(() => controller.abort(), 180_000)
        try {
          const completed = await waitForQueuedAi(raw, controller.signal, () =>
            getAiReport(id, controller.signal),
          )
          if (current === generation && revision === aiRevision)
            ai.value = normalizeAiReport(completed, id)
        } finally {
          clearTimeout(timer)
          if (current === generation && revision === aiRevision) aiLoading.value = false
        }
        return
      }
      const result = normalizeAiReport(raw, id)
      if (current === generation && revision === aiRevision && !aiLoading.value) ai.value = result
    } catch (e) {
      if (current === generation && revision === aiRevision && !aiLoading.value)
        aiError.value = errorMessage(e)
    }
  }
  async function generateAi() {
    if (!report.value || aiLoading.value) return
    const current = generation,
      id = report.value.analysis_id
    aiRevision++
    aiLoading.value = true
    aiError.value = ''
    const controller = new AbortController()
    aiController = controller
    const timeout = setTimeout(() => controller.abort(), isCloudAnalysis(id) ? 180_000 : 90_000)
    try {
      let raw = await generateAiReport(id, controller.signal)
      if (isCloudAnalysis(id))
        raw = await waitForQueuedAi(raw, controller.signal, () =>
          getAiReport(id, controller.signal),
        )
      const result = normalizeAiReport(raw, id)
      if (current === generation) ai.value = result
    } catch (e) {
      if (current === generation) aiError.value = errorMessage(e)
    } finally {
      clearTimeout(timeout)
      if (current === generation) aiLoading.value = false
    }
  }
  async function reanalyze() {
    if (report.value && isCloudAnalysis(report.value.analysis_id)) {
      await router.push({
        path: '/replays/new',
        query: {
          source: report.value.analysis_id,
          target: report.value.target_player_id,
          force: 'true',
        },
      })
      return
    }
    if (!report.value) return
    retrying.value = true
    actionError.value = ''
    try {
      const run = await startAnalysis(report.value, newRequestKey())
      sessionStorage.setItem(`csdm.pending-analysis.${auth.user?.id || 'guest'}`, run.analysis_id)
      await router.push('/replays/new?view=cloud')
    } catch (e) {
      actionError.value = errorMessage(e)
    } finally {
      retrying.value = false
    }
  }
  function exportReport() {
    if (!report.value) return
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ report: report.value, details: details.value }, null, 2)], {
        type: 'application/json',
      }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `replay-${report.value.analysis_id}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  watch(() => [route.params.id, auth.user?.id], load, { immediate: true })
  onUnmounted(() => {
    generation++
    evidenceController?.abort()
    aiController?.abort()
  })
  return {
    ai,
    aiError,
    aiLoading,
    generateAi,
    report,
    details,
    events,
    history,
    rows,
    focuses,
    loading,
    error,
    detailsError,
    eventsError,
    historyError,
    actionError,
    retrying,
    load,
    reanalyze,
    exportReport,
  }
}
