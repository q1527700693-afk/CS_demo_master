<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useUploadTask } from './upload-task'
const task = useUploadTask(),
  route = useRoute()
const stage = computed(() =>
  task.stages.find((s) => s.status === 'running' || s.status === 'failed'),
)
</script>
<template>
  <RouterLink
    v-if="route.name !== 'upload' && (task.busy || task.error)"
    to="/replays/new"
    class="upload-task-banner"
    role="status"
  >
    <strong>{{
      task.choosingPlayer
        ? '选择分析玩家后继续'
        : task.error
          ? '比赛处理需要重试'
          : '比赛正在后台处理'
    }}</strong>
    <span>{{ stage?.message }}{{ stage?.percent != null ? ` · ${stage.percent}%` : '' }}</span
    ><span>查看进度 →</span>
  </RouterLink>
</template>
<style scoped>
.upload-task-banner {
  position: fixed;
  z-index: 100;
  bottom: 20px;
  right: 20px;
  display: grid;
  gap: 7px;
  max-width: min(380px, calc(100vw - 40px));
  padding: 18px 22px;
  border: 1px solid #7c6248;
  border-radius: 12px;
  background: #242522;
  color: #edc49b;
  box-shadow: 0 12px 40px #0006;
  text-decoration: none;
  font-size: 12px;
}
.upload-task-banner span {
  color: #c0b6a9;
  overflow-wrap: anywhere;
}
</style>
