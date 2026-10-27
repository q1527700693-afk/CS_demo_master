export const MIN_STARTUP_MS = 2000

/** Enter once initialization and the short minimum display have both finished. */
export class StartupGate {
  private ready = false
  private minimumPassed = false
  private entered = false

  constructor(private readonly enter: () => void) {}

  appReady() {
    this.ready = true
    this.check()
  }

  minimumElapsed() {
    this.minimumPassed = true
    this.check()
  }

  private check() {
    if (this.ready && this.minimumPassed && !this.entered) {
      this.entered = true
      this.enter()
    }
  }
}
