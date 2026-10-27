<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AnalysisReport, ReplayDetails, ReplayEvent } from './contracts'
import { eventLabels, roundRows } from './report-data'
import {
  clockText,
  eventSentence,
  metricDefinitions,
  valueText,
  weaponName,
  sideName,
} from './review-presentation'
const props = defineProps<{
  report: AnalysisReport
  details: ReplayDetails | null
  events: ReplayEvent[]
  eventsError: string
}>()
defineEmits<{ round: [round: number]; event: [event: ReplayEvent]; retry: [] }>()
const rows = computed(() => (props.details ? roundRows(props.details) : []))
const weapons = computed(() =>
  [...(props.details?.statistics.tables?.by_weapon || [])].sort(
    (a, b) => (b.kills ?? 0) - (a.kills ?? 0),
  ),
)
const eventRound = ref('all'),
  eventType = ref('all'),
  search = ref(''),
  page = ref(1),
  focused = ref<ReplayEvent | null>(null)
const types = computed(() => [...new Set(props.events.map((e) => e.type))].sort())
const filtered = computed(() =>
  props.events
    .filter(
      (e) =>
        (eventRound.value === 'all' || String(e.round_num) === eventRound.value) &&
        (eventType.value === 'all' || e.type === eventType.value) &&
        (!search.value.trim() ||
          `${eventSentence(e)} ${e.event_id}`
            .toLowerCase()
            .includes(search.value.trim().toLowerCase())),
    )
    .sort((a, b) => a.tick - b.tick),
)
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 20)))
const visible = computed(() => filtered.value.slice((page.value - 1) * 20, page.value * 20))
watch([eventRound, eventType, search], () => {
  page.value = 1
  focused.value = null
})
</script>
<template>
  <section class="review-panel data-panel">
    <header class="review-section-heading">
      <div>
        <h2>逐回合统计</h2>
        <p>点击回合进入战术地图；空值表示该项未记录</p>
      </div>
    </header>
    <div class="table-scroll">
      <table class="review-table" data-testid="round-table">
        <thead>
          <tr>
            <th>回合</th>
            <th>阵营</th>
            <th>结果</th>
            <th>击杀</th>
            <th>死亡</th>
            <th>助攻</th>
            <th :title="metricDefinitions.raw_damage">原始伤害 ⓘ</th>
            <th>我方装备</th>
            <th>对方装备</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.round_num">
            <td>
              <button class="review-text-button" @click="$emit('round', r.round_num)">
                第 {{ r.round_num }} 回合 ↗
              </button>
            </td>
            <td>{{ sideName(r.target_side) }}</td>
            <td :class="r.outcome === '胜' ? 'win-text' : 'loss-text'">
              {{ r.outcome === '未知' ? '—' : r.outcome }}
            </td>
            <td>{{ valueText(r.stats.kills, 0) }}</td>
            <td>{{ valueText(r.stats.deaths, 0) }}</td>
            <td>{{ valueText(r.stats.assists, 0) }}</td>
            <td>{{ valueText(r.stats.raw_health_damage_dealt, 0) }}</td>
            <td>{{ valueText(r.ownEconomy, 0) }}</td>
            <td>{{ valueText(r.enemyEconomy, 0) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="data-footnote">原始伤害包含过量伤害，不等同于场均有效伤害。装备价值单位为游戏币。</p>
  </section>
  <details class="review-panel data-panel weapon-details">
    <summary>
      武器明细 <span>{{ weapons.length }} 种</span>
    </summary>
    <div class="table-scroll">
      <table class="review-table" data-testid="weapon-table">
        <thead>
          <tr>
            <th>武器</th>
            <th>击杀</th>
            <th>被该武器击杀</th>
            <th>使用次数</th>
            <th>原始伤害</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="w in weapons" :key="w.weapon">
            <td>{{ weaponName(w.weapon) }}</td>
            <td>{{ valueText(w.kills, 0) }}</td>
            <td>{{ valueText(w.deaths, 0) }}</td>
            <td>{{ valueText(w.shots, 0) }}</td>
            <td>{{ valueText(w.raw_health_damage_dealt, 0) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="data-footnote">使用次数为开火或投掷事件数，不能直接用于计算命中率。</p>
  </details>
  <section class="review-panel data-panel" id="report-events">
    <header class="review-section-heading">
      <div>
        <h2>事件记录</h2>
        <p>按回合、类型或玩家检索；可跳转地图</p>
      </div>
      <span class="subtle-tag">{{ filtered.length }} 条</span>
    </header>
    <p v-if="eventsError" role="alert" class="error-text">
      事件加载失败：{{ eventsError }}
      <button class="review-text-button" @click="$emit('retry')">重试</button>
    </p>
    <div class="event-filters">
      <label
        >回合<select v-model="eventRound" aria-label="事件回合">
          <option value="all">全部回合</option>
          <option v-for="r in rows" :key="r.round_num" :value="String(r.round_num)">
            第 {{ r.round_num }} 回合
          </option>
        </select></label
      ><label
        >类型<select v-model="eventType" aria-label="事件类型">
          <option value="all">全部事件</option>
          <option v-for="type in types" :key="type" :value="type">
            {{ eventLabels[type] || '其他事件' }}
          </option>
        </select></label
      ><label class="search-label"
        >搜索<input v-model="search" aria-label="搜索事件" placeholder="玩家、武器或事件编号"
      /></label>
    </div>
    <div class="table-scroll">
      <table class="review-table event-table" data-testid="event-table">
        <thead>
          <tr>
            <th>回合</th>
            <th>时间</th>
            <th>类型</th>
            <th>事件</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="event in visible" :key="event.event_id">
            <td>{{ event.round_num ?? '—' }}</td>
            <td>{{ clockText(event.live_elapsed_seconds) }}</td>
            <td>{{ eventLabels[event.type] || '其他事件' }}</td>
            <td>{{ eventSentence(event) }}</td>
            <td>
              <button
                class="review-text-button"
                :disabled="event.round_num == null"
                @click="$emit('event', event)"
              >
                定位</button
              ><button class="review-text-button detail-button" @click="focused = event">
                详情
              </button>
            </td>
          </tr>
          <tr v-if="!visible.length">
            <td colspan="5">没有符合筛选条件的事件。</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="pagination">
      <button class="button secondary compact" :disabled="page <= 1" @click="page--">上一页</button
      ><span>第 {{ page }} / {{ pages }} 页</span
      ><button class="button secondary compact" :disabled="page >= pages" @click="page++">
        下一页
      </button>
    </div>
    <article v-if="focused" class="event-detail" data-testid="evidence-detail">
      <div>
        <h3>
          {{ eventLabels[focused.type] || '比赛事件' }} ·
          {{ clockText(focused.live_elapsed_seconds) }}
        </h3>
        <button class="review-text-button" @click="focused = null">收起</button>
      </div>
      <p>{{ eventSentence(focused) }}</p>
      <details>
        <summary>原始记录（用于核验）</summary>
        <p>事件编号：{{ focused.event_id }} · 游戏帧：{{ focused.tick }}</p>
        <pre>{{ JSON.stringify(focused.data, null, 2) }}</pre>
      </details>
    </article>
  </section>
</template>
<style scoped>
.data-panel {
  margin-bottom: 18px;
}
.table-scroll {
  overflow-x: auto;
  max-width: 100%;
  scrollbar-width: thin;
  scrollbar-color: #3f5260 transparent;
}
.review-table {
  width: 100%;
  white-space: nowrap;
  border-collapse: collapse;
}
.review-table th {
  font-size: 11px;
  background: #15212a;
  color: #8ea2b2;
  text-align: left;
  padding: 13px 14px;
  font-weight: 500;
}
.review-table td {
  font-size: 12px;
  padding: 13px 14px;
  border-bottom: 1px solid #2a3741;
  font-variant-numeric: tabular-nums;
  color: #b8c7d1;
}
.review-table tbody tr:hover {
  background: #202e39;
}
.review-table .win-text {
  color: #9cc6b1;
}
.review-table .loss-text {
  color: #c99696;
}
.data-footnote {
  font-size: 11px;
  color: #8295a4;
  margin-top: 14px;
}
.weapon-details summary {
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
}
.weapon-details summary span {
  font-size: 11px;
  color: #90a1ad;
  font-weight: 400;
  margin-left: 12px;
}
.weapon-details[open] summary {
  margin-bottom: 20px;
}
.event-filters {
  display: grid;
  grid-template-columns: 140px 160px 1fr;
  gap: 14px;
  margin: 20px 0;
}
.event-filters label {
  display: grid;
  gap: 7px;
  font-size: 11px;
  color: #8da0ad;
}
.event-filters select,
.event-filters input {
  padding: 9px 12px;
  font-size: 12px;
}
.event-table td:nth-child(4) {
  white-space: normal;
  min-width: 230px;
  line-height: 1.7;
}
.detail-button {
  margin-left: 14px;
  color: #92a8b8;
}
.pagination {
  display: flex;
  gap: 18px;
  align-items: center;
  justify-content: flex-end;
  margin-top: 20px;
  font-size: 12px;
  color: #91a5b4;
}
.event-detail {
  padding: 20px;
  margin-top: 20px;
  border: 1px solid #455669;
  background: #162430;
  border-radius: 8px;
}
.event-detail > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.event-detail h3 {
  font-size: 14px;
}
.event-detail p {
  font-size: 12px;
  margin-top: 8px;
}
.event-detail details {
  font-size: 11px;
  color: #8dabbf;
  margin-top: 16px;
}
.event-detail summary {
  cursor: pointer;
}
.event-detail pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 360px;
  overflow: auto;
  font-size: 11px;
  line-height: 1.8;
}
@media (max-width: 650px) {
  .event-filters {
    grid-template-columns: 1fr 1fr;
  }
  .search-label {
    grid-column: 1/-1;
  }
  .review-table td,
  .review-table th {
    padding: 12px 10px;
  }
  .pagination {
    justify-content: center;
  }
}
</style>
