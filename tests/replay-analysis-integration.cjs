// Frontend-only browser verification. MSW provides explicitly synthetic fixtures.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'test-results/analysis-pipeline')
fs.mkdirSync(output, { recursive: true })
process.env.VITE_MOCK_AUTH = 'true'
process.env.VITE_MOCK_PROFILE = 'true'
process.env.VITE_MOCK_REPLAY = 'true'
process.env.VITE_MOCK_LOBBY = 'true'
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => localStorage.setItem('csdm.token', 'mock-demo-session'))
  await page.goto(`${url}/replays/new`)
  await page.getByRole('button', { name: '云端上传 / 演示', exact: true }).click()
  await page.getByRole('button', { name: '上传已有分析包', exact: true }).waitFor()
  assert.equal(await page.locator('.analysis-stages li').count(), 4)
  assert.ok((await page.locator('body').innerText()).includes('前端演示模式'))
  await page
    .locator('input[type=file]')
    .setInputFiles(path.join(root, 'docs/analysis-handoff/sample-analysis.zip'))
  await page.getByRole('button', { name: '开始处理', exact: true }).click()
  await page.getByRole('link', { name: '查看分析报告', exact: true }).waitFor({ timeout: 30000 })
  assert.equal(await page.locator('.analysis-stages [data-status=completed]').count(), 3)
  await page.screenshot({ path: path.join(output, 'four-stages.png'), fullPage: true })
  await page.getByRole('link', { name: '查看分析报告', exact: true }).click()
  await page.getByRole('heading', { name: '道具轨迹坐标图' }).waitFor()
  assert.ok((await page.locator('body').innerText()).includes('合成演示'))
  assert.ok((await page.locator('body').innerText()).includes('尚未计算'))
  await page.screenshot({ path: path.join(output, 'report-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.locator('.sidebar').isVisible(), false)
  await page.screenshot({
    path: path.join(output, 'report-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  })
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    'mobile horizontal overflow',
  )
  await page.getByRole('button', { name: '打开导航', exact: true }).click()
  assert.equal(await page.locator('.sidebar').isVisible(), true)
  await page
    .getByRole('button', { name: '关闭导航', exact: true })
    .click({ position: { x: 370, y: 750 } })
  assert.equal(await page.locator('.sidebar').isVisible(), false)
  await page.getByRole('button', { name: '重新进行云端分析', exact: true }).click()
  await page.waitForURL('**/replays/new?view=cloud')
  await page.reload()
  await page.getByRole('button', { name: '云端上传 / 演示', exact: true }).click()
  await page.getByRole('button', { name: '继续查询 / 下载报告', exact: true }).click()
  await page.getByRole('link', { name: '查看分析报告', exact: true }).waitFor()
  await page.goto(`${url}/replays`)
  await page.getByRole('link', { name: '查看可用报告' }).waitFor()
  await page.goto(`${url}/replays/new`)
  await page.getByRole('button', { name: '云端上传 / 演示', exact: true }).click()
  await page.getByRole('button', { name: '从本地 Demo 开始' }).click()
  await page
    .locator('input[type=file]')
    .setInputFiles({
      name: 'synthetic.dem',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('fixture-only'),
    })
  await page.getByRole('button', { name: '开始处理', exact: true }).click()
  await page.getByRole('link', { name: '查看分析报告', exact: true }).waitFor()
  assert.equal(await page.locator('.analysis-stages [data-status=completed]').count(), 4)
  await page.screenshot({
    path: path.join(output, 'local-mode-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  })
  await page.goto(`${url}/replays/missing-report`)
  await page.getByText('演示报告不存在', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log(
    'PASS: frontend contract mocks; four stages, partial report, history, refresh/resume, mobile menu/layout, missing-report error. No backend or parser executed.',
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
