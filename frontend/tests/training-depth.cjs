// Pixel-level regression for the real WebGL compositor, in an isolated browser.
// API fixtures stay in this browser; no production account or record is created.
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs/promises')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))
const base = process.env.TEST_URL || 'http://127.0.0.1:4173/'
const output = process.env.QA_OUTPUT || path.resolve(__dirname, '../../docs/frontend-v1.3.2/qa/local')
const app = process.env.TRAINING_APP === '1'

;(async () => {
  await fs.mkdir(output, { recursive: true })
  const browser = await chromium.launch({ channel: process.env.QA_BROWSER || 'msedge', headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1050 }, reducedMotion: 'reduce' })
    if (app && process.env.QA_GUEST !== '1') {
      await context.addInitScript(() => localStorage.setItem('csdm.token', 'qa-only-not-a-server-token'))
      await context.route('**/api/v1/**', route => {
        const url = new URL(route.request().url())
        let data = { items: [], total: 0, page: 1, page_size: 20, incoming: [], outgoing: [] }
        if (url.pathname.endsWith('/users/me')) data = { id: 999999, username: 'QA', nickname: '画面验证', avatar_url: null, created_at: '2026-11-20T00:00:00Z' }
        return route.fulfill({ json: { code: 0, message: 'success', data } })
      })
    }
    const page = await context.newPage()
    const errors = [], failedResources = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('response', response => { if (response.status() >= 400 && /vector-trainer|training-loader/.test(response.url())) failedResources.push(response.url()) })
    let legacyRendererSeen = false
    if (process.env.QA_PREWARM_URL) {
      await page.goto(process.env.QA_PREWARM_URL)
      await page.waitForFunction(() => document.querySelector('vector-trainer')?.graphics?.assetsReady, { timeout: 60000 })
      legacyRendererSeen = await page.locator('vector-trainer').evaluate(element => element.graphics.render.toString().includes('draw them last'))
      assert.equal(legacyRendererSeen, true, 'the same browser must first load the original buggy renderer into its cache')
    }
    await page.goto(base)
    await page.waitForFunction(() => document.querySelector('vector-trainer')?.graphics?.assetsReady, { timeout: 60000 })
    const el = page.locator('vector-trainer')
    const moduleRelease = await page.evaluate(() => {
      const revision = document.querySelector('meta[name="web-build-id"]')?.getAttribute('content')
      const modules = performance.getEntriesByType('resource').map(item => new URL(item.name)).filter(url => /\/vector-trainer\/.*\.js$/.test(url.pathname) || url.pathname.endsWith('/training-loader.js'))
      return { revision, urls: modules.map(url => url.pathname + url.search), allVersioned: modules.length > 5 && modules.every(url => url.searchParams.get('revision') === revision) }
    })
    if (process.env.QA_PREWARM_URL || process.env.QA_EXPECT_VERSIONED === '1') assert.equal(moduleRelease.allVersioned, true, 'the loader, app, renderer and vendor module graph must use the current release')
    const depth = await el.evaluate(element => {
      const g = element.graphics, engine = element.engine, gl = g.renderer.getContext()
      const saved = { state: engine.state, config: engine.config, targets: engine.targets, look: engine.look }
      let time = performance.now() + 1000
      const cases = []
      const pixels = () => { const p = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4); gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, p); return p }
      const draw = (targets, weapon) => { engine.targets = targets; g.weapon.root.visible = weapon; g.render(engine, time += 1000, true); return pixels() }
      const delta = (a, b, i) => Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i+1] - b[i+1]), Math.abs(a[i+2] - b[i+2]))
      engine.state = 'running'; engine.look = { yaw: 0, pitch: 0 }
      const targets = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, x: 500 + i % 3 * 170, y: 281 + Math.floor(i / 3) * 140, radius: 85 }))
      for (const aspect of [1, 16/9, 21/9]) {
        // Canvas CSS is restored before returning; only the isolated QA page changes.
        element.canvas.style.width = '960px'; element.canvas.style.height = `${960 / aspect}px`
        for (const fov of [50, 64, 100]) {
          engine.config = { ...saved.config, mode: 'gridshot', input: 'locked', fov }
          const room = draw([], false), weapon = draw([], true), target = draw(targets, false), combined = draw(targets, true)
          let overlap = 0, wrongForeground = 0, visibleTarget = 0
          const stride = gl.drawingBufferWidth * 4
          for (let i = 0; i < room.length; i += 4) {
            if (delta(target, room, i) < 35) continue
            if (delta(weapon, room, i) > 35) {
              // Exclude silhouette pixels blended with the background by MSAA.
              if ([-2*stride, -stride, stride, 2*stride, -8, -4, 4, 8].some(offset => i+offset < 0 || i+offset >= room.length || delta(weapon, room, i+offset) <= 35)) continue
              overlap++; if (delta(combined, weapon, i) > 6) wrongForeground++
            }
            else if (delta(combined, target, i) < 6) visibleTarget++
          }
          assertBrowser(overlap > 100 && visibleTarget > 100, 'test must cover both overlapping and exposed target pixels')
          assertBrowser(wrongForeground / overlap < .005, `target painted over gun: ${wrongForeground}/${overlap}`)
          cases.push({ aspect, fov, overlap, wrongForeground, visibleTarget })
        }
      }
      // Negative control: the former rendering order must visibly fail this check.
      const weapon = draw([], true)
      draw(targets, true)
      g.renderer.setRenderTarget(null); g.renderer.render(g.scene, g.camera)
      g.renderer.autoClear = false; g.renderer.clearDepth(); g.renderer.render(g.weaponScene, g.weaponCamera)
      g.renderer.clearDepth(); g.renderer.render(g.targetScene, g.camera); g.renderer.autoClear = true
      const wrong = pixels(), room = draw([], false), target = draw(targets, false)
      let detectedOldBug = 0
      for (let i = 0; i < room.length; i += 4) if (delta(target, room, i) > 35 && delta(weapon, room, i) > 35 && delta(wrong, weapon, i) > 6) detectedOldBug++
      assertBrowser(detectedOldBug > 100, 'negative control must detect the original bug')
      engine.state = saved.state; engine.config = saved.config; engine.targets = saved.targets; engine.look = saved.look
      element.canvas.style.width = ''; element.canvas.style.height = ''; g.weapon.root.visible = true
      g.render(engine, time += 1000, true)
      return { cases, detectedOldBug }
      function assertBrowser(ok, message) { if (!ok) throw new Error(message) }
    })
    // Let the resize observer settle before acquiring Pointer Lock.
    await page.waitForTimeout(300)
    // Start through the UI so the real Pointer Lock requirement is satisfied.
    await page.locator('[data-action="start"]').click()
    await page.waitForFunction(() => document.querySelector('vector-trainer')?.engine.state === 'running')
    // Use the real input event after aligning the same 3D ray used by scoring.
    await el.evaluate(element => {
      const now = performance.now(), e = element.engine
      element.lockPending = false
      e.start({ ...element.config, mode: 'gridshot', duration: 90 }, now)
      e.beginRunning(now)
      e.targets = [{ id: 901, x: 500, y: 281.25, radius: 30 }, { id: 902, x: 670, y: 421, radius: 30 }, { id: 903, x: 330, y: 141, radius: 30 }]
      e.look = { yaw: 0, pitch: 0 }
      element.lastState = ''; element.renderOverlay(); element.updateHUD()
    })
    await page.mouse.down()
    await page.mouse.up()
    assert.equal(await el.evaluate(element => element.engine.hits), 1, 'a real mouse event must hit the centered 3D target')
    await el.evaluate(element => {
      // Reproduce the screenshot's downward target cluster with the corrected depth.
      const e = element.engine
      e.look = { yaw: .08, pitch: .12 }
      e.targets = [{ id: 901, x: 500, y: 421, radius: 27 }, { id: 902, x: 670, y: 421, radius: 27 }, { id: 903, x: 330, y: 421, radius: 27 }]
    })
    await page.waitForTimeout(300)
    if (await el.evaluate(element => element.engine.state === 'paused')) {
      await page.locator('[data-action="resume"]').click()
      await page.waitForFunction(() => document.querySelector('vector-trainer')?.engine.state === 'running')
    }
    assert.equal(await el.evaluate(element => element.engine.state), 'running')
    const scene = await el.evaluate(element => {
      element.graphics.render(element.engine, performance.now() + 1000, true)
      return element.canvas.toDataURL('image/png')
    })
    await fs.writeFile(path.join(output, 'training-scene-v1.3.2.png'), Buffer.from(scene.split(',')[1], 'base64'))
    // Match the reported Spidershot failure: one distant ball crosses the
    // silencer silhouette. Capture both compositors at exactly the same pose.
    const comparison = await el.evaluate(element => {
      const g = element.graphics, e = element.engine
      e.config = { ...e.config, mode: 'spidershot' }; e.look = { yaw: 0, pitch: 0 }
      const tangent = Math.tan(e.config.fov * Math.PI / 360)
      e.targets = [{ id: 901, x: 500 + .17 * 12 * tangent * g.camera.aspect / .012, y: 281.25 + .06 * 12 * tangent / .012, radius: 27 }]
      g.render(e, performance.now() + 2000, true)
      const after = element.canvas.toDataURL('image/png')
      g.renderer.render(g.scene, g.camera)
      g.renderer.autoClear = false; g.renderer.clearDepth(); g.renderer.render(g.weaponScene, g.weaponCamera)
      g.renderer.clearDepth(); g.renderer.render(g.targetScene, g.camera); g.renderer.autoClear = true
      const before = element.canvas.toDataURL('image/png')
      g.render(e, performance.now() + 3000, true)
      return { before, after }
    })
    for (const [name, data] of Object.entries(comparison)) await fs.writeFile(path.join(output, `spidershot-${name}.png`), Buffer.from(data.split(',')[1], 'base64'))
    await page.evaluate(() => document.exitPointerLock())
    await page.waitForTimeout(150)
    await page.screenshot({ path: path.join(output, 'training-v1.3.2.png'), fullPage: true })
    assert.deepEqual(failedResources, [])
    assert.deepEqual(errors, [])
    const result = { base, legacyRendererSeen, moduleRelease, depth, realMouseHit: true, errors, failedResources }
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result))
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
