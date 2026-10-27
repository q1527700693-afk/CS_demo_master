// Optional browser QA. Install/use Playwright externally and set PLAYWRIGHT_MODULE.
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdir, readFile, writeFile } = require('node:fs/promises')
const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const project = path.resolve(__dirname, '..')
const base = process.env.TEST_URL || 'http://127.0.0.1:5174'
const output = path.join(project, 'test-results/training-integration')
const digest = (data) => createHash('sha256').update(data).digest('hex')

;(async () => {
  await mkdir(output, { recursive: true })
  const manifest = JSON.parse(
    await readFile(path.join(project, 'public/vector-trainer/integration-source.json'), 'utf8'),
  )
  for (const file of manifest.files) {
    const original = await readFile(path.join(project, manifest.source, file.path))
    const copied = await readFile(path.join(project, 'public/vector-trainer', file.path))
    assert.equal(digest(original), file.sha256, `Original changed: ${file.path}`)
    assert.equal(digest(copied), file.sha256, `Copied file changed: ${file.path}`)
  }
  const browser = await chromium.launch({
    executablePath:
      process.env.BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  const checks = [`${manifest.files.length} runtime files match original SHA-256`]
  const errors = []
  const failedRequests = []
  const cloudRequests = []
  let page
  try {
    page = await browser.newPage({
      viewport: { width: 1440, height: 1050 },
      reducedMotion: 'reduce',
    })
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('response', (response) => {
      if (response.status() >= 400 && response.url().includes('/vector-trainer/'))
        failedRequests.push(`${response.status()} ${response.url()}`)
    })
    page.on('request', (request) => {
      if (request.url().includes('/minigames/aim/')) cloudRequests.push(request.url())
    })
    const trainer = () => page.locator('vector-trainer')
    if (process.env.TEST_FORCE_LOAD_RETRY === '1') {
      let blocked = false
      await page.context().route('**/training-loader.js*', (route) => {
        if (!blocked) {
          blocked = true
          return route.abort('failed')
        }
        return route.continue()
      })
    }
    const state = (status) =>
      page.waitForFunction(
        (value) => document.querySelector('vector-trainer')?.engine.state === value,
        status,
        { timeout: 12000 },
      )
    async function finish() {
      await trainer().evaluate((element) => {
        element.engine.lastTime -= element.engine.config.duration * 1000 - element.engine.elapsedMs
      })
      await state('finished')
      await page.locator('[data-action="retry"]').waitFor()
    }
    async function start(mode) {
      await page.locator(`[data-mode="${mode}"]`).click()
      if (mode !== 'reaction') await page.locator('#input-mode').selectOption('pointer')
      await page.locator('[data-action="start"]').click()
      await state('running')
    }
    await page.goto(base + '/training', { waitUntil: 'networkidle' })
    if (process.env.TEST_FORCE_LOAD_RETRY === '1') {
      await page.getByRole('button', { name: '重新加载', exact: true }).click({ timeout: 10000 })
      checks.push('native public-module loader recovers after an initial network failure')
    }
    await trainer().waitFor()
    assert.equal(await page.locator('vite-error-overlay').count(), 0)
    await page.waitForFunction(
      () => document.querySelector('vector-trainer')?.graphics?.assetsReady,
      { timeout: 30000 },
    )
    assert.equal(await page.locator('[data-mode]').count(), 5)
    assert.equal(await page.locator('.training-grid, .training-result, .game-frame').count(), 0)
    assert.equal(await trainer().getAttribute('embedded'), '')
    await page.screenshot({ path: path.join(output, 'training-desktop.png'), fullPage: true })
    checks.push(
      'complete native module, five modes and original 3D resources; old training UI removed',
    )

    await start('gridshot')
    const point = await trainer().evaluate((element) =>
      element.graphics.project(element.engine.targets[0]),
    )
    await page.mouse.click(point.x, point.y)
    assert.equal(await trainer().evaluate((element) => element.engine.hits), 1)
    await page.keyboard.press('Escape')
    await state('paused')
    await page.locator('[data-action="resume"]').click()
    await state('running')
    await finish()
    assert.equal(await trainer().evaluate((element) => element.lastResult.metrics.hits), 1)
    assert.equal(await page.locator('.result-card').count(), 1)
    await page.screenshot({ path: path.join(output, 'training-result.png'), fullPage: true })
    checks.push('original Gridshot input, pause/resume, score and result UI')

    await page.locator('[data-action="fullscreen"]').click()
    await page.waitForFunction(() =>
      document.querySelector('vector-trainer')?.hasAttribute('expanded'),
    )
    await page.locator('[data-action="fullscreen"]').click()
    await page.waitForFunction(
      () => !document.querySelector('vector-trainer')?.hasAttribute('expanded'),
    )
    checks.push('original full-screen / window-large controls inside the app')

    await start('reaction')
    assert.equal(await page.locator('#arena').isVisible(), false)
    await page.waitForFunction(
      () => document.querySelector('vector-trainer')?.engine.reactionPhase === 'ready',
      { timeout: 8000 },
    )
    const surface = await page.locator('#reaction-surface').boundingBox()
    await page.mouse.click(surface.x + surface.width / 2, surface.y + surface.height / 2)
    assert.equal(await trainer().evaluate((element) => element.engine.reactions.length), 1)
    await finish()
    assert.ok(await trainer().evaluate((element) => element.lastResult.metrics.reactionMs > 0))
    checks.push('original reaction signal and millisecond result')

    for (const mode of ['spidershot', 'microshot', 'tracking']) {
      await start(mode)
      assert.equal(await trainer().evaluate((element) => element.engine.config.mode), mode)
      if (mode !== 'tracking') {
        const target = await trainer().evaluate((element) =>
          element.graphics.project(element.engine.targets[0]),
        )
        await page.mouse.click(target.x, target.y)
        assert.equal(await trainer().evaluate((element) => element.engine.hits), 1)
      }
      await finish()
    }
    checks.push('all remaining original aiming modes start and finish')

    await page.locator('.nav [data-view="history"]').click()
    assert.equal(await page.locator('tbody tr').count(), 5)
    await page.locator('[data-filter="reaction"]').click()
    assert.equal(await page.locator('tbody tr').count(), 1)
    await page.locator('.nav [data-view="guide"]').click()
    await page.getByRole('heading', { name: '操作', exact: true }).waitFor()
    checks.push('original history, filtering and tutorial')

    await trainer().evaluate((element) => {
      window.__previousTrainer = element
    })
    await page.getByRole('link', { name: '总览', exact: true }).click()
    await page.locator('vector-trainer').waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => window.__previousTrainer.mounted), false)
    assert.equal(await page.evaluate(() => window.__previousTrainer.abort.signal.aborted), true)
    assert.equal(await page.evaluate(() => window.__previousTrainer.graphics?.disposed), true)
    assert.equal(await page.evaluate(() => document.pointerLockElement === null), true)
    checks.push('route teardown releases animation/input resources and WebGL')

    await page.getByRole('link', { name: '瞄准训练', exact: false }).click()
    await trainer().waitFor()
    assert.equal(await trainer().evaluate((element) => element.store.sessions.length), 5)
    for (const width of [1280, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 950 })
      await page.locator('[data-action="start"]').waitFor()
      await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth, {
        timeout: 5000,
      })
      const sizes = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
      }))
      assert.ok(sizes.scroll <= sizes.width, `Horizontal overflow at ${width}: ${sizes.scroll}`)
      await page.screenshot({ path: path.join(output, `training-${width}.png`), fullPage: true })
    }
    checks.push('1280 / 1024 / 768 / 390 layouts and persisted original history')

    await page.goto(base + '/training/gridshot', { waitUntil: 'networkidle' })
    await trainer().waitFor()
    assert.equal(new URL(page.url()).pathname, '/training')
    assert.deepEqual(cloudRequests, [])
    assert.deepEqual(failedRequests, [])
    assert.deepEqual(errors, [])
    checks.push('legacy route redirects and no fabricated cloud scores or failed runtime requests')
    await writeFile(
      path.join(output, 'result.json'),
      JSON.stringify({ checks, errors, failedRequests }, null, 2),
    )
    console.log(JSON.stringify({ checks, errors, failedRequests }, null, 2))
  } catch (error) {
    if (page) {
      await page
        .screenshot({ path: path.join(output, 'failure.png'), fullPage: true })
        .catch(() => {})
      console.error('PAGE', (await page.locator('body').innerText()).slice(-2500))
    }
    console.error('BROWSER ERRORS', errors, 'FAILED RESOURCES', failedRequests)
    throw error
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
