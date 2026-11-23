// Frontend regression: real-account mode + demo replay, including a stale handler registry.
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = path.resolve(__dirname, '..')
process.env.VITE_MOCK_AUTH = 'false'
process.env.VITE_MOCK_PROFILE = 'false'
process.env.VITE_MOCK_REPLAY = 'true'
process.env.VITE_MOCK_LOBBY = 'false'
let vite, browser
;(async () => {
  const { createServer } = await import(
    pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js'))
  )
  vite = await createServer({ root, server: { port: 15173, strictPort: false, host: '127.0.0.1' } })
  await vite.listen()
  const url = `http://127.0.0.1:${vite.httpServer.address().port}`
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  })
  const context = await browser.newContext()
  let leakedAnalysisRequests = 0
  await context.route('**/api/v1/**', async (route) => {
    const endpoint = new URL(route.request().url()).pathname
    if (endpoint === '/api/v1/users/me')
      return route.fulfill({
        json: {
          code: 0,
          message: 'success',
          data: {
            id: 42,
            username: 'mixed_account_fixture',
            nickname: 'Mixed fixture',
            avatar_url: null,
            created_at: '2026-10-23T00:00:00Z',
          },
        },
      })
    if (/^\/api\/v1\/(analysis-packages|analyses|matches)(\/|$)/.test(endpoint))
      leakedAnalysisRequests++
    return route.fulfill({
      status: 404,
      json: { code: 40400, message: 'Resource not found', data: null },
    })
  })
  const page = await context.newPage()
  await page.addInitScript(() => localStorage.setItem('csdm.token', 'mixed-account-test-token'))
  await page.goto(url + '/replays/new')
  await page.getByRole('button', { name: '云端上传 / 演示', exact: true }).click()
  await page.getByRole('button', { name: '开始处理', exact: true }).waitFor()
  // Reproduce an older open tab retaining the obsolete /demos handler.
  await page.evaluate(async () => {
    const { worker } = await import('/src/mocks/browser.ts')
    const { http, HttpResponse } = await import('/node_modules/.vite/deps/msw.js')
    worker.resetHandlers(http.post('/api/v1/demos', () => HttpResponse.json({ code: 0, data: {} })))
  })
  await page.getByRole('button', { name: '从本地 Demo 开始', exact: true }).click()
  await page
    .locator('input[type=file]')
    .setInputFiles({
      name: 'private-source.dem',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('not-a-real-demo'),
    })
  await page.getByRole('button', { name: '开始处理', exact: true }).click()
  await page.getByRole('link', { name: '查看分析报告', exact: true }).waitFor({ timeout: 20000 })
  assert.equal(await page.locator('.analysis-stages [data-status=completed]').count(), 4)
  assert.equal(leakedAnalysisRequests, 0, 'demo analysis must not reach the real server')
  // Upload failures replace a completed transfer percentage with an explicit failed stage.
  await page.getByRole('button', { name: '上传已有分析包', exact: true }).click()
  await page
    .locator('input[type=file]')
    .setInputFiles(path.join(root, 'docs/analysis-handoff/sample-analysis.zip'))
  await page.evaluate(async () => {
    const { worker } = await import('/src/mocks/browser.ts')
    const { http, HttpResponse } = await import('/node_modules/.vite/deps/msw.js')
    worker.use(
      http.post('/api/v1/analysis-packages', () =>
        HttpResponse.json(
          { code: 40400, message: 'Resource not found', data: null },
          { status: 404 },
        ),
      ),
    )
  })
  await page.getByRole('button', { name: '开始处理', exact: true }).click()
  await page.getByRole('alert').waitFor()
  const failed = page.locator('.analysis-stages [data-status=failed]')
  assert.equal(await failed.count(), 1)
  assert.ok((await failed.innerText()).includes('演示接口未准备好'))
  assert.ok(!(await failed.innerText()).includes('100%'))
  assert.equal(leakedAnalysisRequests, 0)
  await page
    .locator('input[type=file]')
    .setInputFiles({
      name: 'wrong.dem',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('fixture'),
    })
  await page.getByRole('button', { name: '开始处理', exact: true }).click()
  assert.ok((await page.getByRole('alert').innerText()).includes('不能直接选择 .dem'))
  console.log(
    'PASS: mixed account/demo mode; stale handler recovery; zero analysis requests to real server; failed-progress text; raw Demo rejected in ZIP mode.',
  )
})()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    if (browser) await browser.close()
    if (vite) await vite.close()
  })
