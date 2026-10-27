<script setup lang="ts">
import { ref, onMounted } from 'vue'
import AsyncState from '@/components/AsyncState.vue'
import { listMatches } from './analysis-api'
import { errorMessage } from '@/api/http'
import { mockModules } from '@/app/config'
import type { MatchRecord } from './contracts'
import { numberText, statusLabels } from './report-data'
const matches = ref<MatchRecord[]>([]),
  loading = ref(true),
  error = ref('')
async function load() {
  loading.value = true
  error.value = ''
  try {
    matches.value = (await listMatches()).items
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>
<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">MATCH LIBRARY</div>
      <h1>我的复盘<span class="orange">.</span></h1>
      <p>同一场比赛保留同一编号，每次分析独立保存。</p>
    </div>
    <RouterLink to="/replays/new?view=cloud" class="button primary">上传分析包</RouterLink>
  </section>
  <p v-if="mockModules.replay" class="sample-caption">
    前端演示记录，实际比赛与历史由后端组接入后保存。
  </p>
  <AsyncState :loading="loading" :error="error" @retry="load"
    ><p v-if="!matches.length" class="panel">暂无比赛记录，上传本地工具生成的分析包即可开始。</p>
    <article v-for="item in matches" :key="item.match_id" class="panel match-row">
      <div>
        <h2>{{ item.match.map }}</h2>
        <p>
          {{
            item.match.started_at
              ? new Date(item.match.started_at).toLocaleString('zh-CN')
              : '比赛时间未知'
          }}
        </p>
        <p>
          {{
            item.match.teams.map((t) => `${t.name} ${t.score ?? '未知'}`).join(' : ') || '比分未知'
          }}<span v-if="!item.match.complete"> · 完整性未确认</span>
        </p>
        <p class="muted">上传于 {{ new Date(item.created_at).toLocaleString('zh-CN') }}</p>
        <small>{{ item.latest_analysis?.message || '分析包已上传' }}</small>
        <p v-if="item.summary" class="match-summary">
          ADR <strong>{{ numberText(item.summary.adr) }}</strong> ·
          {{ statusLabels[item.summary.status] || item.summary.status }} · Rating
          {{ numberText(item.summary.rating) }}
        </p>
      </div>
      <RouterLink
        v-if="item.latest_available_analysis_id"
        :to="`/replays/${item.latest_available_analysis_id}`"
        class="button secondary"
        >查看可用报告</RouterLink
      >
    </article></AsyncState
  >
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
