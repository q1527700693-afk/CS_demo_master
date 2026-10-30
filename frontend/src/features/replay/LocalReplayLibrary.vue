<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { listMatches, getHistory, downloadReport } from './analysis-api'
import { listLocalResults, type LocalResult } from './local-library'
import { errorMessage } from '@/api/http'
import { mockModules } from '@/app/config'
import { analysisName } from './analysis-name'
import { mapName } from './review-presentation'
const records = ref<LocalResult[]>([]),
  loading = ref(true),
  message = ref('正在读取本地复盘'),
  error = ref('')
async function load() {
  loading.value = true
  error.value = ''
  try {
    if (!mockModules.replay) records.value = await listLocalResults()
    const saved = new Set(records.value.map((r) => r.analysis_id))
    let page = 1,
      read = 0
    const failures: string[] = []
    while (true) {
      const response = await listMatches(page)
      read += response.items.length
      for (const match of response.items) {
        const history = await getHistory(match.match_id)
        for (const run of history.items) {
          if (saved.has(run.analysis_id) || !run.report_available) continue
          try {
            message.value = '正在将历史复盘完整保存到本机'
            const report = await downloadReport(
              run.analysis_id,
              () => {},
              run,
              (text) => (message.value = text),
            )
            saved.add(run.analysis_id)
            if (mockModules.replay)
              records.value.push({ ...report, saved_at: report.analyzed_at, complete: false })
            else records.value = await listLocalResults()
          } catch (e) {
            failures.push(errorMessage(e))
          }
        }
      }
      if (!response.items.length || read >= response.total) break
      page++
    }
    if (failures.length) error.value = `${failures.length} 份结果尚未保存到本机：${failures[0]}`
  } catch (e) {
    error.value = records.value.length
      ? '本地结果可正常查看；暂时无法同步其他历史结果。'
      : errorMessage(e)
  } finally {
    loading.value = false
    message.value = ''
  }
}
onMounted(load)
</script>
<template>
  <section class="page-heading">
    <div>
      <h1>我的复盘<span class="orange">.</span></h1>
      <p>每次分析单独保存在本机，包括报告、表格、事件和地图回放。</p>
    </div>
    <RouterLink to="/replays/new?view=cloud" class="button primary">新建复盘</RouterLink>
  </section>
  <p v-if="loading" role="status" class="panel">{{ message }}</p>
  <p v-if="error" role="alert" class="panel">
    {{ error }}
    <button class="button secondary compact" :disabled="loading" @click="load">重试保存</button>
  </p>
  <p v-if="!loading && !records.length && !error" class="panel">
    暂无保存的复盘，上传 Demo 或分析包即可开始。
  </p>
  <p v-if="records.length" class="library-count">
    共 {{ records.length }} 份复盘 · 同场比赛的多次分析均保留
  </p>
  <article
    v-for="item in records"
    :key="item.analysis_id"
    class="panel match-row"
    data-testid="local-replay-row"
  >
    <div>
      <h2>
        {{ analysisName(item.player_name, item.analyzed_at, item.match.map, item.analysis_id) }}
      </h2>
      <p>{{ item.match.teams.map((t) => `${t.name} ${t.score ?? '—'}`).join(' : ') }}</p>
      <p class="muted">分析于 {{ new Date(item.analyzed_at).toLocaleString('zh-CN') }}</p>
      <small>{{ item.complete ? '已完整保存到本机' : '演示数据' }}</small>
      <details v-if="item.directory" class="folder-location">
        <summary>本地文件位置</summary>
        <p>{{ item.directory }}</p>
      </details>
    </div>
    <RouterLink :to="`/replays/${item.analysis_id}`" class="button secondary">查看复盘</RouterLink>
  </article>
</template>
<style scoped>
.panel {
  padding: 24px;
}
.match-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 18px;
  margin-bottom: 18px;
}
.library-count {
  color: #9baeba;
  margin-bottom: 18px;
}
.match-row small {
  color: #79cca8;
}
.folder-location {
  margin-top: 10px;
  color: #9baeba;
  font-size: 12px;
}
.folder-location p {
  overflow-wrap: anywhere;
  user-select: all;
}
@media (max-width: 650px) {
  .panel {
    padding: 18px;
  }
  .match-row {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
