import { MIN_STARTUP_MS, StartupGate } from './startup-gate'
import { combinedStartupProgress } from './startup-progress'

export function createStartupSplash() {
  const overlay = document.querySelector<HTMLElement>('#startup-splash')!
  const video = document.querySelector<HTMLVideoElement>('#startup-video')!
  const root = document.querySelector<HTMLElement>('#app')!
  const status = document.querySelector<HTMLElement>('#startup-status')!
  const progress = document.querySelector<HTMLElement>('#startup-progress')!
  const fill = document.querySelector<HTMLElement>('#startup-progress-fill')!
  const percent = document.querySelector<HTMLElement>('#startup-percent')!
  const reloadButton = document.querySelector<HTMLButtonElement>('#startup-reload')!
  const events = new AbortController()
  const options = { signal: events.signal }
  const startedAt = performance.now()
  let failed = false
  let leaving = false
  let appProgress = 0.05
  let displayedProgress = 0
  let minimumTimer: ReturnType<typeof setTimeout> | undefined
  let progressTimer: ReturnType<typeof setInterval> | undefined

  function clearTimers() {
    clearTimeout(minimumTimer)
    clearInterval(progressTimer)
  }

  const gate = new StartupGate(() => {
    if (leaving || failed) return
    leaving = true
    renderProgress(100)
    events.abort()
    clearTimers()
    video.pause()
    root.removeAttribute('aria-hidden')
    root.inert = false
    document.body.classList.remove('starting')
    overlay.classList.add('leaving')
    setTimeout(() => {
      const hadFocus = overlay.contains(document.activeElement)
      overlay.remove()
      video.removeAttribute('src')
      video.load()
      if (hadFocus) {
        root.tabIndex = -1
        root.focus({ preventScroll: true })
      }
      window.dispatchEvent(new Event('app:started'))
    }, 220)
  })

  function renderProgress(value: number) {
    displayedProgress = Math.max(displayedProgress, value)
    progress.setAttribute('aria-valuenow', String(displayedProgress))
    fill.style.width = `${displayedProgress}%`
    percent.textContent = `${displayedProgress}%`
  }

  function updateProgress() {
    if (leaving || failed) return
    const minimumDisplay = Math.min(1, (performance.now() - startedAt) / MIN_STARTUP_MS)
    renderProgress(combinedStartupProgress(appProgress, minimumDisplay))
  }

  window.addEventListener(
    'app:startup-progress',
    ((event: CustomEvent<number>) => {
      if (Number.isFinite(event.detail)) {
        appProgress = Math.max(appProgress, Math.min(0.99, event.detail))
        updateProgress()
      }
    }) as EventListener,
    options,
  )
  function keepSilent() {
    video.defaultMuted = true
    if (!video.muted) video.muted = true
    if (video.volume !== 0) video.volume = 0
  }
  keepSilent()
  video.addEventListener('volumechange', keepSilent, options)

  function play() {
    if (leaving || video.error) return
    // The video is decorative: autoplay rejection never blocks startup.
    void video.play().catch(() => {})
  }

  video.addEventListener(
    'ended',
    () => {
      if (!leaving) {
        video.currentTime = 0
        play()
      }
    },
    options,
  )
  video.addEventListener(
    'error',
    () => {
      video.hidden = true
    },
    options,
  )
  reloadButton.addEventListener('click', () => window.location.reload(), options)

  minimumTimer = setTimeout(() => {
    updateProgress()
    gate.minimumElapsed()
  }, MIN_STARTUP_MS)
  progressTimer = setInterval(updateProgress, 80)
  if (video.error) video.hidden = true
  else play()

  return {
    ready() {
      appProgress = 1
      updateProgress()
      gate.appReady()
    },
    fail() {
      failed = true
      reloadButton.hidden = false
      clearTimers()
      status.textContent = '应用启动失败，请重新加载。'
    },
  }
}
