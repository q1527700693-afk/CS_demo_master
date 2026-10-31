<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AsyncState from '@/components/AsyncState.vue'
import AppIcon from '@/components/AppIcon.vue'
import { mockModules } from '@/app/config'
import { isDesktopRuntime } from '@/app/runtime'
import { isCloudAnalysis } from './cloud-api'
import { analysisName } from './analysis-name'
import { loadAnalysisEntries } from './analysis-entries'
import { useUploadTask } from './upload-task'
import { useReplayReport } from './useReplayReport'
import {
  mapName,
  metricDefinitions,
  reviewTabs,
  valueText,
  type ReviewFocus,
  type ReviewTab,
} from './review-presentation'
import { moduleLabels } from './report-data'
import type { ReplayEvent } from './contracts'
import ReviewOverview from './ReviewOverview.vue'
import ReviewRounds from './ReviewRounds.vue'
import ReviewUtility from './ReviewUtility.vue'
import ReviewAi from './ReviewAi.vue'
import ReviewData from './ReviewData.vue'
import MetricHint from './MetricHint.vue'
import './review.css'
const route = useRoute(),
  router = useRouter()
const {
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
} = useReplayReport()
const active = ref<ReviewTab>('overview'),
  selectedRound = ref(1),
  selectedFocus = ref<ReviewFocus | null>(null)
const menu = ref<HTMLDetailsElement>(),
  info = ref<HTMLDetailsElement>()
