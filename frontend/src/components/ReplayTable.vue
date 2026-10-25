<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import type { Replay } from '@/types'
defineProps<{ items: Replay[] }>()
const date = (text: string) =>
  new Date(text).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
const status: Record<string, string> = {
  uploaded: '已上传',
  queued: '排队中',
  analyzing: '分析中',
  completed: '已完成',
  failed: '失败',
}
</script>
<template>
  <div v-if="!items.length" class="state-panel">
    <AppIcon name="replay" :size="30" />
    <p>还没有复盘记录</p>
    <RouterLink to="/replays/new" class="button primary">上传第一份数据包</RouterLink>
  </div>
  <div v-else class="table-scroll">
    <table class="replay-table">
      <thead>
        <tr>
          <th>对局 / 地图</th>
          <th>比分</th>
          <th>Rating</th>
          <th>ADR</th>
          <th>日期</th>
          <th>报告</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in items" :key="item.id">
          <td>
            <div class="map-cell">
              <div class="map-tile" :class="item.map.toLowerCase().replace(/\s/g, '')">
                {{ item.map.slice(0, 1) }}
              </div>
              <div>
                <strong>{{ item.map }}</strong
                ><small>{{ item.title }}</small>
              </div>
            </div>
          </td>
          <td>
            <span v-if="item.scoreKnown !== false" class="score" :class="{ win: item.score[0] > item.score[1] }"
              >{{ item.score[0] }} <em>:</em> {{ item.score[1] }}</span
            >
            <span v-else class="muted">未确认</span>
          </td>
          <td class="numeric" :class="{ positive: (item.rating || 0) >= 1 }">
            {{ item.rating?.toFixed(2) ?? '—' }}
          </td>
          <td class="numeric">{{ item.adr?.toFixed(1) ?? '—' }}</td>
          <td class="muted">{{ item.matchTimeKnown === false ? '比赛时间未知 · 上传 ' : '' }}{{ date(item.createdAt) }}</td>
          <td>
            <RouterLink
              v-if="item.status === 'completed'"
              :to="`/replays/${item.id}`"
              class="text-link"
              >查看报告 <AppIcon name="arrow" :size="15" /></RouterLink
            ><span v-else class="muted">{{ status[item.status] }}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
