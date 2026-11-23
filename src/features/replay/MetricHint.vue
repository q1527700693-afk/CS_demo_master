<script setup lang="ts">
defineProps<{ label: string; text: string }>()
</script>
<template>
  <details class="metric-hint">
    <summary :aria-label="`${label}说明`">ⓘ</summary>
    <p>{{ text }}</p>
  </details>
</template>
<style scoped>
.metric-hint {
  position: relative;
  font-size: 12px;
  color: #8ca1b1;
}
.metric-hint summary {
  cursor: pointer;
  list-style: none;
  padding: 2px 4px;
}
.metric-hint p {
  position: absolute;
  right: -8px;
  top: 26px;
  width: 220px;
  max-width: 65vw;
  padding: 13px 15px;
  border: 1px solid #506371;
  border-radius: 7px;
  background: #253744;
  color: #d1dce4;
  font-size: 12px;
  line-height: 1.8;
  box-shadow: 0 8px 24px #0006;
  z-index: 15;
}
.metric-hint summary:hover {
  color: #e2c29d;
}
</style>
