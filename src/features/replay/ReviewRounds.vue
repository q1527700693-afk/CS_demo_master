<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AnalysisReport, ReplayDetails, ReplayEvent } from './contracts'
import { roundRows, eventLabels } from './report-data'
import {
  clockText,
  sideName,
  valueText,
  eventSentence,
  isTargetEvent,
  type ReviewFocus,
} from './review-presentation'
import { MIN_EFFECTIVE_BLIND_SECONDS } from './combat-facts'
import RoundMap from './RoundMap.vue'
import ReviewFocusList from './ReviewFocusList.vue'
const props = defineProps<{
  report: AnalysisReport
  details: ReplayDetails
  events: ReplayEvent[]
  focuses: ReviewFocus[]
  round: number
  focus?: ReviewFocus | null
}>()
const emit = defineEmits<{ round: [round: number] }>()
const rows = computed(() => roundRows(props.details))
const row = computed(() => rows.value.find((r) => r.round_num === props.round))
const selectedEvent = ref<ReplayEvent | null>(null),
  seek = ref<{ tick: number; nonce: number } | null>(null),
  eventScope = ref('key')
const roundFocuses = computed(() => props.focuses.filter((f) => f.round === props.round))
const roundEvents = computed(() =>
  props.events
    .filter(
      (e) =>
        e.round_num === props.round &&
        (eventScope.value === 'all' ||
          (['kill', 'blind', 'death_context'].includes(e.type) &&
            isTargetEvent(e, props.report.target_player_id) &&
            (e.type !== 'blind' ||
              Number(e.data.record?.duration) >= MIN_EFFECTIVE_BLIND_SECONDS)) ||
          (e.type === 'bomb_action' &&
            [
              'finish_plant',
              'finish_defuse',
              'explode',
              'bomb_planted',
              'bomb_defused',
              'bomb_exploded',
            ].includes(String(e.data.record?.event)))),
    )
    .sort((a, b) => a.tick - b.tick),
)
const cursorTick = ref(0)
function jump(event: ReplayEvent) {
  selectedEvent.value = event
  seek.value = { tick: event.tick, nonce: Date.now() }
}
function focusItem(f: ReviewFocus) {
  selectedEvent.value = props.events.find((e) => f.evidenceIds.includes(e.event_id)) || null
  seek.value = { tick: f.tick, nonce: Date.now() }
}
watch(
  () => props.round,
  () => {
    selectedEvent.value = null
    seek.value = null
  },
)
watch(
  () => props.focus,
  (f) => {
    if (f && f.round === props.round) focusItem(f)
  },
  { immediate: true },
)
</script>
<template>
  <div class="round-workspace" id="report-map">
    <section class="review-panel round-map-panel">
      <header class="review-section-heading">
        <div>
          <h2>
            战术地图
            <span class="round-outcome" :data-outcome="row?.outcome">{{
              row?.outcome === '胜' ? '回合获胜' : row?.outcome === '负' ? '回合失利' : '结果未记录'
            }}</span>
          </h2>
          <p>
            {{ sideName(row?.target_side) }} · {{ valueText(row?.stats.kills, 0) }} 击杀 /
            {{ valueText(row?.stats.deaths, 0) }} 死亡 / {{ valueText(row?.stats.assists, 0) }} 助攻
          </p>
        </div>
        <label class="round-picker"
          >选择回合<select
            :value="round"
            aria-label="地图回合"
            @change="emit('round', Number(($event.target as HTMLSelectElement).value))"
          >
            <option v-for="r in rows" :key="r.round_num" :value="r.round_num">
              第 {{ r.round_num }} 回合
            </option>
          </select></label
        >
      </header>
      <RoundMap
        :analysis-id="report.analysis_id"
        :package-id="details.source.package_id"
        :global="details.export_scope?.scope === 'all_players_and_all_utility'"
        :round="round"
        :map-name="report.match.map"
        :tick-rate="report.match.tick_rate"
        :player-id="report.target_player_id"
        :player-name="details.target_player?.name || '分析对象'"
        :seek="seek"
        @cursor="cursorTick = $event"
        @event="jump"
      />
    </section>
    <aside class="round-sidebar">
      <section
        v-if="selectedEvent"
        class="review-panel selected-moment"
        data-testid="selected-moment"
      >
        <span class="moment-caption"
          >已定位 · {{ clockText(selectedEvent.live_elapsed_seconds) }}</span
        >
        <h3>{{ eventLabels[selectedEvent.type] || '比赛事件' }}</h3>
        <p>{{ eventSentence(selectedEvent) }}</p>
        <button
          class="review-text-button"
          @click="
            seek = { tick: selectedEvent.tick - report.match.tick_rate * 5, nonce: Date.now() }
          "
        >
          从前 5 秒开始回看 →
        </button>
      </section>
      <section class="review-panel round-event-panel">
        <header class="review-section-heading">
          <div>
            <h2>事件时间线</h2>
            <p>点击事件，同步定位地图</p>
          </div>
        </header>
        <div class="event-scope">
          <button :aria-pressed="eventScope === 'key'" @click="eventScope = 'key'">与我相关</button
          ><button :aria-pressed="eventScope === 'all'" @click="eventScope = 'all'">
            全部事件
          </button>
        </div>
        <div class="round-event-list">
          <button
            v-for="e in roundEvents"
            :key="e.event_id"
            class="round-event"
            :class="{
              selected: selectedEvent?.event_id === e.event_id,
              past: e.tick <= cursorTick,
            }"
            @click="jump(e)"
          >
            <time>{{ clockText(e.live_elapsed_seconds) }}</time
            ><span class="event-mark" :data-kind="e.type" />
            <div>
              <strong>{{ eventLabels[e.type] || '比赛事件' }}</strong>
              <p>{{ eventSentence(e) }}</p>
            </div>
          </button>
          <p v-if="!roundEvents.length" class="review-empty">该回合没有符合条件的事件。</p>
        </div>
      </section>
      <section v-if="roundFocuses.length" class="review-panel">
        <header class="review-section-heading"><h2>本回合复盘重点</h2></header>
        <ReviewFocusList :items="roundFocuses" @select="focusItem" />
      </section>
    </aside>
  </div>
