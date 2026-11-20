const { test } = require('node:test')
const assert = require('node:assert/strict')

test('every native module edge, including the deferred renderer, changes with the build', async () => {
  const { stampTrainingImports } = await import('../scripts/training-release.mjs')
  const source = `import { mountTrainer } from './vector-trainer/src/app.js'
import * as THREE from '../vendor/three/three.module.js';
import './side-effect.js';
export { value } from './shared.js';
import('./renderer.js').then(load);
const style = new URL('../styles.css',import.meta.url);
const asset = new URL('../assets/arms.glb',import.meta.url);`
  const first = stampTrainingImports(source, 'web-old')
  const next = stampTrainingImports(source, 'web-new')
  assert.equal((next.match(/\?revision=web-new/g) || []).length, 6)
  assert.ok(next.includes("import('./renderer.js?revision=web-new')"))
  assert.ok(next.includes("'../assets/arms.glb'"), 'unchanged large assets retain their cache keys')
  assert.notEqual(first, next)
  assert.equal(stampTrainingImports(next, 'web-new'), next)
  assert.equal(stampTrainingImports(first, 'web-new'), next)
})
