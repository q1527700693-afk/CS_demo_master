<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { ApiError, errorMessage, request } from '@/api/http'
import {
  downloadReport,
  getAiReport,
  getReportEvents,
  getReportDetails,
} from '@/features/replay/analysis-api'
import { loadAnalysisEntries } from '@/features/replay/analysis-entries'
import { reconcileCombat } from '@/features/replay/combat-facts'
import { normalizeAiReport } from '@/features/replay/ai-report'
import type { AnalysisReport } from '@/features/replay/contracts'
import { mapName, valueText } from '@/features/replay/review-presentation'
import {
  emptyShowcase,
  getShowcase,
  updateShowcase,
  readShowcaseDraft,
  saveShowcaseDraft,
} from './demo-showcase'
const props = defineProps<{ own: boolean; userId?: string }>()
const auth = useAuthStore()
const owner = computed(() => props.userId || auth.user?.id || '')
const model = ref(emptyShowcase()),
  published = ref(emptyShowcase())
const options = ref<{ id: string; label: string }[]>([])
const loading = ref(false),
  saving = ref(false),
  selecting = ref(false),
  choicesLoading = ref(false),
  error = ref(''),
  notice = ref(''),
  synced = ref(false)
let revision = 0,
  selection = 0
const unsupported = (e: unknown) => e instanceof ApiError && [404, 405, 501].includes(e.status)
const visible = computed(() => (props.own ? model.value : published.value))
async function load() {
  const current = ++revision
  selection++
  options.value = []
  error.value = ''
  notice.value = ''
  synced.value = false
  selecting.value = false
  saving.value = false
  model.value = emptyShowcase()
  published.value = emptyShowcase()
  choicesLoading.value = false
  if (!owner.value) return
  loading.value = true
  try {
    const result = await getShowcase(owner.value, props.own)
    if (current !== revision) return
    model.value = result
    published.value = result
    synced.value = true
  } catch (e) {
    if (current !== revision) return
    if (props.own && unsupported(e)) {
      model.value = readShowcaseDraft(owner.value)
      notice.value = '公开展示接口尚未上线；可以先选择内容并保存本机草稿，其他玩家暂不可见。'
    } else if (!unsupported(e)) error.value = errorMessage(e)
  } finally {
    if (current === revision) {
      loading.value = false
      if (props.own) void loadChoices()
    }
  }
}
async function loadChoices() {
  if (choicesLoading.value) return
  const current = revision
  error.value = ''
  choicesLoading.value = true
  try {
    const { entries } = await loadAnalysisEntries()
    const results = entries.filter((e) => e.available).map((e) => ({ id: e.id, label: e.title }))
    if (current === revision) {
      options.value = [...new Map(results.map((r) => [r.id, r])).values()]
      if (!results.length) notice.value = '暂无可用比赛，请先上传 Demo 并生成报告。'
    }
  } catch (e) {
    if (current === revision) error.value = errorMessage(e)
  } finally {
    if (current === revision) choicesLoading.value = false
  }
}
async function choose() {
  const current = revision,
    mine = ++selection,
    id = model.value.analysis_id
  model.value.snapshot = null
  if (!id) return
  selecting.value = true
  error.value = ''
  const mode = model.value.mode
  try {
    const raw = await downloadReport(id, () => {})
    if (raw.analysis_id !== id) throw new Error('报告编号不一致')
    const [events, detail] = await Promise.all([
      getReportEvents(raw.package_id, id),
      getReportDetails(id),
    ])
    if (
      events.package_id !== raw.package_id ||
      events.match_id !== raw.match_id ||
      detail.target_player_id !== raw.target_player_id ||
      detail.source.package_id !== raw.package_id
    )
      throw new Error('报告身份不一致')
    const report = reconcileCombat(raw, detail, events.events).report
    const basic = report.report.modules.basic_stats?.metrics
    const ai = mode === 'ai' ? normalizeAiReport(await getAiReport(id), id) : null
    if (mode === 'ai' && ai?.ai_status !== 'completed')
      throw new Error('请先在该场报告的 AI 教练页生成解读，再选择展示。')
    if (current !== revision || mine !== selection) return
    const strength = ai?.strengths?.[0]
    model.value.snapshot = {
      map: report.match.map,
      player_name: detail.target_player?.name || '分析玩家',
      kills: basic?.kills ?? null,
      deaths: basic?.deaths ?? null,
      adr: basic?.adr ?? null,
      ai_title: strength?.title || 'AI 本场点评',
      ai_excerpt: (strength?.explanation || ai?.summary || '').slice(0, 280),
    }
  } catch (e) {
    if (current === revision && mine === selection) error.value = errorMessage(e)
  } finally {
    if (current === revision && mine === selection) selecting.value = false
  }
}
async function save() {
  if (saving.value || selecting.value) return
  if (model.value.enabled && (!model.value.analysis_id || !model.value.snapshot)) {
    error.value = '请选择一场可用报告并等待预览完成。'
    return
  }
  const current = revision,
    account = owner.value
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    const result = await updateShowcase(model.value)
    if (current !== revision) return
    model.value = result
    published.value = result
    synced.value = true
    notice.value = result.enabled ? '展示内容已公开，可随时关闭。' : '公开展示已关闭。'
  } catch (e) {
    if (current !== revision) return
    if (unsupported(e)) {
      try {
        saveShowcaseDraft(account, model.value)
        notice.value = '已保存本机草稿；公开接口接入后才能同步给其他玩家。'
        synced.value = false
      } catch {
        error.value = '浏览器无法保存草稿，请检查存储空间或隐私设置。'
      }
    } else error.value = errorMessage(e)
  } finally {
    if (current === revision) saving.value = false
  }
}
watch(() => [owner.value, props.own], load, { immediate: true })
watch(
  () => model.value.enabled,
  (enabled) => {
    if (enabled && props.own) void loadChoices()
  },
)
</script>
<template>
  <section class="panel demo-showcase" aria-labelledby="demo-showcase-heading">
    <div class="demo-heading">
      <div>
        <div class="eyebrow">MATCH HIGHLIGHT</div>
        <h2 id="demo-showcase-heading">Demo 分析档案</h2>
      </div>
      <span class="tiny-tag">{{
        own && !synced ? '本机草稿' : visible.enabled ? '精选展示' : '未公开'
      }}</span>
    </div>
    <p v-if="loading" role="status">正在读取展示设置…</p>
    <template v-if="own">
      <label class="visibility-toggle"
        ><input
          v-model="model.enabled"
          type="checkbox"
          :disabled="saving"
          aria-label="公开 Demo 精选展示"
        />公开一场精选比赛</label
      >
      <p class="muted small-text">
        默认关闭；只展示你选择的简要数据或 AI 点评，原始 Demo 与完整私人报告不会公开。
      </p>
      <div class="showcase-controls">
        <label
          >展示比赛<select
            v-model="model.analysis_id"
            :disabled="saving"
            aria-label="展示比赛"
            @focus="loadChoices"
            @pointerdown="loadChoices"
            @change="choose"
          >
            <option :value="null">{{ choicesLoading ? '读取比赛中…' : '请选择比赛' }}</option>
            <option
              v-if="model.analysis_id && !options.some((o) => o.id === model.analysis_id)"
              :value="model.analysis_id"
            >
              已保存的精选比赛
            </option>
            <option v-for="o in options" :key="o.id" :value="o.id">{{ o.label }}</option>
          </select></label
        >
        <label
          >展示内容<select
            v-model="model.mode"
            :disabled="saving"
            aria-label="展示内容"
            @change="choose"
          >
            <option value="stats">本场华丽数据</option>
            <option value="ai">AI 高光点评</option>
          </select></label
        >
      </div>
      <p v-if="selecting" role="status">正在生成精选预览…</p>
    </template>
    <article v-if="visible.snapshot && (own || visible.enabled)" class="highlight-card">
      <p class="eyebrow">
        {{ mapName(visible.snapshot.map) }} · {{ visible.snapshot.player_name
        }}{{ own ? ' · 展示预览' : '' }}
      </p>
      <div v-if="visible.mode === 'stats'" class="highlight-stats">
        <div>
          <strong>{{ valueText(visible.snapshot.kills, 0) }}</strong
          ><span>击杀</span>
        </div>
        <div>
          <strong>{{ valueText(visible.snapshot.deaths, 0) }}</strong
          ><span>死亡</span>
        </div>
        <div>
          <strong>{{ valueText(visible.snapshot.adr) }}</strong
          ><span>ADR</span>
        </div>
      </div>
      <template v-else
        ><h3>{{ visible.snapshot.ai_title }}</h3>
        <p>{{ visible.snapshot.ai_excerpt }}</p></template
      >
    </article>
    <p v-else-if="!own && !loading" class="muted">这位玩家尚未公开精选比赛。</p>
    <p v-if="error" role="alert" class="error-text">{{ error }}</p>
    <p v-if="notice && own" role="status" class="muted small-text">{{ notice }}</p>
    <button
      v-if="own"
      class="button primary compact"
      :disabled="saving || selecting || loading"
      @click="save"
    >
      {{ saving ? '保存中…' : synced ? '保存展示设置' : '保存精选草稿' }}
    </button>
  </section>
