<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { clockText, type ReviewFocus } from './review-presentation'
defineProps<{ items: ReviewFocus[]; compact?: boolean }>()
defineEmits<{ select: [focus: ReviewFocus] }>()
</script>
<template>
  <div class="focus-list" :class="{ compact }">
    <article
      v-for="(item, index) in items"
      :key="item.id"
      class="focus-card"
      :data-priority="item.priority >= 3 ? 'high' : 'normal'"
    >
      <div class="focus-index">{{ String(index + 1).padStart(2, '0') }}</div>
      <div class="focus-body">
        <div class="focus-meta">
          <span
            >{{ item.round == null ? '比赛事件' : `第 ${item.round} 回合` }} ·
            {{ clockText(item.seconds) }}</span
          ><span v-if="item.priority >= 3" class="priority-label">优先回看</span>
        </div>
        <h3>{{ item.title }}</h3>
        <p class="focus-fact">{{ item.observation }}</p>
        <p v-if="!compact" class="focus-action">{{ item.action }}</p>
      </div>
      <button
        class="focus-jump"
        :disabled="item.round == null"
        :aria-label="`定位${item.title}，第 ${item.round} 回合`"
        @click="$emit('select', item)"
      >
        <AppIcon name="arrow" :size="18" /><span>定位</span>
      </button>
    </article>
    <div v-if="!items.length" class="review-empty">
      当前记录没有这类事件，可从回合时间线继续复盘。
    </div>
  </div>
</template>
<style scoped>
.focus-card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 20px 0;
  border-bottom: 1px solid var(--line);
}
.focus-card:last-child {
  border: 0;
}
.focus-index {
  font-size: 12px;
  color: #6d7882;
  font-variant-numeric: tabular-nums;
  padding-top: 4px;
}
.focus-body {
  min-width: 0;
  flex: 1;
}
.focus-meta {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  font-size: 11px;
  color: #9ca9b5;
  margin-bottom: 8px;
}
.priority-label {
  color: #edbd82;
}
.focus-body h3 {
  font-size: 15px;
  margin-bottom: 5px;
}
.focus-fact {
  font-size: 12px;
  color: #c1c9d0;
  overflow-wrap: anywhere;
}
.focus-action {
  font-size: 12px;
  color: #8d9aa5;
  margin-top: 8px;
}
.focus-jump {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  border: 1px solid #35404a;
  background: #202a32;
  color: #b9d3e0;
  padding: 9px 10px;
  border-radius: 6px;
  font-size: 11px;
  flex-shrink: 0;
}
.focus-jump:hover {
  background: #303f49;
}
.compact .focus-card {
  padding: 16px 0;
}
.compact .focus-index {
  display: none;
}
.review-empty {
  padding: 28px 0;
  font-size: 13px;
  color: var(--muted);
}
</style>
