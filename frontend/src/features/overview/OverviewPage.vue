<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import ReplayTable from '@/components/ReplayTable.vue'
import AsyncState from '@/components/AsyncState.vue'
import { useAuthStore } from '@/stores/auth'
import { listReplays } from '@/features/replay/api'
import { useUploadTask } from '@/features/replay/upload-task'
import { isDesktopRuntime } from '@/app/runtime'
import { initialReports } from '@/mocks/data'
import { featureFlags, mockModules } from '@/app/config'
import { errorMessage } from '@/api/http'
import type { Replay } from '@/types'
import { trackStartup } from '@/app/startup-tasks'
const auth = useAuthStore(),
  uploadTask = useUploadTask()
const desktop = isDesktopRuntime()
const warnings = ref<string[]>([])
let generation = 0
let refreshTimer: ReturnType<typeof setTimeout> | undefined
const items = ref<Replay[]>([])
const loading = ref(false)
const error = ref('')
const completed = computed(() => items.value.filter((x) => x.status === 'completed'))
const average = (key: 'rating' | 'adr') => {
  const rows = completed.value.filter((row) => row[key] !== null)
  return rows.length ? rows.reduce((sum, row) => sum + row[key]!, 0) / rows.length : null
}
const scoredMatches = computed(() => completed.value.filter((x) => x.scoreKnown !== false))
const winRate = computed(() =>
  scoredMatches.value.length
    ? Math.round(
        (scoredMatches.value.filter((x) => x.score[0] > x.score[1]).length /
          scoredMatches.value.length) *
          100,
      )
    : null,
)
const metrics = computed(() => [
  {
    label: '已复盘对局',
    value: String(completed.value.length).padStart(2, '0'),
    unit: '场',
    icon: 'replay',
    detail: '把每一场经验留下来',
  },
  {
    label: '平均 Rating',
    value: average('rating')?.toFixed(2) ?? '—',
    unit: '',
    icon: 'bolt',
    detail: '综合战斗表现',
  },
  {
    label: '平均 ADR',
    value: average('adr')?.toFixed(1) ?? '—',
    unit: '',
    icon: 'target',
    detail: '每回合平均伤害',
  },
  {
    label: '对局胜率',
    value: winRate.value?.toString() ?? '—',
    unit: '%',
    icon: 'shield',
    detail: '来自已完成复盘',
  },
])
async function load() {
  const current = ++generation
  error.value = ''
  warnings.value = []
  if (!featureFlags.replay || !auth.user) {
    items.value = featureFlags.replay && mockModules.replay ? initialReports : []
    loading.value = false
    return
  }
  loading.value = true
  try {
    const result = await listReplays()
    if (current !== generation) return
    items.value = result.items
    warnings.value = result.warnings
    if (!result.items.length && result.warnings.length) error.value = result.warnings.join('；')
  } catch (e) {
    if (current === generation) error.value = errorMessage(e)
  } finally {
    if (current === generation) loading.value = false
  }
}
function refreshVisible() {
  if (document.visibilityState === 'hidden') return
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => void load(), 50)
}
onMounted(() => {
  trackStartup(load())
  window.addEventListener('focus', refreshVisible)
  window.addEventListener('replays:changed', refreshVisible)
  document.addEventListener('visibilitychange', refreshVisible)
})
onUnmounted(() => {
  generation++
  clearTimeout(refreshTimer)
  window.removeEventListener('focus', refreshVisible)
  window.removeEventListener('replays:changed', refreshVisible)
  document.removeEventListener('visibilitychange', refreshVisible)
})
watch(
  () => auth.user?.id,
  () => {
    items.value = []
    void load()
  },
)
watch(
  () => uploadTask.busy,
  (busy, previous) => {
    if (previous && !busy) void load()
  },
)
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">YOUR NEXT ROUND STARTS HERE</div>
      <h1>
        {{ auth.user ? `欢迎回来，${auth.user.nickname}` : '把上一场，变成下一场的优势'
        }}<span class="orange">.</span>
      </h1>
      <p>看懂关键回合，找到训练方向，和对的人一起上场。</p>
    </div>
    <RouterLink v-if="featureFlags.replay" to="/replays/new" class="button primary"
      ><AppIcon name="plus" :size="18" />新建复盘</RouterLink
    >
  </section>
  <section class="hero-panel">
    <div class="hero-copy">
      <div class="eyebrow">REVIEW. PRACTICE. REPEAT.</div>
      <h2>打得更多，<br />也要<span>看得更清楚。</span></h2>
      <p>
        从一份对局数据开始，回看交火、经济与道具，<br class="desktop-break" />让下一次练习有的放矢。
      </p>
      <RouterLink v-if="featureFlags.replay" to="/replays/new" class="button primary"
        >开始我的复盘 <AppIcon name="arrow" :size="18"
      /></RouterLink>
      <div class="hero-footnote">
        <AppIcon name="shield" :size="14" />
        {{ desktop ? '原始录像留在本地 · 报告默认私有' : '云端解析 Demo · 报告默认私有' }}
      </div>
    </div>
    <div class="hero-radar" aria-hidden="true">
      <div class="radar-grid" />
      <div class="radar-ring ring-one" />
      <div class="radar-ring ring-two" />
      <div class="radar-ring ring-three" />
      <div class="radar-scan" />
      <div class="radar-axis axis-x" />
      <div class="radar-axis axis-y" />
      <div class="radar-center"><AppIcon name="crosshair" :size="40" /></div>
      <i class="radar-dot dot-one" /><i class="radar-dot dot-two" /><i
        class="radar-dot dot-three"
      />
      <div class="radar-label label-a">A · EXECUTE</div>
      <div class="radar-label label-b">MID CONTROL</div>
      <span class="radar-caption">MATCH INTELLIGENCE / 01</span>
    </div>
  </section>
  <AsyncState v-if="featureFlags.replay" :loading="loading" :error="error" @retry="load"
    ><div class="section-heading">
      <h2>
        状态一览 <span v-if="!auth.user && mockModules.replay" class="inline-hint">示例对局</span>
      </h2>
      <span class="muted small-text">{{ completed.length }} 场已完成分析</span>
    </div>
    <section class="metrics-grid">
      <article v-for="metric in metrics" :key="metric.label" class="metric">
        <div class="metric-top">
          <span>{{ metric.label }}</span
          ><AppIcon :name="metric.icon" :size="17" />
        </div>
        <div class="metric-value">
          {{ metric.value }}<small>{{ metric.unit }}</small>
        </div>
        <p>{{ metric.detail }}</p>
      </article>
    </section>
    <p v-for="warning in warnings" :key="warning" class="muted small-text" role="status">
      {{ warning }}
    </p>
    <section class="panel recent-panel">
      <div class="panel-heading">
        <div>
          <h2>最近的复盘</h2>
          <p>每一场比赛，都值得再看一眼。</p>
        </div>
        <button
          class="button secondary compact"
          :disabled="loading"
          aria-label="刷新最近复盘"
          @click="load"
        >
          刷新
        </button>
        <RouterLink to="/replays" class="text-link"
          >全部对局 <AppIcon name="arrow" :size="16"
        /></RouterLink>
      </div>
      <ReplayTable :items="items.slice(0, 3)" /></section
  ></AsyncState>
  <div v-if="featureFlags.training || featureFlags.lobby" class="quick-grid">
    <RouterLink v-if="featureFlags.training" to="/training" class="quick-link"
      ><div class="quick-icon"><AppIcon name="crosshair" :size="26" /></div>
      <div>
        <span class="eyebrow">WARM UP</span>
        <h3>先练一组，再上场。</h3>
        <p>浏览器即开的定位与反应训练</p>
      </div>
      <AppIcon name="up" /></RouterLink
    ><RouterLink v-if="featureFlags.lobby" to="/lobbies" class="quick-link"
      ><div class="quick-icon green"><AppIcon name="users" :size="26" /></div>
      <div>
        <span class="eyebrow">FIND YOUR FIVE</span>
        <h3>下一场，一起打。</h3>
        <p>找到校园里与你默契的队友</p>
      </div>
      <AppIcon name="up"
    /></RouterLink>
  </div>
</template>
