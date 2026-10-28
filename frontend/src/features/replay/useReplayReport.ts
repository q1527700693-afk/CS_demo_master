import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errorMessage } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import { mockModules } from '@/app/config'
import {
  cachedReport,
  downloadReport,
  getReportEvents,
  getHistory,
  getReportDetails,
  getAiReport,
  generateAiReport,
  startAnalysis,
} from './analysis-api'
import type {
  AiCoachReport,
  AnalysisReport,
  AnalysisRun,
  ReplayDetails,
  ReplayEvent,
} from './contracts'
import { assertDetailsIdentity, roundRows } from './report-data'
import { reviewFocus } from './review-presentation'
import { newRequestKey } from './browser-capabilities'

export function useReplayReport() {
  const route = useRoute(),
    router = useRouter(),
    auth = useAuthStore()
  const report = ref<AnalysisReport | null>(null),
    details = ref<ReplayDetails | null>(null)
  const events = ref<ReplayEvent[]>([]),
    history = ref<AnalysisRun[]>([]),
    ai = ref<AiCoachReport | null>(null)
  const loading = ref(true),
    error = ref(''),
    detailsError = ref(''),
    eventsError = ref(''),
    historyError = ref(''),
    aiError = ref(''),
    actionError = ref(''),
    retrying = ref(false),
    aiLoading = ref(false)
  let generation = 0
  const rows = computed(() => (details.value ? roundRows(details.value) : []))
  const focuses = computed(() =>
    report.value ? reviewFocus(report.value, details.value, events.value) : [],
  )
  async function load() {
    const current = ++generation,
      id = String(route.params.id)
    loading.value = true
    for (const state of [error, detailsError, eventsError, historyError, aiError, actionError])
      state.value = ''
    report.value = null
    details.value = null
    events.value = []
    history.value = []
    ai.value = null
    try {
      const value = cachedReport(id) || (await downloadReport(id, () => {}))
      if (current !== generation) return
      report.value = value
      const results = await Promise.allSettled([
        getReportEvents(value.package_id),
        getHistory(value.match_id),
        mockModules.replay ? Promise.resolve(null) : getReportDetails(id),
        getAiReport(id),
      ])
      if (current !== generation) return
      const [eventResult, historyResult, detailResult, aiResult] = results
      if (eventResult.status === 'fulfilled') {
        if (
          eventResult.value.match_id !== value.match_id ||
          eventResult.value.package_id !== value.package_id
        )
          eventsError.value = '事件与当前比赛不一致，请重新读取。'
        else events.value = eventResult.value.events as ReplayEvent[]
      } else eventsError.value = errorMessage(eventResult.reason)
      if (historyResult.status === 'fulfilled') history.value = historyResult.value.items
      else historyError.value = errorMessage(historyResult.reason)
      if (aiResult.status === 'fulfilled') ai.value = aiResult.value
      else aiError.value = errorMessage(aiResult.reason)
      if (detailResult.status === 'fulfilled' && detailResult.value) {
        try {
          assertDetailsIdentity(detailResult.value, value)
          details.value = detailResult.value
        } catch (e) {
          detailsError.value = errorMessage(e)
        }
      } else if (detailResult.status === 'rejected')
        detailsError.value = errorMessage(detailResult.reason)
    } catch (e) {
      if (current === generation) error.value = errorMessage(e)
    } finally {
      if (current === generation) loading.value = false
    }
  }
  async function generateAi() {
    if (!report.value || aiLoading.value) return
    aiLoading.value = true
    aiError.value = ''
    try {
      ai.value = await generateAiReport(report.value.analysis_id)
    } catch (e) {
      aiError.value = errorMessage(e)
    } finally {
      aiLoading.value = false
    }
  }
  async function reanalyze() {
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
  onUnmounted(() => generation++)
  return {
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
    aiError,
    actionError,
    retrying,
    ai,
    aiLoading,
    generateAi,
    load,
    reanalyze,
    exportReport,
  }
}
