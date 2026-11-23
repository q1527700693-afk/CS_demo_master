<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useUploadTask } from '@/features/replay/upload-task'
import { hasWebUpdate } from './web-update'

const task = useUploadTask()
const available = ref(false)
let timer: ReturnType<typeof setInterval> | undefined
let checking = false
let disposed = false

async function check() {
  if (disposed || checking || available.value || document.hidden) return
  checking = true
  const current = document.querySelector<HTMLMetaElement>('meta[name="web-build-id"]')?.content || ''
  const updated = await hasWebUpdate(current)
  if (!disposed) available.value = updated
  checking = false
}

function refresh() {
  if (task.busy || task.choosingPlayer) return
  const url = new URL(window.location.href)
  url.searchParams.set('_web', Date.now().toString(36))
  window.location.replace(url.href)
}

onMounted(() => {
  if (!document.querySelector('meta[name="web-build-id"]')) return
  void check()
  timer = setInterval(() => void check(), 5 * 60 * 1000)
  document.addEventListener('visibilitychange', check)
})
onUnmounted(() => {
  disposed = true
  clearInterval(timer)
  document.removeEventListener('visibilitychange', check)
})
</script>

<template>
  <div v-if="available" class="web-update-notice" role="status">
    <div>
      <strong>网页已更新</strong>
      <p>{{ task.busy || task.choosingPlayer ? 'Demo 处理完成后可刷新查看。' : '刷新后查看最新内容。' }}</p>
    </div>
    <button class="button secondary compact" :disabled="task.busy || task.choosingPlayer" @click="refresh">
      刷新页面
    </button>
  </div>
</template>

<style scoped>
.web-update-notice {
  position: fixed;
  z-index: 99;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 20px;
  width: max-content;
  max-width: calc(100vw - 32px);
  padding: 14px 18px;
  border: 1px solid #536d7a;
  border-radius: 12px;
  background: #18252e;
  color: #e1edf4;
  box-shadow: 0 8px 28px #0006;
  font-size: 13px;
}
.web-update-notice p {
  margin: 5px 0 0;
  color: #a5bbc9;
  font-size: 12px;
}
.web-update-notice button {
  flex-shrink: 0;
}
</style>
