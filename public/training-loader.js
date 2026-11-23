// Integration entry only. Load the unmodified public runtime as a native browser
// module, outside Vite's source import transforms (in development and production).
import { mountTrainer } from './vector-trainer/src/app.js'

window.__csDemoTrainer = { mountTrainer }
