<script setup lang="ts">
import { computed, reactive } from 'vue'
import { featureFlags } from '@/app/config'
import { TRAINING_MODES, trainingGroupLabel, trainingMetric } from '@/features/training/records'
import type { TrainingBest, TrainingMode } from '@/features/training/records'
const props = defineProps<{ records: TrainingBest[]; own: boolean }>()
const selected = reactive<Partial<Record<TrainingMode, string>>>({})
const modes = computed(() =>
  TRAINING_MODES.map((mode) => {
    const groups = props.records
      .filter((record) => record.session.config.mode === mode.id)
      .sort((a, b) => Date.parse(b.lastPlayedAt) - Date.parse(a.lastPlayedAt))
    return {
      ...mode,
      groups,
      best: groups.find((group) => group.key === selected[mode.id]) || groups[0],
    }
  }),
)
function value(record: TrainingBest): string {
  const metric = trainingMetric(record.session)!
  return record.session.config.mode === 'tracking'
    ? metric.toFixed(1)
    : Math.round(metric).toLocaleString('zh-CN')
}
const date = (record: TrainingBest) =>
  new Date(record.session.completedAt).toLocaleDateString('zh-CN')
</script>
<template>
  <section class="panel training-bests" aria-labelledby="bests-heading">
    <div class="records-heading">
      <div>
        <div class="eyebrow">PERSONAL BESTS</div>
        <h2 id="bests-heading">训练最高战绩</h2>
      </div>
      <span class="record-source">{{ own ? '仅此设备' : '公开战绩待接入' }}</span>
    </div>
    <p class="records-note">
      {{
        own
          ? '统计当前账号在此设备完成的训练。各参数组独立比较，反应测试取最低平均用时；训练中改过参数的回合不计最佳。'
          : '该玩家的训练战绩尚未公开，等待战绩接口接入。'
      }}
    </p>
    <div class="best-grid">
      <article v-for="mode in modes" :key="mode.id" class="best-card" :data-mode="mode.id">
        <div class="best-mode">
          <span>{{ mode.english }}</span>
          <h3>{{ mode.name }}</h3>
        </div>
        <div class="best-value">
          <strong>{{ mode.best ? value(mode.best) : '—' }}</strong
          ><span v-if="mode.best">{{ mode.unit }}</span>
        </div>
        <p class="metric-label">
          {{ mode.best ? mode.direction : own ? '完成训练后显示' : '暂无公开战绩' }}
        </p>
        <template v-if="mode.best">
          <label v-if="mode.groups.length > 1" class="group-selector">
            <span class="visually-hidden">{{ mode.name }}成绩参数</span>
            <select
              :aria-label="`${mode.name}成绩参数`"
              :value="mode.best.key"
              @change="selected[mode.id] = ($event.target as HTMLSelectElement).value"
            >
              <option v-for="group in mode.groups" :key="group.key" :value="group.key">
                {{ trainingGroupLabel(group.session.config) }}
              </option>
            </select>
          </label>
          <p v-else class="group-description">{{ trainingGroupLabel(mode.best.session.config) }}</p>
          <div class="best-footer">
            <span>本组 {{ mode.best.attempts }} 轮</span
            ><time :datetime="mode.best.session.completedAt">{{ date(mode.best) }}</time>
          </div>
        </template>
      </article>
    </div>
    <div v-if="own" class="records-bottom">
      <p>旧的未归属训练记录不会自动计入，当前战绩尚未同步到云端。</p>
      <RouterLink v-if="featureFlags.training" to="/training" class="text-link"
        >前往训练场 <span aria-hidden="true">→</span></RouterLink
      >
    </div>
  </section>
</template>
<style scoped>
.training-bests {
  padding: 28px;
}
.records-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.records-heading .eyebrow {
  font-size: 10px;
  margin-bottom: 8px;
}
.record-source {
  color: var(--green);
  border: 1px solid #35463d;
  border-radius: 5px;
  padding: 5px 8px;
  font-size: 11px;
}
.records-note {
  color: var(--muted);
  font-size: 12px;
  margin: 16px 0 22px;
}
.best-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
.best-card {
  min-width: 0;
  padding: 21px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #151719;
}
.best-mode > span {
  color: var(--muted);
  font-size: 9px;
  letter-spacing: 1.8px;
}
.best-mode h3 {
  font-size: 14px;
  margin-top: 6px;
}
.best-value {
  display: flex;
  align-items: baseline;
  gap: 7px;
  margin-top: 22px;
}
.best-value strong {
  font-size: 35px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--orange);
}
.best-value > span {
  font-size: 12px;
  color: var(--muted);
}
.metric-label {
  font-size: 11px;
  color: var(--muted);
}
.group-description {
  min-height: 35px;
  margin-top: 18px;
  color: #aab0b6;
  font-size: 10px;
}
.group-selector {
  display: block;
  margin-top: 18px;
}
.group-selector select {
  min-width: 0;
  font-size: 10px;
  padding: 8px;
}
.best-footer {
  border-top: 1px solid var(--line);
  padding-top: 12px;
  margin-top: 14px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: var(--muted);
  font-size: 10px;
}
.records-bottom {
  margin-top: 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--muted);
}
@media (max-width: 1100px) {
  .best-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 600px) {
  .training-bests {
    padding: 20px;
  }
  .best-grid {
    grid-template-columns: 1fr;
  }
}
</style>