</template>
<style scoped>
.demo-showcase {
  padding: 26px;
  display: grid;
  gap: 18px;
  min-width: 0;
}
.demo-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.eyebrow {
  font-size: 10px;
  margin: 0 0 8px;
}
.visibility-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
}
.visibility-toggle input {
  width: 16px;
  height: 16px;
  accent-color: var(--orange);
}
.showcase-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: end;
}
.showcase-controls label {
  display: grid;
  gap: 8px;
  flex: 1 1 180px;
  font-size: 12px;
  min-width: 0;
}
.showcase-controls select {
  max-width: 100%;
}
.highlight-card {
  padding: 22px;
  border: 1px solid #61503b;
  border-radius: 10px;
  background: linear-gradient(130deg, #2d2821, #1a2429);
  overflow-wrap: anywhere;
}
.highlight-card h3 {
  color: #f1c79c;
  font-size: 17px;
}
.highlight-card p {
  line-height: 1.8;
}
.highlight-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
}
.highlight-stats div {
  display: grid;
  gap: 8px;
}
.highlight-stats strong {
  font-size: 28px;
  color: #f1c79c;
  font-variant-numeric: tabular-nums;
}
.highlight-stats span {
  font-size: 12px;
  color: var(--muted);
}
.demo-showcase > button {
  justify-self: start;
}
</style>
