import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'
export const worker = setupWorker(...handlers)
let starting: ReturnType<typeof worker.start> | undefined
export const startMocks = () =>
  (starting ??= worker.start({ onUnhandledRequest: 'bypass', quiet: true, serviceWorker: { url: '/mockServiceWorker.js' } })
    .catch(error => { starting = undefined; throw error }))

export async function ensureAnalysisMocks() {
  await startMocks()
  const { analysisHandlers } = await import('./analysis-handlers')
  const registered = worker.listHandlers()
  if (!analysisHandlers.every((handler) => registered.includes(handler)))
    worker.use(...analysisHandlers)
}

// A long-lived development tab must use the same handlers as the updated UI.
if (import.meta.hot) {
  import.meta.hot.accept('./handlers', (module) => {
    if (module) worker.resetHandlers(...module.handlers)
  })
}
