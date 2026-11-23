// These milestones describe completed startup stages, not download byte counts.
export function reportStartupProgress(progress: number) {
  window.dispatchEvent(new CustomEvent('app:startup-progress', { detail: progress }))
}

export function combinedStartupProgress(app: number, minimumDisplay: number): number {
  // Only the gate may set 100, after initialization and the two-second display.
  return Math.min(99, Math.floor(Math.max(0, Math.min(app, minimumDisplay)) * 100))
}
