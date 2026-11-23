<script setup lang="ts">
import { useRoute } from 'vue-router'
import { featureFlags } from '@/app/config'
const route = useRoute()
</script>
<template>
  <nav class="community-nav" aria-label="玩家社区">
    <RouterLink
      v-if="featureFlags.social"
      to="/friends"
      :class="{ active: route.meta.featureId === 'social' }"
      >玩家与好友</RouterLink
    >
    <RouterLink
      v-if="featureFlags.lobby"
      to="/lobbies"
      :class="{ active: route.meta.featureId === 'lobby' }"
      >校园车队</RouterLink
    >
    <RouterLink
      v-if="featureFlags.profile"
      to="/profile"
      :class="{ active: route.meta.featureId === 'profile' }"
      >个人资料</RouterLink
    >
  </nav>
</template>
<style scoped>
.community-nav {
  display: flex;
  gap: 24px;
  border-bottom: 1px solid var(--line);
  margin: -6px 0 24px;
}
a {
  padding: 12px 0;
  color: var(--muted);
  font-size: 13px;
  border-bottom: 2px solid transparent;
}
a.active {
  color: var(--orange);
  border-color: var(--orange);
}
</style>
