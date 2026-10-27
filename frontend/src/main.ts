import { createStartupSplash } from './app/startup-splash'

// Keep the entry small: video playback and app loading start independently.
const splash = createStartupSplash()
import('./app/bootstrap')
  .then(({ bootstrap }) => bootstrap())
  .then(() => splash.ready())
  .catch((error: unknown) => {
    console.error('Application startup failed:', error)
    splash.fail()
  })
