import type { AiCoachReport } from './contracts'
export async function waitForQueuedAi(
  initial: AiCoachReport,
  signal: AbortSignal,
  read: () => Promise<AiCoachReport>,
  interval = 1500,
): Promise<AiCoachReport> {
  let result = initial
  while (result.ai_status === 'queued' || result.queued) {
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer)
        reject(new DOMException('AI 查询已取消', 'AbortError'))
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort)
        resolve()
      }, interval)
      if (signal.aborted) {
        abort()
        return
      }
      signal.addEventListener('abort', abort, { once: true })
    })
    result = await read()
    if (result.last_error && !result.queued) throw new Error(result.last_error)
  }
  if (result.last_error && result.ai_status !== 'completed') throw new Error(result.last_error)
  return result
}
