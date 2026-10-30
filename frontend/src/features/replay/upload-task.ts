import { isDesktopRuntime } from '@/app/runtime'
import { ApiError } from '@/api/http'
import {
  cloudParserStatus,
  getCloudPlayers,
  selectCloudPlayer,
  uploadCloudDemo,
  getCloudDemo,
  getCloudReport,
  cloudKey,
  isCloudAnalysis,
  type ParserStatus,
} from './cloud-api'
import { rememberReport } from './analysis-api'
import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { router } from '@/app/router'
import { useToastStore } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'
import { errorMessage } from '@/api/http'
import { getMyProfile } from '@/features/profile/api'
import { downloadReport, getAnalysis, startAnalysis, uploadPackage } from './analysis-api'
import { companion, validateAnalysisFile, type AutomaticLocalJob } from './automatic-upload'
import type { AcceptedPackage, StageProgress } from './contracts'
import type { RosterPlayer } from './player-identity'
import { newRequestKey } from './browser-capabilities'

export const useUploadTask = defineStore('upload-task', () => {
  const auth = useAuthStore()
  const toast = useToastStore()
  const file = ref<File | null>(null)
  const busy = ref(false),
    dragging = ref(false),
    error = ref(''),
    analysisId = ref('')
  const players = ref<RosterPlayer[]>([]),
    choosingPlayer = ref(false),
    target = ref('')
  const stages = ref<StageProgress[]>([])
  const chooseEveryTime = ref(true)
  const desktop = computed(() => isDesktopRuntime())
  const cloudTarget = ref(''),
    parser = ref<ParserStatus | null>(null),
    checkingParser = ref(false),
    parserError = ref('')
  let cloudForce = false
  let lastCloudFile: File | null = null,
    lastCloudSha = ''
  const pendingTargetKey = () => `csdm.pending-cloud-target.${auth.user?.id || 'guest'}`
  const pendingKey = () => `csdm.pending-analysis.${auth.user?.id || 'guest'}`
  const playerKey = () => `csdm.analysis-player.${auth.user?.id || 'guest'}`
  const fileLabel = computed(() =>
    file.value ? `${file.value.name} · ${(file.value.size / 1024 ** 2).toFixed(1)} MB` : '',
  )
  let taskOwner = auth.user?.id,
    disposed = false,
    controller = new AbortController(),
    generated: File | null = null
  let accepted: AcceptedPackage | null = null,
    requestKey = newRequestKey(),
    cloudFailed = false
  let resolvePlayer: ((value: string) => void) | undefined
  function resetStages(isDemo = true) {
    stages.value = [
      {
        stage: 'local',
        label: '解析 Demo',
        status: isDemo ? 'pending' : 'skipped',
        percent: null,
        message: isDemo ? '选择文件后自动开始' : '使用已有分析包',
      },
      {
        stage: 'upload',
        label: '上传分析数据',
        status: 'pending',
        percent: null,
        message: '解析完成后自动上传',
      },
      {
        stage: 'cloud',
        label: '生成报告',
        status: 'pending',
        percent: null,
        message: '等待分析结果',
      },
      {
        stage: 'download',
        label: '打开报告',
        status: 'pending',
        percent: null,
        message: '完成后自动展示',
      },
    ]
  }
  resetStages()
  function set(
    index: number,
    status: StageProgress['status'],
    message: string,
    percent: number | null = null,
  ) {
    if (!disposed && stages.value[index])
      Object.assign(stages.value[index]!, { status, message, percent })
  }
  const wait = () => new Promise((resolve) => setTimeout(resolve, 700))
  function ensureActive() {
    if (disposed || controller.signal.aborted || taskOwner !== auth.user?.id)
      throw new DOMException('任务已取消', 'AbortError')
  }
  async function waitLocal(id: string, stage: 'parsed' | 'exported'): Promise<AutomaticLocalJob> {
    while (true) {
      ensureActive()
      const state = await companion.state(id, controller.signal)
      set(0, 'running', state.message, state.percent)
      if (state.status === 'failed') throw new Error(state.message)
      if (state.status === 'completed' && state.stage === stage) return state
      await wait()
    }
  }
  async function chooseTarget(roster: RosterPlayer[], stage = 0): Promise<string> {
    if (!roster.length) throw new Error('没有读取到玩家名单，请检查 Demo 文件')
    players.value = roster
    // A previously explicit selection or the account's bound SteamID can be reused.
    let preferred = sessionStorage.getItem(playerKey()) || ''
    if (stage === 0 && !chooseEveryTime.value && !roster.some((p) => p.player_id === preferred)) {
      try {
        preferred = (await getMyProfile()).steam_id || ''
      } catch {
        preferred = ''
      }
    }
    ensureActive()
    if (
      stage === 0 &&
      !chooseEveryTime.value &&
      preferred &&
      roster.some((p) => p.player_id === preferred)
    ) {
      target.value = preferred
      return preferred
    }
    choosingPlayer.value = true
    set(stage, 'running', '请选择要分析的玩家，选定后将自动继续')
    return new Promise((resolve) => (resolvePlayer = resolve))
  }
  function selectPlayer(event: Event) {
    const id = (event.target as HTMLSelectElement).value
    if (!resolvePlayer || !players.value.some((p) => p.player_id === id)) return
    target.value = id
    sessionStorage.setItem(playerKey(), id)
    choosingPlayer.value = false
    const resolve = resolvePlayer
    resolvePlayer = undefined
    resolve(id)
  }
  async function parseDemo(source: File): Promise<File> {
    if (!isDesktopRuntime()) throw new Error('浏览器仅支持云端解析，本地解析请使用应用')
    set(0, 'running', '正在准备解析')
    const health = await companion.health(controller.signal)
    if (!health.awpy_available) throw new Error('解析服务尚未准备好，请重新启动本机服务')
    const job = await companion.start(source, controller.signal, (n) =>
      set(0, 'running', '正在读取比赛录像', n),
    )
    const roster = await waitLocal(job.job_id, 'parsed')
    const player = await chooseTarget(roster.players || [])
    ensureActive()
    set(0, 'running', '正在分析选定玩家')
    await companion.export(job.job_id, player, controller.signal)
    const state = await waitLocal(job.job_id, 'exported')
    if (state.active_target_player_id !== player)
      throw new Error('分析对象与所选玩家不一致，已停止上传')
    const blob = await companion.package(job.job_id, player, controller.signal)
    ensureActive()
    set(0, 'completed', 'Demo 解析完成', 100)
    return new File([blob], 'analysis.zip', { type: 'application/zip' })
  }
  async function finishAnalysis() {
    while (true) {
      ensureActive()
      const run = await getAnalysis(analysisId.value)
      ensureActive()
      set(2, 'running', run.message, run.progress)
      if (run.status === 'failed') {
        cloudFailed = true
        throw new Error(run.message)
      }
      if (run.status === 'completed' || run.status === 'partial') {
        set(2, 'completed', run.status === 'partial' ? '可用报告已生成' : '报告已生成', 100)
        set(3, 'running', '正在接收报告')
        await downloadReport(
          run.analysis_id,
          (n) => set(3, 'running', '正在接收报告', n),
          run,
          (message) => set(3, 'running', message),
        )
        ensureActive()
        set(3, 'completed', '正在打开报告', 100)
        sessionStorage.removeItem(pendingKey())
        if (router.currentRoute.value.name === 'upload')
          await router.replace(`/replays/${run.analysis_id}`)
        else toast.show('比赛报告已生成，可在我的复盘中查看')
        file.value = null
        generated = null
        analysisId.value = ''
        accepted = null
        return
      }
      await wait()
    }
  }
  async function process() {
    if (busy.value || (!file.value && !analysisId.value)) return
    disposed = false
    taskOwner = auth.user?.id
    if (controller.signal.aborted) controller = new AbortController()
    busy.value = true
    error.value = ''
    try {
      ensureActive()
      if (
        isCloudAnalysis(analysisId.value) ||
        (file.value?.name.toLowerCase().endsWith('.dem') && !isDesktopRuntime())
      ) {
        await processCloud()
        return
      }
      if (analysisId.value && cloudFailed) {
        const previous = await getAnalysis(analysisId.value)
        ensureActive()
        const run = await startAnalysis(previous, newRequestKey())
        ensureActive()
        analysisId.value = run.analysis_id
        cloudFailed = false
        sessionStorage.setItem(pendingKey(), run.analysis_id)
      }
      if (!analysisId.value) {
        if (!generated) {
          const source = file.value!
          generated = source.name.toLowerCase().endsWith('.dem') ? await parseDemo(source) : source
        }
        ensureActive()
        if (!accepted) {
          set(1, 'running', '正在上传分析数据', 0)
          accepted = await uploadPackage(
            generated,
            (n) => set(1, 'running', n === 100 ? '上传完成，正在校验' : '正在上传分析数据', n),
            controller.signal,
          )
          ensureActive()
          if (target.value && accepted.target_player_id !== target.value) {
            accepted = null
            throw new Error('服务器返回的分析对象不一致')
          }
          set(1, 'completed', '分析数据已保存', 100)
        }
        set(2, 'running', '正在生成复盘报告')
        const run = await startAnalysis(accepted, requestKey)
        ensureActive()
        analysisId.value = run.analysis_id
        sessionStorage.setItem(pendingKey(), run.analysis_id)
      }
      ensureActive()
      await finishAnalysis()
    } catch (e) {
      if (disposed) return
      error.value = errorMessage(e)
      const stage = stages.value.find((s) => s.status === 'running')
      if (stage) Object.assign(stage, { status: 'failed', percent: null, message: error.value })
    } finally {
      busy.value = false
    }
  }
  function selectFile(candidate: File | null, preferredTarget = '') {
    if (!candidate || busy.value) return
    const invalid =
      !isDesktopRuntime() &&
      candidate.name.toLowerCase().endsWith('.dem') &&
      candidate.size > 512 * 1024 ** 2
        ? '云端 Demo 不得超过 512 MiB'
        : validateAnalysisFile(candidate)
    if (invalid) {
      error.value = invalid
      return
    }
    controller.abort()
    controller = new AbortController()
    file.value = candidate
    generated = null
    accepted = null
    target.value = ''
    cloudTarget.value = preferredTarget
    players.value = []
    analysisId.value = ''
    cloudFailed = false
    error.value = ''
    requestKey = newRequestKey()
    sessionStorage.removeItem(pendingKey())
    resetStages(candidate.name.toLowerCase().endsWith('.dem'))
    if (!isDesktopRuntime() && candidate.name.toLowerCase().endsWith('.dem')) resetCloudStages()
    void process()
  }
  function drop(event: DragEvent) {
    dragging.value = false
    if (busy.value) return
    const files = event.dataTransfer?.files
    if (files && files.length > 1) {
      error.value = '每次请选择一场比赛'
      return
    }
    selectFile(files?.[0] || null)
  }
  function resume(taskId?: string) {
    if (busy.value || analysisId.value) return
    analysisId.value =
      taskId && isCloudAnalysis(taskId) ? taskId : sessionStorage.getItem(pendingKey()) || ''
    if (isCloudAnalysis(analysisId.value)) {
      resetCloudStages()
      cloudTarget.value = sessionStorage.getItem(pendingTargetKey()) || ''
      void process()
      return
    }
    if (analysisId.value) {
      resetStages(false)
      set(1, 'completed', '已恢复此前上传的分析任务', 100)
      void process()
    }
  }
  watch(
    () => auth.user?.id,
    () => {
      disposed = true
      controller.abort()
      resolvePlayer?.('')
      resolvePlayer = undefined
      file.value = null
      generated = null
      accepted = null
      analysisId.value = ''
      choosingPlayer.value = false
      players.value = []
      error.value = ''
      resetStages()
      lastCloudFile = null
      lastCloudSha = ''
      cloudTarget.value = ''
      parser.value = null
      parserError.value = ''
    },
  )
  function resetCloudStages() {
    stages.value = [
      {
        stage: 'upload',
        label: '上传 Demo',
        status: 'pending',
        percent: null,
        message: '原始 Demo 将上传至服务器',
      },
      {
        stage: 'local',
        label: '云端解析',
        status: 'pending',
        percent: null,
        message: '服务器读取比赛数据',
      },
      {
        stage: 'cloud',
        label: '生成报告',
        status: 'pending',
        percent: null,
        message: '按所选玩家生成独立报告',
      },
      {
        stage: 'download',
        label: '打开报告',
        status: 'pending',
        percent: null,
        message: '已有分析记录会保留',
      },
    ]
  }
  async function checkParser() {
    if (isDesktopRuntime() || checkingParser.value) return
    const owner = auth.user?.id
    checkingParser.value = true
    parserError.value = ''
    try {
      const status = await cloudParserStatus()
      if (owner !== auth.user?.id) return
      parser.value = status
      if (status.available && !status.capabilities?.includes('player_selection'))
        parserError.value = '服务器尚未更新玩家选择接口，请稍后重试。'
      if (!status.available)
        parserError.value = '服务器解析引擎尚未就绪，请稍后重试；仍可导入已有 ZIP 分析包。'
    } catch (e) {
      if (owner === auth.user?.id)
        parserError.value =
          e instanceof ApiError && e.status === 404
            ? '云端 Demo 接口尚未部署，请等待服务器更新；仍可导入已有 ZIP 分析包。'
            : errorMessage(e)
    } finally {
      checkingParser.value = false
    }
  }
  async function processCloud() {
    if (isDesktopRuntime()) throw new Error('应用版使用本地解析，云端 Demo 上传已关闭')
    let requested = cloudTarget.value.trim()
    if (!analysisId.value) {
      await checkParser()
      ensureActive()
      while (checkingParser.value) {
        await wait()
        ensureActive()
      }
      if (!parser.value?.available || parserError.value)
        throw new Error(parserError.value || '云端解析服务暂时不可用')
      if (!file.value) throw new Error('请重新选择 Demo 文件')
      if (
        file.value.size > Math.min(512 * 1024 ** 2, parser.value.max_size_bytes || 512 * 1024 ** 2)
      )
        throw new Error('Demo 超出服务器允许的上传大小')
      set(0, 'running', '正在上传原始 Demo', 0)
      const run = await uploadCloudDemo(
        file.value,
        '',
        (n) => set(0, 'running', n === 100 ? '上传完成，服务器正在接收' : '正在上传原始 Demo', n),
        controller.signal,
      )
      ensureActive()
      analysisId.value = cloudKey(run.demo_id)
      sessionStorage.setItem(pendingKey(), analysisId.value)
      sessionStorage.setItem(pendingTargetKey(), requested)
    }
    let deadline = Date.now() + 30 * 60_000
    set(0, 'completed', 'Demo 已上传，后台继续处理', 100)
    while (Date.now() < deadline) {
      ensureActive()
      const run = await getCloudDemo(analysisId.value, controller.signal)
      ensureActive()
      if (run.status === 'failed') {
        analysisId.value = ''
        sessionStorage.removeItem(pendingKey())
        throw new Error(run.message || '云端解析失败，请重新上传 Demo')
      }
      if (
        run.roster_available &&
        (!run.report_available || (requested && (run.target_player_id !== requested || cloudForce)))
      ) {
        const data = await getCloudPlayers(analysisId.value, controller.signal)
        ensureActive()
        set(1, 'completed', '玩家名单已读取', 100)
        const player =
          requested && data.players.some((p) => p.player_id === requested)
            ? requested
            : await chooseTarget(data.players, 1)
        ensureActive()
        cloudTarget.value = player
        requested = player
        const selected = await selectCloudPlayer(
          analysisId.value,
          player,
          controller.signal,
          cloudForce,
        )
        ensureActive()
        cloudForce = false
        analysisId.value = cloudKey(selected.demo_id)
        sessionStorage.setItem(pendingKey(), analysisId.value)
        sessionStorage.setItem(pendingTargetKey(), player)
        set(2, 'running', '正在生成所选玩家的报告')
        deadline = Date.now() + 30 * 60_000
        continue
      }
      if (run.report_available) {
        set(1, 'completed', '云端解析完成', 100)
        set(2, 'completed', '个人报告已生成', 100)
        set(3, 'running', '正在读取报告')
        const report = await getCloudReport(analysisId.value, controller.signal)
        ensureActive()
        if (requested && report.target_player_id !== requested)
          throw new Error('服务器分析的玩家与所选玩家不一致，已停止展示')
        rememberReport(report)
        lastCloudFile = file.value
        lastCloudSha = run.demo_sha256 || ''
        const id = analysisId.value
        set(3, 'completed', '报告已保存，可在我的复盘中查看', 100)
        sessionStorage.removeItem(pendingKey())
        sessionStorage.removeItem(pendingTargetKey())
        analysisId.value = ''
        file.value = null
        if (router.currentRoute.value.name === 'upload')
          await router.replace(`/replays/${encodeURIComponent(id)}`)
        else toast.show('云端分析完成，可在我的复盘中查看')
        return
      }
      const reporting = ['analyzing', 'reporting'].includes(run.stage)
      set(
        1,
        reporting ? 'completed' : 'running',
        reporting ? '解析完成' : run.stage === 'parsing' ? '服务器正在解析 Demo' : '已排队，请稍候',
        reporting ? 100 : null,
      )
      if (reporting) set(2, 'running', '正在生成个人报告')
      await wait()
    }
    throw new Error('服务器仍在处理，可从我的复盘中重新打开进度；已有任务未删除')
  }
  function prepareNew() {
    if (busy.value || analysisId.value) return
    file.value = null
    generated = null
    accepted = null
    error.value = ''
    players.value = []
    choosingPlayer.value = false
    target.value = ''
    cloudTarget.value = ''
    dragging.value = false
    requestKey = newRequestKey()
    cloudFailed = false
    cloudForce = false
    if (isDesktopRuntime()) resetStages()
    else resetCloudStages()
  }
  function startFromCloud(id: string, player: string, force = false) {
    if (isDesktopRuntime() || busy.value) return
    analysisId.value = ''
    prepareNew()
    analysisId.value = id
    cloudTarget.value = player
    cloudForce = force
    sessionStorage.setItem(pendingKey(), id)
    sessionStorage.setItem(pendingTargetKey(), player)
    resetCloudStages()
    void process()
  }
  function reuseCloudFile(playerId: string, sha: string) {
    if (isDesktopRuntime() || busy.value || !lastCloudFile || lastCloudSha !== sha) return false
    selectFile(lastCloudFile, playerId)
    return true
  }
  return {
    prepareNew,
    startFromCloud,
    chooseEveryTime,
    desktop,
    cloudTarget,
    parser,
    checkingParser,
    parserError,
    checkParser,
    reuseCloudFile,
    file,
    busy,
    dragging,
    error,
    analysisId,
    players,
    choosingPlayer,
    target,
    stages,
    fileLabel,
    selectPlayer,
    selectFile,
    drop,
    process,
    resume,
  }
})
