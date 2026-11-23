<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { errorMessage } from '@/api/http'
import { loadTrainerModule, waitForTrainerStartup } from './loader'
import type { MountedTrainer } from './loader'
import { trackStartup } from '@/app/startup-tasks'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { TOKEN_KEY } from '@/app/config'
import { recordTrainingSession } from './records'

const container = ref<HTMLElement | null>(null)
const auth = useAuthStore()
const toast = useToastStore()
const loading = ref(true)
const error = ref('')
let trainer: MountedTrainer | undefined
let disposed = false
let attempt = 0
function sessionToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

async function mount() {
  const current = ++attempt
  loading.value = true
  error.value = ''
  trainer?.destroy()
  trainer = undefined
  try {
    const module = await loadTrainerModule()
    if (disposed || current !== attempt || !container.value) return
    // Use the teammate's public mount/destroy contract. The native Shadow DOM
    // module owns all settings, modes, results and local history, unchanged.
    const owner = auth.user
      ? { id: auth.user.id, username: auth.user.username, createdAt: auth.user.createdAt }
      : null
    const token = sessionToken()
    trainer = module.mountTrainer(container.value, {
      embedded: true,
      onComplete(session) {
        // A login/session change during this mount must never reassign a result.
        if (
          !owner ||
          !token ||
          disposed ||
          current !== attempt ||
          auth.user?.id !== owner.id ||
          sessionToken() !== token
        )
          return
        if (recordTrainingSession(owner, session) === 'unavailable')
          toast.show(
            '本机名片战绩未能保存，请检查浏览器存储空间。游戏原有记录仍由训练模块管理。',
            'error',
          )
      },
    })
  } catch (cause) {
    if (disposed || current !== attempt) return
    trainer?.destroy()
    trainer = undefined
    error.value = `瞄准训练加载失败：${errorMessage(cause)}`
  } finally {
    if (!disposed && current === attempt) loading.value = false
  }
}

onMounted(() =>
  trackStartup(
    (async () => {
      await mount()
      if (trainer) await waitForTrainerStartup(trainer.element)
    })(),
  ),
)
onBeforeUnmount(() => {
  disposed = true
  attempt++
  trainer?.destroy()
})
</script>

<template>
  <section class="vector-training-page" aria-label="瞄准训练">
    <div v-if="loading" class="state-panel" role="status">
      <span class="spinner" />正在加载瞄准训练…
    </div>
    <div v-if="error" class="state-panel" role="alert">
      <p>{{ error }}</p>
      <button class="button secondary" @click="mount">重新加载</button>
    </div>
    <div ref="container" v-show="!loading && !error" class="vector-training-container" />
  </section>
</template>

<style scoped>
.vector-training-page {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
}
.vector-training-container {
  width: 100%;
  min-width: 0;
}
</style>
