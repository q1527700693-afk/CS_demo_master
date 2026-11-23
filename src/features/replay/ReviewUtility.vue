<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AnalysisReport, ReplayDetails, ReplayEvent } from './contracts'
import { valueText, weaponName, type ReviewFocus } from './review-presentation'
import { reportUtilityDamage } from './combat-facts'
import ReviewFocusList from './ReviewFocusList.vue'
import { utilityUsage } from './utility-usage'
const props = defineProps<{
  report: AnalysisReport
  details: ReplayDetails | null
  focuses: ReviewFocus[]
  events?: ReplayEvent[]
  eventsAvailable?: boolean
}>()
defineEmits<{ focus: [focus: ReviewFocus] }>()
const filter = ref('key'),
  focusPage = ref(1)
watch(filter, () => (focusPage.value = 1))
const utility = computed(() => props.report.report.modules.utility?.metrics)
const damage = computed(() =>
  reportUtilityDamage(
    props.report,
    props.details,
    props.events || [],
    props.eventsAvailable === true,
  ),
)
const missingDamage = computed(() =>
  [damage.value.he, damage.value.fire, damage.value.team].some((n) => n == null),
)
const death = computed(() => props.report.report.modules.death_context?.metrics)
const flashes = computed(() => [
  { label: '敌方致盲', value: utility.value?.enemies_blinded, color: '#9ccbb5' },
  { label: '队友致盲', value: utility.value?.teammates_blinded, color: '#d9a17c' },
  { label: '自身致盲', value: utility.value?.self_blinds, color: '#b99ac4' },
  ...(Number(utility.value?.unclassified_blinds) > 0
    ? [{ label: '阵营未记录', value: utility.value?.unclassified_blinds, color: '#8597a4' }]
    : []),
])
const flashMax = computed(() => Math.max(1, ...flashes.value.map((r) => r.value || 0)))
const deathRows = computed(() => [
  { label: '持道具时阵亡', value: death.value?.deaths_holding_grenade },
  { label: '换弹时阵亡', value: death.value?.deaths_reloading },
  { label: '受闪时阵亡', value: death.value?.deaths_blinded },
  { label: '携带未使用道具阵亡', value: death.value?.deaths_with_unused_utility },
])
const throws = computed(() => utilityUsage(props.report, props.details))
const filtered = computed(() =>
  props.focuses.filter((f) => {
    if (filter.value === 'all') return true
    if (filter.value === 'key') return f.priority >= 3
    if (filter.value === 'positive') return !!f.positive
    if (filter.value === 'flash') return f.rule.includes('flash')
    if (filter.value === 'team') return f.rule === 'team_kill'
    return filter.value === 'death' && f.rule.startsWith('death_')
  }),
)
</script>
<template>
  <div class="utility-grid">
    <section class="review-panel">
      <header class="review-section-heading">
        <div>
          <h2>闪光效果</h2>
          <p>仅统计持续至少 0.5 秒的有效致盲；微白保留在详细事件中</p>
        </div>
      </header>
      <div class="utility-totals">
        <div>
          <strong>{{ valueText(utility?.flashes_thrown, 0) }}</strong
          ><span>投掷闪光弹</span>
        </div>
        <div>
          <strong>{{ valueText(utility?.enemy_blind_seconds) }}<small> 秒</small></strong
          ><span>累计敌方致盲</span>
        </div>
      </div>
      <div class="flash-chart" role="img" aria-label="敌方、队友与自身致盲人次对比">
        <div v-for="item in flashes" :key="item.label" class="horizontal-bar">
          <span>{{ item.label }}</span>
          <div>
            <i
              :style="{ width: `${((item.value || 0) / flashMax) * 100}%`, background: item.color }"
            />
          </div>
          <strong>{{ valueText(item.value, 0) }}<small> 人次</small></strong>
        </div>
      </div>
      <p v-if="!utility" class="review-empty">当前记录未提供闪光统计。</p>
    </section>
    <section class="review-panel">
      <header class="review-section-heading">
        <div>
          <h2>阵亡前的状态</h2>
          <p>同一次阵亡可符合多个状态，不能相加</p>
        </div>
      </header>
      <div class="death-total">
        <strong>{{ valueText(death?.deaths_with_context, 0) }}</strong
        ><span>次阵亡有状态记录</span>
      </div>
      <div v-for="item in deathRows" :key="item.label" class="death-stat">
        <div>
          <span>{{ item.label }}</span
          ><strong>{{ valueText(item.value, 0) }} <small>次</small></strong>
        </div>
        <div class="death-track">
          <i
            :style="{
              width: `${Math.min(100, ((item.value || 0) / Math.max(1, death?.deaths_with_context || 0)) * 100)}%`,
            }"
          />
        </div>
      </div>
    </section>
  </div>
  <section class="review-panel throw-panel">
    <header class="review-section-heading">
      <div>
        <h2>手雷与燃烧伤害</h2>
        <p>
          对敌伤害与队伤分别统计。{{
            damage.basis === 'raw'
              ? '当前解析仅提供原始伤害，数值可能含过量伤害。'
              : '优先使用有效生命伤害；缺少时使用原始伤害。'
          }}
        </p>
      </div>
    </header>
    <div class="utility-totals">
      <div>
        <strong>{{ valueText(damage.he, 0) }}</strong
        ><span>高爆手雷伤害</span>
      </div>
      <div>
        <strong>{{ valueText(damage.fire, 0) }}</strong
        ><span>燃烧伤害</span>
      </div>
      <div>
        <strong>{{ valueText(damage.team, 0) }}</strong
        ><span>道具误伤队友</span>
      </div>
    </div>
    <p v-if="missingDamage && damage.total != null" class="review-empty">
      解析报告记录道具总伤害 {{ valueText(damage.total, 0) }}。
    </p>
    <p v-if="missingDamage" class="review-empty">此报告缺少部分分类明细。</p>
    <p v-if="damage.unknown" class="review-empty">
      另有 {{ damage.unknown }} 点道具伤害无法确认敌我归属。
    </p>
    <p v-if="damage.partial && !missingDamage" class="review-empty">
      部分伤害记录缺失，以上为已确认的数值。
    </p>
  </section>
  <section class="review-panel throw-panel" data-testid="utility-throws">
    <header class="review-section-heading">
      <div>
        <h2>道具使用分布</h2>
        <p>按本场玩家的实际投掷事件统计，每次投掷计一次；不按命中人数或伤害次数累计。</p>
      </div>
    </header>
    <div class="throw-grid">
      <article v-for="w in throws.items" :key="w.weapon" :data-weapon="w.weapon">
        <span class="throw-symbol" :class="w.weapon"
          ><svg
            width="22"
            height="26"
            viewBox="0 0 24 28"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            aria-hidden="true"
          >
            <rect x="7" y="8" width="12" height="17" rx="4" />
            <path d="M10 8V4h7v4M16 4l5 5M7 13h12M7 19h12M9 2h8" /></svg
        ></span>
        <div>
          <span>{{ weaponName(w.weapon) }}</span
          ><strong v-if="w.count != null"
            >{{ w.lowerBound ? '≥ ' : '' }}{{ valueText(w.count, 0) }}<small> 次</small></strong
          >
          <span v-else class="muted small-text">未提供投掷记录</span>
        </div>
      </article>
    </div>
    <p v-if="!throws.complete" class="review-empty">
      部分类型缺少完整投掷记录，已知次数保留显示；没有记录不代表投掷了 0 次。
    </p>
  </section>
  <section class="review-panel" id="report-findings">
    <header class="review-section-heading">
      <div>
        <h2>关键表现与复盘</h2>
        <p>记录首杀、首死、补枪、多杀与经济翻盘；普通经济局失利不单列。</p>
      </div>
      <select v-model="filter" aria-label="复盘重点类型">
        <option value="key">关键表现</option>
        <option value="positive">打得好的</option>
        <option value="all">全部记录（{{ focuses.length }}）</option>
        <option value="flash">闪光配合</option>
        <option value="death">阵亡状态</option>
        <option value="team">误杀队友（TK）</option>
      </select>
    </header>
    <ReviewFocusList
      :items="filtered.slice((focusPage - 1) * 6, focusPage * 6)"
      @select="$emit('focus', $event)"
    />
    <div v-if="filtered.length > 6" class="focus-pagination">
      <span
        >{{ filtered.length }} 处重点 · 第 {{ focusPage }} /
        {{ Math.ceil(filtered.length / 6) }} 页</span
      ><button class="button secondary compact" :disabled="focusPage <= 1" @click="focusPage--">
        上一组</button
      ><button
        class="button secondary compact"
        :disabled="focusPage >= Math.ceil(filtered.length / 6)"
        @click="focusPage++"
      >
        下一组
      </button>
    </div>
  </section>
