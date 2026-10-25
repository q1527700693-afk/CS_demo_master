// Collect only initial-page work. Later page navigation doesn't reopen the splash.
const pending = new Set<Promise<void>>()
let collecting = true

export function trackStartup<T>(task: Promise<T>): Promise<T> {
  if (collecting) {
    const settled = task.then(
      () => {},
      () => {},
    )
    pending.add(settled)
    void settled.then(() => pending.delete(settled))
  }
  return task
}

export async function waitForStartupTasks() {
  while (pending.size) await Promise.all([...pending])
  collecting = false
}
