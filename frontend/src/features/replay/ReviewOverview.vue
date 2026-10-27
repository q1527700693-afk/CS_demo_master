<script setup lang="ts">
import { computed } from 'vue'
import type { AnalysisReport, ReplayDetails } from './contracts'
import { roundRows } from './report-data'
import { valueText, weaponName, metricDefinitions, type ReviewFocus } from './review-presentation'
import ReportChart from './ReportChart.vue'
import ReviewFocusList from './ReviewFocusList.vue'
const props = defineProps<{
  report: AnalysisReport
  details: ReplayDetails | null
  focuses: ReviewFocus[]
}>()
defineEmits<{ round: [round: number]; focus: [focus: ReviewFocus]; allFocus: [] }>()
const rows = computed(() => (props.details ? roundRows(props.details) : []))
const basic = computed(() => props.report.report.modules.basic_stats?.metrics)
const weapons = computed(() =>
  [...(props.details?.statistics.tables?.by_weapon || [])]
    .filter((w) => (w.kills ?? 0) > 0)
    .sort((a, b) => (b.kills ?? 0) - (a.kills ?? 0))
    .slice(0, 5),
)
const sideStats = computed(() =>
  ['counter-terrorist', 'terrorist'].map((side) => {
    const rs = rows.value.filter((r) => r.target_side === side)
    return {
      side,
      name: side === 'terrorist' ? '进攻方' : '防守方',
      rounds: rs.length,
      wins: rs.filter((r) => r.outcome === '胜').length,
      kills:
        rs.length && rs.every((r) => r.stats.kills != null)
          ? rs.reduce((n, r) => n + r.stats.kills!, 0)
          : null,
      deaths:
        rs.length && rs.every((r) => r.stats.deaths != null)
          ? rs.reduce((n, r) => n + r.stats.deaths!, 0)
          : null,
    }
  }),
)
const common = {
  backgroundColor: 'transparent',
  textStyle: { color: '#96a4af', fontFamily: 'Microsoft YaHei, sans-serif' },
  tooltip: { trigger: 'axis', renderMode: 'richText' },
  grid: { left: 36, right: 15, top: 34, bottom: 30 },
  xAxis: {
    type: 'category',
    data: [] as number[],
    axisLine: { lineStyle: { color: '#34404a' } },
    axisTick: { show: false },
  },
  yAxis: {
    type: 'value',
    minInterval: 1,
    splitLine: { lineStyle: { color: '#28323a', type: 'dashed' } },
  },
  legend: { top: 0, right: 0, textStyle: { color: '#a7b3be' }, itemWidth: 9, itemHeight: 9 },
}
const performance = computed(() => ({
  ...common,
  xAxis: {
    ...common.xAxis,
    name: '回合',
    nameLocation: 'middle',
    nameGap: 24,
    data: rows.value.map((r) => r.round_num),
  },
  series: [
    {
      name: '击杀',
      type: 'bar',
      barMaxWidth: 16,
      itemStyle: { color: '#8dbbb1', borderRadius: [3, 3, 0, 0] },
      data: rows.value.map((r) => r.stats.kills ?? null),
    },
    {
      name: '死亡',
      type: 'bar',
      barMaxWidth: 8,
      itemStyle: { color: '#b47b7e', borderRadius: [2, 2, 0, 0] },
      data: rows.value.map((r) => r.stats.deaths ?? null),
    },
  ],
}))
const economy = computed(() => ({
  ...common,
  xAxis: { ...common.xAxis, data: rows.value.map((r) => r.round_num) },
  yAxis: { ...common.yAxis, axisLabel: { formatter: (v: number) => `${v / 1000}千` } },
  series: [
    {
      name: '我方装备',
      type: 'line',
      symbolSize: 4,
      lineStyle: { width: 2 },
      itemStyle: { color: '#edb078' },
      areaStyle: { color: '#edb078', opacity: 0.07 },
      data: rows.value.map((r) => r.ownEconomy),
      connectNulls: false,
    },
    {
      name: '对方装备',
      type: 'line',
      symbolSize: 4,
      lineStyle: { width: 2, type: 'dashed' },
      itemStyle: { color: '#839abf' },
      data: rows.value.map((r) => r.enemyEconomy),
      connectNulls: false,
    },
  ],
}))
</script>
<template>
  <div class="overview-grid">
    <section class="review-panel performance-panel">
      <header class="review-section-heading">
        <div>
          <h2>回合影响力</h2>
          <p>击杀与阵亡分布 · 点击回合进入地图</p>
        </div>
        <span class="subtle-tag">{{ rows.length }} 回合</span>
      </header>
      <div class="impact-summary">
        <div :title="metricDefinitions.opening">
          <span>首杀 / 首死</span
          ><strong
            >{{ valueText(basic?.opening_kills, 0) }}
            <i>/ {{ valueText(basic?.opening_deaths, 0) }}</i></strong
          >
        </div>
        <div>
          <span>多杀回合</span
          ><strong>{{ rows.filter((r) => (r.stats.kills ?? 0) >= 2).length }} <i>回合</i></strong>
        </div>
        <div>
          <span>存活回合</span
          ><strong
            >{{ rows.filter((r) => r.stats.deaths === 0).length }}
            <i>/ {{ rows.length }}</i></strong
          >
        </div>
      </div>
      <ReportChart
        v-if="rows.length"
        :option="performance"
        label="逐回合击杀与死亡"
        @select="$emit('round', $event)"
      />
      <p v-else class="review-empty">逐回合统计尚未提供。</p>
    </section>
    <section class="review-panel focus-panel">
      <header class="review-section-heading">
        <div>
          <h2>优先复盘</h2>
          <p>已记录的事件，直接定位回合</p>
        </div>
        <span class="subtle-tag">{{ focuses.length }} 处</span>
      </header>
      <ReviewFocusList :items="focuses.slice(0, 3)" compact @select="$emit('focus', $event)" />
      <button
        v-if="focuses.length"
        class="review-text-button full-width"
        @click="$emit('allFocus')"
      >
        查看全部复盘重点 <span>→</span>
      </button>
    </section>
    <section class="review-panel economy-panel">
      <header class="review-section-heading">
        <div>
          <h2>双方经济走势</h2>
          <p>每回合开始时的队伍装备价值 · 游戏币</p>
        </div>
      </header>
      <ReportChart
        v-if="rows.length"
        :option="economy"
        label="双方每回合装备价值折线图"
        @select="$emit('round', $event)"
      />
      <p v-else class="review-empty">经济数据尚未提供。</p>
    </section>
    <section class="review-panel">
      <header class="review-section-heading">
        <div>
          <h2>攻防表现</h2>
          <p>按每回合实际阵营统计</p>
        </div>
      </header>
      <div v-for="side in sideStats" :key="side.side" class="side-summary" :class="side.side">
        <div>
          <span class="side-dot" />{{ side.name }}<small>{{ side.rounds }} 回合</small>
        </div>
        <strong
          >{{ valueText(side.kills, 0) }} / {{ valueText(side.deaths, 0)
          }}<small>击杀 / 死亡</small></strong
        >
        <div class="side-track">
          <span :style="{ width: `${side.rounds ? (side.wins / side.rounds) * 100 : 0}%` }" />
        </div>
        <small>{{ side.wins }} 回合获胜</small>
      </div>
      <div class="weapon-heading">主要击杀武器</div>
      <div v-for="w in weapons.slice(0, 3)" :key="w.weapon" class="weapon-bar">
        <span>{{ weaponName(w.weapon) }}</span>
        <div>
          <i
            :style="{ width: `${((w.kills || 0) / Math.max(1, weapons[0]?.kills || 1)) * 100}%` }"
          />
        </div>
        <strong>{{ w.kills }}</strong>
      </div>
    </section>
  </div>