async function showInfo() {
  if (menu.value) menu.value.open = false
  await setTab('data')
  await nextTick()
  if (info.value) {
    info.value.open = true
    info.value.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}
const uploadTask = useUploadTask()
const selectedTarget = ref('')
const reportSequence = ref<number>()
watch(
  () => report.value?.analysis_id,
  async (id, _previous, cleanup) => {
    let active = true
    cleanup(() => (active = false))
    reportSequence.value = undefined
    if (!id) return
    try {
      const { entries } = await loadAnalysisEntries()
      if (active) reportSequence.value = entries.find((item) => item.id === id)?.sequence
    } catch {
      /* Reports remain readable if history is temporarily unavailable. */
    }
  },
  { immediate: true },
)
const reportTitle = computed(() =>
  report.value
    ? analysisName(
        details.value?.target_player?.name || report.value.target_player_id,
        report.value.match.map,
        reportSequence.value,
      )
    : '',
)
const otherPlayers = computed(() => [
  ...new Map(
    (details.value?.players || [])
      .filter((p) => p.player_id !== report.value?.target_player_id)
      .map((p) => [p.player_id, p]),
  ).values(),
])
async function analyzePlayer() {
  if (!report.value || !selectedTarget.value) return
  const cloud = isCloudAnalysis(report.value.analysis_id)
  const target = selectedTarget.value
  const file = details.value?.source.demo?.file_name || ''
  if (cloud && !isDesktopRuntime())
    await router.push({ path: '/replays/new', query: { target, source: report.value.analysis_id } })
  else await router.push({ path: '/replays/new', query: { target, file } })
}
const player = computed(() => details.value?.target_player?.name || '分析对象')
const basic = computed(() => report.value?.report.modules.basic_stats?.metrics)
const ownTeam = computed(() =>
  report.value?.match.teams.find((t) => t.team_id === report.value?.perspective.player_team_id),
)
const otherTeam = computed(() =>
  report.value?.match.teams.find((t) => t.team_id !== report.value?.perspective.player_team_id),
)
const overviewCards = computed(() => [
  {
    label: '击杀 / 死亡 / 助攻',
    value: [basic.value?.kills, basic.value?.deaths, basic.value?.assists]
      .map((v) => valueText(v, 0))
      .join(' / '),
    note: '本场个人表现',
    description: '分析玩家在已记录回合中的击杀、死亡和助攻总数。',
    progress: null,
  },
  {
    label: '场均伤害',
    value: valueText(basic.value?.adr),
    note: '每回合有效伤害',
    description: metricDefinitions.adr,
    progress: null,
  },
  {
    label: '贡献回合率',
    value: basic.value?.kast_pct == null ? '—' : `${valueText(basic.value.kast_pct)}%`,
    note: '击杀、助攻、存活或被补枪',
    description: metricDefinitions.kast_pct,
    progress: basic.value?.kast_pct,
  },
  {
    label: '爆头率',
    value: basic.value?.headshot_pct == null ? '—' : `${valueText(basic.value.headshot_pct)}%`,
    note: '爆头击杀占比',
    description: metricDefinitions.headshot_pct,
    progress: basic.value?.headshot_pct,
  },
])
function setTab(id: ReviewTab) {
  active.value = id
  return router.replace({ hash: `#${id}` })
}
function selectRound(round: number, focus: ReviewFocus | null = null) {
  if (!rows.value.some((r) => r.round_num === round)) return
  selectedRound.value = round
  selectedFocus.value = focus
  setTab('rounds')
}
function selectFocus(f: ReviewFocus) {
  if (f.round != null) selectRound(f.round, f)
}
function selectEvent(e: ReplayEvent) {
  if (e.round_num != null)
    selectRound(e.round_num, {
      id: e.event_id,
      rule: 'event',
      round: e.round_num,
      tick: e.tick,
      seconds: e.live_elapsed_seconds ?? null,
      title: '比赛事件',
      observation: '',
      action: '',
      evidenceIds: [e.event_id],
      priority: 0,
    })
}
const completedModules = computed(() =>
  Object.entries(report.value?.report.modules || {})
    .filter(([, m]) => m.metrics && Object.values(m.metrics).some((v) => v != null))
    .map(([key]) => moduleLabels[key])
    .filter(Boolean),
)
watch(
  () => route.hash,
  (hash) => {
    const aliases: Record<string, ReviewTab> = {
      '#report-map': 'rounds',
      '#report-modules': 'utility',
      '#report-findings': 'utility',
      '#report-events': 'data',
      '#report-performance': 'overview',
    }
    active.value = aliases[hash] || reviewTabs.find((t) => `#${t.id}` === hash)?.id || 'overview'
  },
  { immediate: true },
)
watch(
  () => report.value?.analysis_id,
  () => {
    selectedFocus.value = null
    selectedRound.value = 1
  },
)
watch(rows, (value) => {
  if (value.length && !value.some((r) => r.round_num === selectedRound.value))
    selectedRound.value = value[0]!.round_num
})
</script>
<template>
  <div class="review-dashboard">
    <AsyncState :loading="loading" :error="error" @retry="load"
      ><template v-if="report">
        <div class="review-topline">
          <RouterLink to="/replays" class="back-link">← 我的复盘</RouterLink>
          <div class="report-actions">
            <button class="review-text-button" @click="exportReport">
              <AppIcon name="download" :size="14" />导出报告
            </button>
            <details ref="menu" class="more-menu">
              <summary aria-label="更多报告操作">•••</summary>
              <div>
                <button :disabled="retrying" @click="reanalyze">重新分析</button
                ><button @click="showInfo">数据说明与历史</button>
              </div>
            </details>
          </div>
        </div>
        <p v-if="mockModules.replay" class="sample-caption">演示数据</p>
        <header class="match-header">
          <div class="match-identity">
            <div class="map-emblem"><AppIcon name="map" :size="28" /></div>
            <div>
              <p class="match-caption">比赛复盘 <span>／</span> {{ mapName(report.match.map) }}</p>
              <h1 class="analysis-title">{{ reportTitle }}</h1>
              <p class="match-subline">{{ rows.length || '—' }} 个已记录回合</p>
            </div>
          </div>
          <div v-if="ownTeam && otherTeam" class="match-score">
            <div>
              <span>{{ /^队伍/.test(ownTeam.name) ? '我方' : ownTeam.name }}</span
              ><strong>{{ ownTeam.score ?? '—' }}</strong>
            </div>
            <span class="score-divider">:</span>
            <div>
              <span>{{ /^队伍/.test(otherTeam.name) ? '对方' : otherTeam.name }}</span
              ><strong class="opponent-score">{{ otherTeam.score ?? '—' }}</strong>
            </div>
            <small>{{
              isCloudAnalysis(report.analysis_id)
                ? '按阵营记录胜局'
                : report.match.complete
                  ? '最终比分'
                  : '记录比分'
            }}</small>
          </div>
        </header>
        <section
          v-if="report && isCloudAnalysis(report.analysis_id) && otherPlayers.length"
          class="review-panel perspective-picker"
        >
          <div>
            <strong>同一 Demo，换个视角复盘</strong>
            <p class="muted small-text">为其他玩家新建独立分析，当前报告和历史记录均保留。</p>
          </div>
          <select v-model="selectedTarget" aria-label="分析其他玩家">
            <option value="" disabled>选择另一位玩家</option>
            <option v-for="p in otherPlayers" :key="p.player_id" :value="p.player_id">
              {{ p.name }} · {{ p.player_id }}
            </option>
          </select>
          <button
            class="button primary compact"
            :disabled="!selectedTarget || uploadTask.busy"
            @click="analyzePlayer"
          >
            新建该玩家的分析
          </button>
        </section>
        <div v-if="rows.length" class="round-strip-panel">
          <div class="round-strip-heading">
            <span>回合走势 <small>点击回合进入地图</small></span>
            <div>
              <i class="win-dot" />获胜<i class="loss-dot" />失利
              <template v-if="rows.some((round) => round.outcome === '未知')">
                <i class="unknown-dot" />未记录
              </template>
            </div>
          </div>
          <div class="round-strip" aria-label="回合胜负时间线">
            <button
              v-for="(r, index) in rows"
              :key="r.round_num"
              :data-outcome="r.outcome"
              :class="{
                chosen: active === 'rounds' && selectedRound === r.round_num,
                halftime:
                  index > 0 &&
                  r.target_side &&
                  rows[index - 1]?.target_side &&
                  rows[index - 1]?.target_side !== r.target_side,
              }"
              :aria-label="`第 ${r.round_num} 回合，${r.outcome === '胜' ? '获胜' : r.outcome === '负' ? '失利' : '结果未记录'}，${valueText(r.stats.kills, 0)} 击杀`"
              :title="`第 ${r.round_num} 回合 · ${valueText(r.stats.kills, 0)} 击杀`"
              @click="selectRound(r.round_num)"
            >
              <span>{{ r.round_num }}</span
              ><strong>{{ r.outcome === '胜' ? '✓' : r.outcome === '负' ? '−' : '·' }}</strong
              ><i :class="{ multi: (r.stats.kills ?? 0) >= 2 }">{{
                (r.stats.kills ?? 0) >= 2 ? `${r.stats.kills}杀` : ''
              }}</i>
            </button>
          </div>
        </div>
        <nav class="review-tabs" aria-label="报告视图">
          <button
            v-for="tab in reviewTabs"
            :key="tab.id"
            :aria-current="active === tab.id ? 'page' : undefined"
            @click="setTab(tab.id)"
          >
            <AppIcon :name="tab.icon" :size="16" />{{ tab.label
            }}<span v-if="tab.id === 'utility' && focuses.length">{{ focuses.length }}</span>
          </button>
        </nav>
        <p v-if="actionError" role="alert" class="review-alert">{{ actionError }}</p>
        <div v-if="detailsError || eventsError" role="alert" class="review-alert">
          {{ detailsError ? '回合详情读取失败' : '事件记录读取失败' }}，已保留可用统计。<button
            class="review-text-button"
            @click="load"
          >
            重新读取
          </button>
        </div>
        <template v-if="active === 'overview'"
          ><div class="review-metrics metric-cards">
            <article v-for="card in overviewCards" :key="card.label" class="review-metric">
              <div>
                <span>{{ card.label }}</span
                ><MetricHint :label="card.label" :text="card.description || ''" />
              </div>
              <strong>{{ card.value }}</strong
              ><small>{{ card.note }}</small>
              <div v-if="card.progress != null" class="metric-track">
                <i :style="{ width: `${Math.max(0, Math.min(100, card.progress))}%` }" />
              </div>
            </article>
          </div>
          <ReviewOverview
            :report="report"
            :details="details"
            :focuses="focuses"
            @round="selectRound"
            @focus="selectFocus"
            @all-focus="setTab('utility')"
        /></template>
        <template v-else-if="active === 'rounds'"
          ><ReviewRounds
            v-if="details"
            :key="report.analysis_id"
            :report="report"
            :details="details"
            :events="events"
            :focuses="focuses"
            :round="selectedRound"
            :focus="selectedFocus"
            @round="selectRound"
          />
          <section v-else class="review-panel review-empty">
            当前报告未提供回合地图数据。
          </section></template
        >
        <ReviewUtility
          v-else-if="active === 'utility'"
          :report="report"
          :details="details"
          :focuses="focuses"
          :events="events"
          :events-available="!eventsError"
          @focus="selectFocus"
        />
        <ReviewAi
          v-else-if="active === 'ai'"
          :ai="ai"
          :loading="aiLoading"
          :error="aiError"
          :legacy="!!details?.analysis_version && /^rules-1\.[01]\./.test(details.analysis_version)"
          :retrying="retrying"
          @reanalyze="reanalyze"
          @generate="generateAi"
        />
        <template v-else
          ><ReviewData
            :report="report"
            :details="details"
            :events="events"
            :events-error="eventsError"
            @round="selectRound"
            @event="selectEvent"
            @retry="load"
          />
          <details ref="info" id="report-info" class="review-panel report-info">
            <summary>数据说明与分析历史</summary>
            <div class="info-grid">
              <div>
                <h3>这份报告覆盖什么</h3>
                <p>{{ completedModules.join('、') }}。统计范围为当前分析玩家与相关比赛事件。</p>
                <p>
                  未记录的指标显示为“—”。反应时间、预瞄和综合评分尚未提供，页面不会生成推测分数。
                </p>
                <p>复盘重点描述已发生的事件；是否需要调整，结合该回合地图和团队安排判断。</p>
              </div>
              <div>
                <h3>当前报告</h3>
                <p>生成时间：{{ new Date(report.analyzed_at).toLocaleString('zh-CN') }}</p>
                <p>分析对象：{{ player }}</p>
                <p>
                  已记录 {{ rows.length }} 个回合{{
                    report.match.complete ? '，比赛完整。' : '；录像完整性未标记。'
                  }}
                </p>
                <button class="button secondary compact" :disabled="retrying" @click="reanalyze">
                  重新分析
                </button>
              </div>
            </div>
            <h3>分析历史</h3>
            <p v-if="historyError" class="error-text">历史暂不可用：{{ historyError }}</p>
            <div class="review-history">
              <div v-for="run in history" :key="run.analysis_id">
                <span>{{
                  run.created_at ? new Date(run.created_at).toLocaleString('zh-CN') : '时间未记录'
                }}</span
                ><RouterLink
                  v-if="run.report_available"
                  :to="`/replays/${run.analysis_id}`"
                  class="review-text-button"
                  >{{
                    run.analysis_id === report.analysis_id ? '当前报告' : '查看报告'
                  }}</RouterLink
                ><span v-else>{{ run.status === 'failed' ? '分析失败' : '正在处理' }}</span>
              </div>
            </div>
            <details class="technical-details">
              <summary>技术信息与原始提示</summary>
              <p>比赛编号：{{ report.match_id }}</p>
              <p>分析编号：{{ report.analysis_id }}</p>
              <p>分析包：{{ report.package_id }}</p>
              <p>规则版本：{{ report.versions.evaluation }}</p>
              <p v-for="warning in report.report.warnings" :key="warning">{{ warning }}</p>
            </details>
          </details></template
        >
      </template></AsyncState
    >
  </div>
</template>

<style scoped>
.analysis-title {
  font-size: clamp(19px, 2vw, 28px);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.perspective-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  margin-bottom: 20px;
}
.perspective-picker select {
  max-width: 100%;
  width: auto;
  flex: 1 1 240px;
}
</style>
