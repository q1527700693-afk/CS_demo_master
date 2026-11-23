<script setup lang="ts">
import type { StageProgress } from './contracts'
defineProps<{ stages: StageProgress[] }>()
const labels = {
  pending: '等待',
  running: '进行中',
  completed: '完成',
  skipped: '已在外部完成',
  failed: '失败',
}
</script>
<template>
  <ol class="analysis-stages" aria-label="分析流程" aria-live="polite">
    <li v-for="(stage, index) in stages" :key="stage.stage" :data-status="stage.status">
      <div class="stage-title">
        <strong>{{ index + 1 }}. {{ stage.label }}</strong
        ><span>{{ labels[stage.status] }}</span>
      </div>
      <progress
        v-if="stage.status !== 'skipped'"
        :value="
          stage.status === 'running' && stage.percent === null ? undefined : (stage.percent ?? 0)
        "
        max="100"
        :aria-label="stage.label"
      />
      <p>
        {{ stage.message }}<span v-if="stage.percent !== null"> · {{ stage.percent }}%</span>
      </p>
    </li>
  </ol>
</template>
<style scoped>
.analysis-stages {
  list-style: none;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin: 24px 0;
}
.analysis-stages li {
  padding: 18px;
  border: 1px solid #394043;
  border-radius: 12px;
  background: #1b2022;
}
.stage-title {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.stage-title span {
  color: #aeb8ba;
  font-size: 12px;
}
.analysis-stages p {
  color: #b8c2c3;
  font-size: 13px;
  min-height: 2em;
  margin-bottom: 0;
}
.analysis-stages progress {
  width: 100%;
  height: 8px;
  accent-color: #f89842;
  margin-top: 18px;
}
.analysis-stages [data-status='running'] {
  border-color: #f89842;
}
.analysis-stages [data-status='failed'] {
  border-color: #ea7070;
}
.analysis-stages [data-status='completed'] {
  border-color: #5a9e88;
}
@media (max-width: 650px) {
  .analysis-stages {
    grid-template-columns: 1fr;
  }
}
</style>
