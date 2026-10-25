<script setup lang="ts">
import { useRoute } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
const route = useRoute()
</script>

<template>
  <section class="state-panel full-state">
    <AppIcon name="clock" :size="40" />
    <h1>{{ route.meta.title }}暂未开放</h1>
    <p>该功能正在准备或更新中，可以先使用其他功能。</p>
    <RouterLink to="/" class="button primary">返回总览</RouterLink>
  </section>
</template>
