<script setup lang="ts">
defineProps<{ loading?: boolean; error?: string }>()
defineEmits<{ retry: [] }>()
</script>
<template>
  <div v-if="loading" class="state-panel" role="status"><span class="spinner" />正在加载…</div>
  <div v-else-if="error" class="state-panel" role="alert">
    <p>{{ error }}</p>
    <button class="button secondary" @click="$emit('retry')">重新加载</button>
  </div>
  <slot v-else />
</template>
