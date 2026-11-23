// Optional real-browser QA. Uses external Playwright via PLAYWRIGHT_MODULE.
const assert = require('node:assert/strict')
const { mkdir, writeFile } = require('node:fs/promises')
const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.TEST_URL || 'http://127.0.0.1:5174'
const output = path.resolve(__dirname, '../test-results/startup')

;(async () => {
  await mkdir(output, { recursive: true })
  const browser = await chromium.launch({
    executablePath:
      process.env.BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  const checks = []
  const errors = []
  async function newPage(options = {}) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options })
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(() => {
      window.__startupTest = { cycles: 0, started: 0, progress: [] }
      document.addEventListener('DOMContentLoaded', () => {
        const progress = document.getElementById('startup-progress')
        new MutationObserver(() => {
          window.__startupTest.progress.push({
            value: Number(progress.getAttribute('aria-valuenow')),
            cycles: window.__startupTest.cycles,
            ended: document.querySelector('video')?.ended || false,
            time: performance.now(),
          })
        }).observe(progress, { attributes: true, attributeFilter: ['aria-valuenow'] })
        document
          .querySelector('video')
          .addEventListener('ended', () => window.__startupTest.cycles++)
      })
      window.addEventListener('app:started', () => {
        window.__startupTest.started = performance.now()
      })
    })
    return { page, context }
  }
  async function entered(page) {
    await page.locator('#startup-splash').waitFor({ state: 'detached', timeout: 25000 })
    assert.equal(await page.locator('#app').getAttribute('aria-hidden'), null)
    assert.equal(await page.locator('#app').evaluate((element) => element.inert), false)
    await page.locator('main').waitFor()
  }
  try {
    {
      const { page, context } = await newPage()
      await page.goto(base, { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => document.querySelector('video').currentTime > 0.3)
      assert.equal(await page.locator('#app').evaluate((element) => element.inert), true)
      assert.equal(
        await page
          .locator('video')
          .evaluate((video) => video.getBoundingClientRect().height <= innerHeight),
        true,
      )
      await page.screenshot({ path: path.join(output, 'desktop.png') })
      assert.equal(await page.locator('#startup-sound').count(), 0)
      assert.equal(await page.locator('#startup-status').innerText(), '正在加载…')
      await page.locator('#app main').waitFor({ state: 'attached' })
      const partial = Number(await page.locator('#startup-progress').getAttribute('aria-valuenow'))
      assert.ok(partial > 0 && partial < 100, `Progress before minimum display: ${partial}`)
      await page.locator('video').evaluate((video) => {
        video.muted = false
        video.volume = 1
      })
      await page.waitForFunction(
        () => document.querySelector('video').muted && document.querySelector('video').volume === 0,
      )
      await entered(page)
      const timing = await page.evaluate(() => window.__startupTest)
      assert.ok(timing.started >= 2000 && timing.started < 5056, JSON.stringify(timing))
      assert.equal(timing.cycles, 0)
      assert.ok(timing.progress.some((item) => item.value === 100))
      assert.ok(timing.progress.every((item) => item.value < 100 || item.time >= 2000))
      assert.ok(
        timing.progress.every(
          (item, index) => index === 0 || item.value >= timing.progress[index - 1].value,
        ),
      )
      await page.locator('nav a[href="/lobbies"]').click()
      await page.waitForURL('**/lobbies')
      assert.equal(await page.locator('#startup-splash').count(), 0)
      checks.push(
        'silent, generic loading copy, progress completes after two seconds before the video ends; inert background and no replay on navigation',
      )
      await context.close()
    }
    {
      const { page, context } = await newPage()
      let release
      const hold = new Promise((resolve) => {
        release = resolve
      })
      await context.route(
        /\/src\/app\/bootstrap\.ts|\/assets\/bootstrap-[^/]+\.js/,
        async (route) => {
          await hold
          await route.continue()
        },
      )
      await page.goto(base, { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => window.__startupTest.cycles >= 2, { timeout: 20000 })
      assert.equal(await page.locator('#startup-splash').isVisible(), true)
      assert.ok(Number(await page.locator('#startup-progress').getAttribute('aria-valuenow')) < 100)
      release()
      await entered(page)
      checks.push(
        'video starts while app code loads, repeats across two full cycles, then exits when a slow app becomes ready',
      )
      await context.close()
    }
    // This data-delay case hooks fetch after MSW starts, before the initial page
    // runs. It exercises real page readiness rather than simulating video events.
    if (!process.env.TEST_PRODUCTION) {
      const { page, context } = await newPage()
      let releasePage
      let pageRequested
      const requested = new Promise((resolve) => {
        pageRequested = resolve
      })
      const hold = new Promise((resolve) => {
        releasePage = resolve
      })
      await context.route('**/src/features/lobby/LobbyPage.vue*', async (route) => {
        pageRequested()
        await hold
        await route.continue()
      })
      await page.goto(base + '/lobbies', { waitUntil: 'domcontentloaded' })
      await requested
      await page.evaluate(() => {
        const original = window.fetch
        const held = new Promise((resolve) => {
          window.__releaseData = resolve
        })
        window.fetch = async (...args) => {
          if (String(args[0]).includes('/lobbies?')) {
            window.__dataPending = true
            await held
          }
          return original(...args)
        }
      })
      releasePage()
      await page.waitForFunction(() => window.__dataPending && window.__startupTest.cycles >= 1)
      assert.equal(await page.locator('#startup-splash').isVisible(), true)
      assert.equal(await page.locator('#app main h1').count(), 1)
      assert.ok(Number(await page.locator('#startup-progress').getAttribute('aria-valuenow')) < 100)
      await page.evaluate(() => window.__releaseData())
      await entered(page)
      checks.push(
        'mounted initial page keeps the video running until its pending API request resolves',
      )
      await context.close()
    }
    {
      const { page, context } = await newPage()
      await page.goto(base, { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => document.querySelector('video').currentTime > 0.2)
      await page.locator('video').evaluate((video) => video.pause())
      assert.ok(Number(await page.locator('#startup-progress').getAttribute('aria-valuenow')) < 100)
      await entered(page)
      const timing = await page.evaluate(() => window.__startupTest)
      assert.equal(timing.cycles, 0)
      assert.ok(timing.started >= 2000 && timing.started < 5056)
      checks.push('paused video never delays a ready app beyond the two-second minimum')
      await context.close()
    }
    {
      const { page, context } = await newPage()
      await context.route('**/media/startup.mp4', (route) =>
        route.fulfill({ status: 404, body: 'missing' }),
      )
      await page.goto(base, { waitUntil: 'domcontentloaded' })
      await entered(page)
      const timing = await page.evaluate(() => window.__startupTest)
      assert.ok(timing.started >= 2000 && timing.started < 5056)
      checks.push(
        'missing video does not block automatic entry after two seconds and app readiness',
      )
      await context.close()
    }
    {
      const { page, context } = await newPage()
      let blocked = false
      await context.route(/\/src\/app\/bootstrap\.ts|\/assets\/bootstrap-[^/]+\.js/, (route) => {
        if (!blocked) {
          blocked = true
          return route.abort('failed')
        }
        return route.continue()
      })
      await page.goto(base, { waitUntil: 'domcontentloaded' })
      await page.locator('#startup-reload').waitFor()
      assert.equal(await page.locator('#app').evaluate((element) => element.inert), true)
      await page.locator('#startup-reload').click()
      await entered(page)
      checks.push('fatal application load error remains recoverable through reload')
      await context.close()
    }
    {
      const { page, context } = await newPage({ viewport: { width: 390, height: 844 } })
      await page.goto(base, { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => document.querySelector('video').currentTime > 1)
      assert.equal(
        await page.locator('video').evaluate((video) => getComputedStyle(video).objectFit),
        'contain',
      )
      assert.equal(
        await page
          .locator('video')
          .evaluate((video) => video.getBoundingClientRect().height <= innerHeight),
        true,
      )
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.screenshot({ path: path.join(output, 'mobile.png') })
      await entered(page)
      checks.push(
        '390px mobile layout preserves the full video without cropping or horizontal overflow',
      )
      await context.close()
    }
    assert.deepEqual(errors, [])
    await writeFile(path.join(output, 'result.json'), JSON.stringify({ checks, errors }, null, 2))
    console.log(JSON.stringify({ checks, errors }, null, 2))
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
