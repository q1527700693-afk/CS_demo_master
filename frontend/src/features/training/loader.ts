export interface MountedTrainer {
  element: HTMLElement
  destroy(): void
  exportSessions(): unknown[]
}

export interface TrainerModule {
  mountTrainer(
    container: HTMLElement,
    options: { embedded: boolean; onComplete?: (session: unknown) => void },
  ): MountedTrainer
}

// Readiness adapter for the supplied native module; never modifies its engine.
// A completed/error state is usable: the module owns any graphics error UI.
export async function waitForTrainerStartup(element: HTMLElement): Promise<void> {
  const native = element as HTMLElement & { graphicsLoading?: boolean }
  const styles = [
    ...(element.shadowRoot?.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]') || []),
  ]
  await Promise.all(
    styles.map((link) => {
      if (link.sheet) return Promise.resolve()
      return new Promise<void>((resolve) => {
        link.addEventListener('load', () => resolve(), { once: true })
        link.addEventListener('error', () => resolve(), { once: true })
      })
    }),
  )
  while (element.isConnected && native.graphicsLoading) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

declare global {
  interface Window {
    __csDemoTrainer?: TrainerModule
  }
}

let pending: Promise<TrainerModule> | undefined
let attempt = 0

export function loadTrainerModule(): Promise<TrainerModule> {
  if (window.__csDemoTrainer) return Promise.resolve(window.__csDemoTrainer)
  if (pending) return pending

  pending = new Promise<TrainerModule>((resolve, reject) => {
    const script = document.createElement('script')
    script.type = 'module'
    script.src = `${import.meta.env.BASE_URL}training-loader.js?attempt=${++attempt}`
    const timer = window.setTimeout(() => fail('训练资源加载超时，请刷新页面后重试'), 30_000)

    function cleanup() {
      window.clearTimeout(timer)
      script.onload = null
      script.onerror = null
    }

    function fail(message: string) {
      cleanup()
      script.remove()
      reject(new Error(message))
    }

    script.onload = () => {
      const module = window.__csDemoTrainer
      if (typeof module?.mountTrainer !== 'function') {
        fail('训练资源已加载，但挂载接口不可用，请刷新页面后重试')
        return
      }
      cleanup()
      resolve(module)
    }
    script.onerror = () => fail('无法加载训练资源，请确认启动同步成功后重试')
    document.head.appendChild(script)
  }).catch((error: unknown) => {
    pending = undefined
    throw error
  })

  return pending
}