</template>
<style scoped>
.round-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1.85fr) minmax(270px, 1fr);
  gap: 18px;
  align-items: start;
}
.round-map-panel {
  padding: 22px;
}
.round-sidebar {
  display: grid;
  gap: 18px;
  min-width: 0;
}
.round-outcome {
  font-size: 10px;
  font-weight: 400;
  padding: 4px 7px;
  border-radius: 4px;
  background: #30323c;
  color: #a8b0bb;
  margin-left: 8px;
  vertical-align: middle;
}
.round-outcome[data-outcome='胜'] {
  color: #a7d3bd;
  background: #213b32;
}
.round-outcome[data-outcome='负'] {
  color: #d5a1a1;
  background: #39282c;
}
.round-picker {
  display: grid;
  gap: 5px;
  color: #8da0af;
  font-size: 10px;
}
.round-picker select {
  padding: 7px 9px;
  font-size: 12px;
}
.round-event-list {
  max-height: 535px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: #435363 transparent;
}
.round-event {
  display: grid;
  grid-template-columns: 40px 6px 1fr;
  gap: 10px;
  text-align: left;
  width: 100%;
  background: none;
  border: 0;
  border-bottom: 1px solid #28353f;
  padding: 14px 3px;
}
.round-event:hover,
.round-event.selected {
  background: #23313b;
}
.round-event time {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: #8294a1;
  padding-top: 2px;
}
.round-event strong {
  font-size: 12px;
  font-weight: 500;
  color: #bac9d3;
}
.round-event p {
  font-size: 11px;
  color: #879aa9;
  line-height: 1.7;
  margin-top: 4px;
  overflow-wrap: anywhere;
}
.event-mark {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #8096a8;
  margin-top: 7px;
}
.event-mark[data-kind='kill'] {
  background: #9cc9ae;
}
.event-mark[data-kind='blind'] {
  background: #d5bd7a;
}
.event-mark[data-kind='death_context'] {
  background: #c38b8d;
}
.event-scope {
  display: flex;
  background: #111c24;
  border-radius: 5px;
  padding: 3px;
  margin-bottom: 10px;
}
.event-scope button {
  flex: 1;
  background: none;
  border: 0;
  color: #8298a8;
  padding: 7px;
  font-size: 11px;
  border-radius: 4px;
}
.event-scope button[aria-pressed='true'] {
  background: #2b3944;
  color: #d4dfe6;
}
.selected-moment {
  border-color: #786044;
  background: #272922;
}
.moment-caption {
  font-size: 11px;
  color: #d4b98e;
}
.selected-moment h3 {
  font-size: 14px;
  margin: 9px 0;
}
.selected-moment p {
  font-size: 12px;
  color: #c4c4b8;
}
.selected-moment button {
  margin-top: 14px;
}
@media (max-width: 1100px) {
  .round-workspace {
    grid-template-columns: minmax(0, 1.5fr) minmax(245px, 1fr);
  }
  .round-map-panel {
    padding: 16px;
  }
}
@media (max-width: 850px) {
  .round-workspace {
    grid-template-columns: 1fr;
  }
  .round-event-list {
    max-height: 360px;
  }
}
</style>
