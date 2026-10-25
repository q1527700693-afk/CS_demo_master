import { createApp, nextTick } from 'vue'
import { createPinia } from 'pinia'
import App from '@/App.vue'
import { router } from './router'
import { hasMocks } from './config'
import { waitForStartupTasks } from './startup-tasks'
import { reportStartupProgress } from './startup-progress'
import '@/styles.css'

export async function bootstrap() {
  reportStartupProgress(0.15)
  if (hasMocks) {
    const { startMocks } = await import('@/mocks/browser')
    await startMocks()
  }
  reportStartupProgress(0.3)
  const app = createApp(App)
  app.use(createPinia())
  app.use(router)
  await router.isReady()
  reportStartupProgress(0.55)
  app.mount('#app')
  await nextTick()
  reportStartupProgress(0.65)
  await waitForStartupTasks()
  reportStartupProgress(0.9)
  await document.fonts.ready
  reportStartupProgress(0.95)
  await nextTick()
  // Let the initialized page finish layout behind the splash before revealing it.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}
