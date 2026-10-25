<script setup lang="ts">
import { ref, onUnmounted, onMounted } from 'vue'
import { ApiError, errorMessage } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import { mockModules } from '@/app/config'
import ProgressStages from './ProgressStages.vue'
import { validatePackage } from './validation'
import {
  uploadPackage,
  startAnalysis,
  getAnalysis,
  downloadReport,
  localHealth,
  startLocal,
  localStatus,
  localPackage,
  localBase,
} from './analysis-api'
import type { AcceptedPackage, StageProgress } from './contracts'

const mode = ref<'zip' | 'demo'>('zip'),
  file = ref<File | null>(null)
const auth = useAuthStore()
const pendingKey = () => `csdm.pending-analysis.${auth.user?.id || 'guest'}`
const player = ref(''),
  token = ref(''),
  busy = ref(false),
  error = ref(''),
  analysisId = ref(''),
  ready = ref(false)
const cloudFailed = ref(false)
let disposed = false,
  accepted: AcceptedPackage | null = null,
  generatedFile: File | null = null
let requestKey = crypto.randomUUID()
const stages = ref<StageProgress[]>([])
function reset() {
  stages.value = [
    {
      stage: 'local',
      label: '本地 Demo 分析',
      status: mode.value === 'zip' ? 'skipped' : 'pending',
      percent: null,
      message: mode.value === 'zip' ? '使用本地工具已生成的分析包' : '等待选择 Demo',
    },
    {
      stage: 'upload',
      label: '上传分析包',
      status: 'pending',
      percent: null,
      message: '只上传分析结果，原始 Demo 留在电脑',
    },
    {
      stage: 'cloud',
      label: '云端分析',
      status: 'pending',
      percent: null,
      message: '等待规则评价与报告生成',
    },
    {
      stage: 'download',
      label: '下载分析报告',
      status: 'pending',
      percent: null,
      message: '按实际接收字节显示进度',
    },
  ]
}
reset()
function set(
  index: number,
  status: StageProgress['status'],
  message: string,
  percent: number | null = null,
) {
  const stage = stages.value[index]
  if (!disposed && stage) Object.assign(stage, { status, message, percent })
}
function changeMode(value: 'zip' | 'demo') {
  mode.value = value
  select(null)
}
function select(candidate: File | null) {
  file.value = candidate
  accepted = null
  generatedFile = null
  analysisId.value = ''
  ready.value = false
  cloudFailed.value = false
  error.value = ''
  requestKey = crypto.randomUUID()
  reset()
}
const wait = () => new Promise((resolve) => setTimeout(resolve, 1000))
function showFailure(cause: unknown) {
  error.value =
    cause instanceof ApiError && cause.status === 404
      ? mockModules.replay
        ? '演示接口未准备好，请刷新页面后重试。当前未进行真实分析。'
        : '分析接口尚未接入，请联系后端组确认接口是否已部署。'
      : errorMessage(cause)
  const current = stages.value.find((s) => s.status === 'running')
  if (current) Object.assign(current, { status: 'failed', percent: null, message: error.value })
}
async function pollCloud() {
  while (!disposed) {
    const run = await getAnalysis(analysisId.value)
    set(2, 'running', run.message, run.progress)
    if (run.status === 'failed') {
      cloudFailed.value = true
      set(2, 'failed', run.message)
      throw new Error(run.message)
    }
    if (run.status === 'completed' || run.status === 'partial') {
      set(
        2,
        'completed',
        run.status === 'partial' ? '可用报告已保存，部分功能暂不可用' : '报告已生成',
        100,
      )
      set(3, 'running', '正在下载报告')
      await downloadReport(analysisId.value, (n) => set(3, 'running', '正在下载报告', n), run)
      set(3, 'completed', '报告已接收，可以查看', 100)
      ready.value = true
      sessionStorage.removeItem(pendingKey())
      return
    }
    await wait()
  }
}
async function submit() {
  if (!file.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    let packageFile = generatedFile || file.value
    if (mode.value === 'demo' && !generatedFile && !accepted) {
      if (mockModules.replay) {
        set(0, 'running', '演示：模拟本地处理步骤（未读取或解析所选 Demo）')
        await wait()
        if (disposed) return
        const response = await fetch('/examples/analysis-contract-v1.zip')
        if (!response.ok) throw new Error('无法加载演示分析包')
        packageFile = generatedFile = new File([await response.blob()], 'analysis.zip', {
          type: 'application/zip',
        })
        set(0, 'completed', '演示：使用固定合成分析包', 100)
      } else {
        set(0, 'running', '连接本地解析工具')
        if (
          !file.value.name.toLowerCase().endsWith('.dem') ||
          !file.value.size ||
          file.value.size > 1024 ** 3
        )
          throw new Error('请选择非空且不超过 1 GB 的 .dem 文件')
        if (!/^\d{17}$/.test(player.value.trim()))
          throw new Error('请输入目标玩家的 17 位 SteamID64')
        if (!token.value.trim()) throw new Error('请输入本地工具的连接令牌')
        const health = await localHealth(token.value.trim())
        if (!health.awpy_available) throw new Error('本地工具未安装 awpy，请先安装解析依赖')
        const job = await startLocal(file.value, player.value.trim(), token.value.trim(), (n) =>
          set(0, 'running', '将文件交给本机解析工具，不上传云端', n),
        )
        while (!disposed) {
          const state = await localStatus(job.job_id, token.value.trim())
          set(0, 'running', state.message, state.percent)
          if (state.status === 'failed') throw new Error(state.message)
          if (state.status === 'completed') break
          await wait()
        }
        if (disposed) return
        const blob = await localPackage(job.job_id, token.value.trim())
        packageFile = generatedFile = new File([blob], 'analysis.zip', { type: 'application/zip' })
        set(0, 'completed', '本地分析包已准备好', 100)
      }
    }
    if (!accepted) {
      const invalid = validatePackage(packageFile)
      if (invalid) throw new Error(invalid)
      set(1, 'running', mockModules.replay ? '演示：在浏览器内处理示例包' : '正在上传分析包', 0)
      accepted = await uploadPackage(packageFile, (n) =>
        set(
          1,
          'running',
          mockModules.replay
            ? '演示：浏览器正在返回固定样例'
            : n === 100
              ? '传输完成，服务器正在校验'
              : '正在上传分析包',
          n,
        ),
      )
      set(
        1,
        'completed',
        mockModules.replay ? '演示：示例包已接收，未上传服务器' : '服务器已验证并保存分析包',
        100,
      )
    }
    if (disposed) return
    if (!analysisId.value) {
      set(2, 'running', '正在创建分析任务')
      const run = await startAnalysis(accepted, requestKey)
      analysisId.value = run.analysis_id
      sessionStorage.setItem(pendingKey(), run.analysis_id)
    }
    await pollCloud()
  } catch (e) {
    showFailure(e)
  } finally {
    busy.value = false
  }
}
async function resume() {
  if (!analysisId.value) return
  busy.value = true
  error.value = ''
  try {
    await pollCloud()
  } catch (e) {
    showFailure(e)
  } finally {
    busy.value = false
  }
}
async function retryCloud() {
  busy.value = true
  error.value = ''
  try {
    const old = await getAnalysis(analysisId.value)
    const run = await startAnalysis(old, crypto.randomUUID())
    analysisId.value = run.analysis_id
    cloudFailed.value = false
    sessionStorage.setItem(pendingKey(), run.analysis_id)
    await pollCloud()
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}
onMounted(() => {
  analysisId.value = sessionStorage.getItem(pendingKey()) || ''
  if (analysisId.value) set(1, 'completed', '已恢复任务，分析包此前已上传', 100)
})
onUnmounted(() => {
  disposed = true
})
</script>
<template>
  <section>
    <div class="page-heading">
      <div>
        <div class="eyebrow">MATCH ANALYSIS</div>
        <h1>分析一场比赛<span class="orange">.</span></h1>
        <p>本地提取数据，云端整理评价，进度分阶段显示。</p>
      </div>
    </div>
    <section class="panel">
      <p v-if="mockModules.replay" class="sample-caption" role="note">
        前端演示模式：目前不能分析真实 Demo。仅展示合成数据，不读取所选
        Demo、不上传真实数据、不调用云端算法。<a
          href="/examples/analysis-contract-v1.zip"
          download
          class="text-link"
          >下载协议示例 ZIP</a
        >
      </p>
      <div class="mode-buttons">
        <button
          class="button"
          :class="mode === 'zip' ? 'primary' : 'secondary'"
          :disabled="busy"
          @click="changeMode('zip')"
        >
          上传已有分析包</button
        ><button
          v-if="mockModules.replay"
          class="button"
          :class="mode === 'demo' ? 'primary' : 'secondary'"
          :disabled="busy"
          @click="changeMode('demo')"
        >
          从本地 Demo 开始
        </button>
      </div>
      <div v-if="mode === 'demo' && !mockModules.replay" class="local-settings">
        <p>先启动本地解析工具，再填写连接令牌。原始文件只发送到本机 {{ localBase }}。</p>
        <label
          >目标玩家 SteamID64<input v-model="player" :disabled="busy" placeholder="17 位 SteamID64"
        /></label>
        <label
          >本地工具连接令牌<input
            v-model="token"
            :disabled="busy"
            type="password"
            autocomplete="off"
            placeholder="本地工具启动时显示的令牌"
        /></label>
      </div>
      <label class="file-choice"
        >{{ mode === 'zip' ? '选择 ZIP 分析包（最多 50 MB）' : '选择 CS2 Demo（最多 1 GB）'
        }}<input
          :key="mode"
          type="file"
          :accept="mode === 'zip' ? '.zip' : '.dem'"
          :disabled="busy"
          @change="select(($event.target as HTMLInputElement).files?.[0] || null)"
      /></label>
      <ProgressStages :stages="stages" />
      <p v-if="error" role="alert" class="error-text">{{ error }}</p>
      <p v-if="analysisId" class="small-text muted">
        任务编号：{{ analysisId }}。离开页面不会取消云端任务。
      </p>
      <button
        v-if="!ready"
        class="button primary"
        :disabled="busy || (!file && !analysisId)"
        @click="cloudFailed ? retryCloud() : analysisId ? resume() : submit()"
      >
        {{
          busy
            ? '正在处理…'
            : cloudFailed
              ? '重新创建云端任务'
              : analysisId
                ? '继续查询 / 下载报告'
                : '开始处理'
        }}
      </button>
      <RouterLink v-if="ready" :to="`/replays/${analysisId}`" class="button primary"
        >查看分析报告</RouterLink
      >
    </section>
  </section>
</template>
<style scoped>
.panel {
  padding: 24px;
}
.panel > .sample-caption {
  margin: 0 0 24px;
  line-height: 1.7;
}
.small-text {
  overflow-wrap: anywhere;
}
.file-choice input {
  width: 100%;
  min-width: 0;
}
@media (max-width: 650px) {
  .panel {
    padding: 16px;
  }
  .file-choice {
    padding: 16px;
  }
}
.mode-buttons {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 24px;
}
.file-choice {
  display: grid;
  gap: 12px;
  padding: 24px;
  border: 1px dashed #6b7476;
  border-radius: 12px;
}
.local-settings {
  display: grid;
  gap: 14px;
  margin-bottom: 24px;
}
.local-settings label {
  display: grid;
  gap: 8px;
}
.local-settings input {
  padding: 12px;
  background: #161b1e;
  border: 1px solid #475154;
  border-radius: 6px;
  color: inherit;
}
</style>
