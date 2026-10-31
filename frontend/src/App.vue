<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import UploadTaskBanner from '@/features/replay/UploadTaskBanner.vue'
import AppLayout from '@/layouts/AppLayout.vue'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { router } from '@/app/router'
const auth = useAuthStore()
const toast = useToastStore()
function expired() {
  auth.clear()
  toast.show('登录已失效，请重新登录', 'error')
  if (router.currentRoute.value.meta.requiresAuth)
    void router.push({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } })
}
onMounted(() => window.addEventListener('auth:expired', expired))
onUnmounted(() => window.removeEventListener('auth:expired', expired))
</script>
<template>
  <AppLayout><RouterView /></AppLayout>
  <UploadTaskBanner />
  <div class="toast-stack" aria-live="polite">
    <div v-for="item in toast.messages" :key="item.id" class="toast" :class="item.kind">
      {{ item.text }}
    </div>
  </div>
</template>