</template>
<style scoped>
.utility-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  margin-bottom: 18px;
}
.utility-totals {
  display: flex;
  gap: 48px;
  margin: 26px 0 32px;
}
.utility-totals > div {
  display: grid;
  gap: 7px;
}
.utility-totals strong {
  font-size: 32px;
  font-weight: 550;
}
.utility-totals span {
  font-size: 11px;
  color: #9cabb5;
}
.utility-totals small {
  font-size: 13px;
  font-weight: 400;
  color: #9eacb6;
}
.horizontal-bar {
  display: grid;
  grid-template-columns: 70px 1fr 66px;
  gap: 12px;
  align-items: center;
  font-size: 12px;
  margin: 23px 0;
}
.horizontal-bar > div {
  height: 9px;
  background: #26333d;
  border-radius: 3px;
  overflow: hidden;
}
.horizontal-bar i {
  display: block;
  height: 100%;
  border-radius: 3px;
  min-width: 0;
}
.horizontal-bar strong {
  text-align: right;
  font-size: 16px;
  font-weight: 500;
}
.horizontal-bar small {
  font-size: 10px;
  color: #8396a4;
}
.death-total {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin: 20px 0 24px;
}
.death-total strong {
  font-size: 32px;
  font-weight: 550;
}
.death-total span {
  font-size: 11px;
  color: #91a4b2;
}
.death-stat {
  margin: 17px 0;
}
.death-stat > div:first-child {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 8px;
  color: #c0cbd2;
}
.death-stat strong {
  font-weight: 500;
}
.death-stat small {
  color: #8396a4;
  font-size: 10px;
}
.death-track {
  height: 4px;
  border-radius: 3px;
  background: #293640;
  overflow: hidden;
}
.death-track i {
  display: block;
  height: 100%;
  background: #c09882;
}
.throw-panel {
  margin-bottom: 18px;
}
.throw-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
}
.throw-grid article {
  display: flex;
  align-items: center;
  gap: 12px;
  border-right: 1px solid #2d3a44;
  padding: 6px 10px 6px 0;
}
.throw-grid article:last-child {
  border: 0;
}
.throw-grid article > div {
  display: grid;
  gap: 8px;
}
.throw-grid span {
  font-size: 11px;
  color: #a4b5c0;
}
.throw-grid strong {
  font-size: 22px;
  font-weight: 500;
}
.throw-grid small {
  font-size: 10px;
  color: #8a9ba7;
}
.throw-symbol {
  color: #97b4bf !important;
}
.throw-symbol.flashbang {
  color: #d9c87c !important;
}
.throw-symbol.molotov,
.throw-symbol.incgrenade {
  color: #d29e7f !important;
}
select {
  width: auto;
  font-size: 12px;
  padding: 9px 12px;
}
@media (max-width: 1100px) {
  .throw-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 22px;
  }
}
@media (max-width: 750px) {
  .utility-grid {
    grid-template-columns: 1fr;
  }
  .throw-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .utility-totals {
    gap: 35px;
  }
}
.focus-pagination {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 14px;
  padding-top: 20px;
  border-top: 1px solid #2b3a46;
  font-size: 11px;
  color: #8ea4b4;
}
.focus-pagination > span {
  margin-right: auto;
}
@media (max-width: 500px) {
  .focus-pagination {
    gap: 8px;
    flex-wrap: wrap;
  }
  .focus-pagination > span {
    width: 100%;
    margin-bottom: 5px;
  }
}
</style>