</template>
<style scoped>
.overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr);
  gap: 18px;
}
.impact-summary {
  display: flex;
  gap: 36px;
  padding: 3px 0 20px;
}
.impact-summary > div {
  display: grid;
  gap: 7px;
}
.impact-summary span {
  font-size: 11px;
  color: #9aa8b3;
}
.impact-summary strong {
  font-size: 24px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.impact-summary i {
  font-style: normal;
  font-size: 13px;
  color: #758591;
  font-weight: 400;
}
.review-text-button {
  margin-top: 12px;
}
.side-summary {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px 16px;
  margin-bottom: 20px;
  font-size: 13px;
}
.side-summary > div:first-child {
  display: flex;
  align-items: center;
  gap: 8px;
}
.side-summary small {
  font-size: 11px;
  color: #84939f;
}
.side-summary strong {
  text-align: right;
  font-weight: 500;
}
.side-summary strong small {
  display: block;
  margin-top: 3px;
}
.side-dot {
  width: 7px;
  height: 7px;
  background: #8eb5d2;
  border-radius: 50%;
}
.terrorist .side-dot {
  background: #d7af78;
}
.side-track {
  height: 4px;
  background: #29333b;
  align-self: center;
  border-radius: 3px;
  overflow: hidden;
}
.side-track span {
  display: block;
  height: 100%;
  background: #8eb5d2;
}
.terrorist .side-track span {
  background: #d7af78;
}
.weapon-heading {
  padding-top: 15px;
  border-top: 1px solid var(--line);
  margin: 5px 0 16px;
  font-size: 12px;
  color: #9babb7;
}
.weapon-bar {
  display: grid;
  grid-template-columns: 90px 1fr 24px;
  align-items: center;
  gap: 12px;
  margin: 14px 0;
  font-size: 12px;
}
.weapon-bar > div {
  background: #26313a;
  height: 5px;
  border-radius: 3px;
  overflow: hidden;
}
.weapon-bar i {
  display: block;
  height: 100%;
  background: #869da9;
}
.weapon-bar strong {
  text-align: right;
  font-weight: 500;
}
@media (max-width: 1100px) {
  .overview-grid {
    grid-template-columns: minmax(0, 1.4fr) minmax(250px, 1fr);
  }
  .impact-summary {
    gap: 20px;
  }
}
@media (max-width: 850px) {
  .overview-grid {
    grid-template-columns: 1fr;
  }
  .focus-panel {
    grid-row: 2;
  }
  .impact-summary {
    gap: 30px;
  }
}
</style>
