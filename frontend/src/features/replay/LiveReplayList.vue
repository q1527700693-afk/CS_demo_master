<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useUploadTask } from './upload-task'
import { loadAnalysisEntries, type AnalysisEntry } from './analysis-entries'
import { errorMessage } from '@/api/http'
const auth = useAuthStore(),
  task = useUploadTask()
const records = ref<AnalysisEntry[]>([]),
  loading = ref(false),
  error = ref(''),
  warnings = ref<string[]>([])
let generation = 0
async function load() {
  const current = ++generation
  loading.value = true
  error.value = ''
  try {
    const result = await loadAnalysisEntries()
    if (current !== generation) return
    records.value = result.entries
    warnings.value = result.warnings
  } catch (e) {
    if (current === generation) error.value = errorMessage(e)
  } finally {
    if (current === generation) loading.value = false
  }
}
watch(
  () => auth.user?.id,
  () => {
    records.value = []
    void load()
  },
)
watch(
  () => task.busy,
  (busy, previous) => {
    if (previous && !busy) void load()
  },
)
onMounted(load)
onUnmounted(() => generation++)
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">MATCH LIBRARY</div>
      <h1>我的复盘<span class="orange">.</span></h1>
      <p>每位玩家、每份分析单独保存；同一 Demo 切换玩家不会覆盖旧记录。</p>
    </div>
    <RouterLink to="/replays/new" class="button primary">新建复盘</RouterLink>
  </section>
  <p v-if="loading" class="panel" role="status">正在读取分析记录…</p>
  <p v-if="error" role="alert" class="panel">{{ error }}</p>
  <p v-for="warning in warnings" :key="warning" class="panel muted" role="status">{{ warning }}</p>
  <button class="button secondary compact" :disabled="loading" @click="load">刷新记录</button>
  <p class="library-count">共 {{ records.length }} 份独立分析</p>
  <p v-if="!loading && !records.length" class="panel">暂无分析记录，上传一场 Demo 即可开始。</p>
  <article
    v-for="item in records"
    :key="item.id"
    class="panel match-row"
    data-testid="analysis-entry"
    :data-analysis-id="item.id"
    :data-player-id="item.target"
  >
    <div>
      <h2>{{ item.title }}</h2>
      <p class="muted">
        {{
          item.source === 'cloud' ? '云端解析' : item.source === 'local' ? '本机保存' : '本地解析包'
        }}
        · {{ item.message || item.status }}
      </p>
    </div>
    <RouterLink
      v-if="item.available"
      :to="`/replays/${encodeURIComponent(item.id)}`"
      class="button secondary"
      >查看复盘</RouterLink
    >
    <RouterLink
      v-else-if="item.source === 'cloud' && item.status !== 'failed'"
      :to="{ path: '/replays/new', query: { task: item.id } }"
      class="button secondary"
      >查看进度</RouterLink
    >
  </article>
</template>
<style scoped>
.panel {
  padding: 24px;
  margin: 16px 0;
}
.library-count {
  color: var(--muted);
  margin: 18px 0;
  font-size: 12px;
}
.match-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 22px;
}
.match-row h2 {
  font-size: 16px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.match-row p {
  font-size: 12px;
  margin-top: 8px;
}
.match-row .button {
  flex-shrink: 0;
}
@media (max-width: 650px) {
  .match-row {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
