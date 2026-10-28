<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { errorMessage } from '@/api/http'
import { getMyProfile } from '@/features/profile/api'
import { downloadReport, getAnalysis, startAnalysis, uploadPackage } from './analysis-api'
import { companion, validateAnalysisFile, type AutomaticLocalJob } from './automatic-upload'
import type { AcceptedPackage, StageProgress } from './contracts'
import type { RosterPlayer } from './player-identity'
import ProgressStages from './ProgressStages.vue'
import { newRequestKey } from './browser-capabilities'

const router = useRouter(),
  auth = useAuthStore()
const fileInput = ref<HTMLInputElement>(),
  file = ref<File | null>(null)
const busy = ref(false),
  dragging = ref(false),
  error = ref(''),
  analysisId = ref('')
const players = ref<RosterPlayer[]>([]),
  choosingPlayer = ref(false),
  target = ref('')
const stages = ref<StageProgress[]>([])
const pendingKey = () => `csdm.pending-analysis.${auth.user?.id || 'guest'}`
const playerKey = () => `csdm.analysis-player.${auth.user?.id || 'guest'}`
const fileLabel = computed(() =>
  file.value ? `${file.value.name} · ${(file.value.size / 1024 ** 2).toFixed(1)} MB` : '',
)
let disposed = false,
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
  if (disposed) throw new DOMException('页面已离开', 'AbortError')
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
async function chooseTarget(roster: RosterPlayer[]): Promise<string> {
  if (!roster.length) throw new Error('没有读取到玩家名单，请检查 Demo 文件')
  players.value = roster
  // A previously explicit selection or the account's bound SteamID can be reused.
  let preferred = sessionStorage.getItem(playerKey()) || ''
  if (!roster.some((p) => p.player_id === preferred)) {
    try {
      preferred = (await getMyProfile()).steam_id || ''
    } catch {
      preferred = ''
    }
  }
  ensureActive()
  if (preferred && roster.some((p) => p.player_id === preferred)) {
    target.value = preferred
    return preferred
  }
  choosingPlayer.value = true
  set(0, 'running', '请选择要分析的玩家，选定后将自动继续')
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
      await router.replace(`/replays/${run.analysis_id}`)
      return
    }
    await wait()
  }
}
async function process() {
  if (busy.value || (!file.value && !analysisId.value)) return
  busy.value = true
  error.value = ''
  try {
    if (analysisId.value && cloudFailed) {
      const previous = await getAnalysis(analysisId.value)
      const run = await startAnalysis(previous, newRequestKey())
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
        accepted = await uploadPackage(generated, (n) =>
          set(1, 'running', n === 100 ? '上传完成，正在校验' : '正在上传分析数据', n),
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
    await finishAnalysis()
  } catch (e) {
    if (disposed) return
    error.value = errorMessage(e)
    const stage = stages.value.find((s) => s.status === 'running')
    if (stage) Object.assign(stage, { status: 'failed', percent: null, message: error.value })
  } finally {
    if (!disposed) busy.value = false
  }
}
function selectFile(candidate: File | null) {
  if (!candidate || busy.value) return
  const invalid = validateAnalysisFile(candidate)
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
  players.value = []
  analysisId.value = ''
  cloudFailed = false
  error.value = ''
  requestKey = newRequestKey()
  sessionStorage.removeItem(pendingKey())
  resetStages(candidate.name.toLowerCase().endsWith('.dem'))
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
onMounted(() => {
  analysisId.value = sessionStorage.getItem(pendingKey()) || ''
  if (analysisId.value) {
    resetStages(false)
    set(1, 'completed', '已恢复此前上传的分析任务', 100)
    void process()
  }
})
onUnmounted(() => {
  disposed = true
  controller.abort()
  resolvePlayer?.('')
  resolvePlayer = undefined
})
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">MATCH ANALYSIS</div>
      <h1>分析一场比赛<span class="orange">.</span></h1>
      <p>拖入 Demo，自动解析、上传并打开复盘报告。</p>
    </div>
  </section>
  <section class="panel automatic-upload">
    <label
      class="drop-zone"
      :class="{ dragging, busy }"
      @dragover.prevent="dragging = !busy"
      @dragleave.prevent="dragging = false"
      @drop.prevent="drop"
      tabindex="0"
      @keydown.enter.prevent="!busy && fileInput?.click()"
      @keydown.space.prevent="!busy && fileInput?.click()"
      aria-label="上传 Demo 或分析包"
    >
      <span class="drop-symbol" aria-hidden="true">↑</span>
      <strong>{{ busy ? '正在处理比赛…' : '将 Demo 拖到这里，或点击选择文件' }}</strong>
      <span class="muted">支持 .dem（最多 1 GB）及已有 .zip 分析包（最多 50 MB）</span>
      <span v-if="fileLabel" class="selected-file">{{ fileLabel }}</span>
      <input
        ref="fileInput"
        type="file"
        accept=".dem,.zip"
        :disabled="busy"
        class="file-input"
        aria-label="选择比赛文件"
        @change="
          selectFile(($event.target as HTMLInputElement).files?.[0] || null)
          ;($event.target as HTMLInputElement).value = ''
        "
      />
    </label>
    <div v-if="choosingPlayer" class="player-selection" role="status">
      <label
        >选择本次分析的玩家<select aria-label="选择分析玩家" @change="selectPlayer">
          <option value="" selected disabled>请选择一位玩家，随后自动继续</option>
          <option v-for="p in players" :key="p.player_id" :value="p.player_id">
            {{ p.name }} · {{ p.player_id }}
          </option>
        </select></label
      >
      <p class="muted">选定后会自动完成剩余步骤。</p>
    </div>
    <ProgressStages :stages="stages" />
    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    <button
      v-if="error && (file || analysisId)"
      class="button primary"
      :disabled="busy"
      @click="process"
    >
      重试
    </button>
    <p v-if="busy && !choosingPlayer" class="muted small-text" role="status">
      正在自动处理，完成后将直接打开报告。
    </p>
  </section>
</template>
<style scoped>
.automatic-upload {
  padding: 24px;
}
.drop-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  min-height: 240px;
  padding: 32px 20px;
  border: 1px dashed #59616a;
  border-radius: 12px;
  background: #15191c;
  text-align: center;
  cursor: pointer;
  transition:
    background 0.15s,
    border-color 0.15s;
}
.drop-zone:hover,
.drop-zone.dragging {
  border-color: var(--orange);
  background: #27221d;
}
.drop-zone.busy {
  cursor: wait;
  border-style: solid;
}
.drop-symbol {
  font-size: 30px;
  color: var(--orange);
}
.drop-zone strong {
  font-size: 17px;
  font-weight: 600;
}
.drop-zone .muted {
  font-size: 12px;
}
.file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.selected-file {
  color: var(--orange);
  font-size: 13px;
  overflow-wrap: anywhere;
}
.player-selection {
  margin-top: 22px;
  padding: 20px;
  background: #24201b;
  border: 1px solid #64503c;
  border-radius: 10px;
}
.player-selection label {
  display: grid;
  gap: 12px;
}
.player-selection p {
  font-size: 12px;
  margin-top: 10px;
}
.automatic-upload > .error-text {
  margin-bottom: 16px;
}
@media (max-width: 650px) {
  .automatic-upload {
    padding: 16px;
  }
  .drop-zone {
    padding: 24px 14px;
    min-height: 210px;
  }
  .drop-zone strong {
    font-size: 15px;
  }
}
</style>
