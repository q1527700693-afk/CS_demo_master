// Real browser -> loopback awpy -> algorithms -> downloadable ZIP. No cloud analysis.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = path.resolve(__dirname, '..')
const source = process.env.CSDM_TEST_DEMO
if (!source || !fs.existsSync(source))
  throw new Error('Set CSDM_TEST_DEMO to an existing real CS2 Demo')
process.env.VITE_MOCK_AUTH = 'true'
process.env.VITE_MOCK_PROFILE = 'true'
process.env.VITE_MOCK_REPLAY = 'true'
process.env.VITE_MOCK_LOBBY = 'false'
let vite, browser
;(async () => {
  const { createServer } = await import(
    pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js'))
  )
  vite = await createServer({ root, server: { port: 15173, strictPort: true, host: '127.0.0.1' } })
  await vite.listen()
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  })
  const page = await browser.newPage({
    viewport: { width: 1365, height: 1000 },
    acceptDownloads: true,
  })
  const errors = [],
    cloud = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('request', (r) => {
    if (/\/api\/v1\/(analysis-packages|analyses|matches)(\/|\?|$)/.test(r.url()))
      cloud.push(r.url())
  })
  await page.addInitScript(() => localStorage.setItem('csdm.token', 'mock-demo-session'))
  await page.goto('http://127.0.0.1:15173/replays/new')
  await page.getByRole('button', { name: '读取玩家名单', exact: true }).waitFor()
  await page
    .getByLabel('本机连接令牌', { exact: true })
    .fill(fs.readFileSync(path.resolve(root, '../local_parser/token.txt'), 'utf8').trim())
  await page.getByLabel('自己的游戏昵称 / SteamID', { exact: true }).fill('Pose')
  await page.locator('input[type=file]').setInputFiles(source)
  await page.getByRole('button', { name: '读取玩家名单', exact: true }).click()
  await page
    .getByRole('button', { name: '计算并导出 ZIP', exact: true })
    .waitFor({ timeout: 180000 })
  assert.equal(
    await page.getByRole('button', { name: '计算并导出 ZIP', exact: true }).isDisabled(),
    true,
  )
  await page.getByLabel('选择要分析的玩家', { exact: true }).selectOption('76561199836146468')
  await page.getByRole('checkbox').check()
  const options = await page.locator('select option').count()
  assert.ok(options >= 2, 'real roster must contain players')
  await page.getByRole('button', { name: '计算并导出 ZIP', exact: true }).click()
  await page
    .getByRole('link', { name: '下载真实分析 ZIP', exact: true })
    .waitFor({ timeout: 30000 })
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('link', { name: '下载真实分析 ZIP', exact: true }).click()
  const download = await downloadPromise
  const output = path.join(root, 'test-results/local-export')
  fs.mkdirSync(output, { recursive: true })
  await download.saveAs(path.join(output, 'real-match.zip'))
  assert.ok(fs.statSync(path.join(output, 'real-match.zip')).size > 0)
  // Do not include the local connection token in screenshots.
  await page.getByLabel('本机连接令牌', { exact: true }).fill('')
  await page.screenshot({ path: path.join(output, 'real-export.png'), fullPage: true })
  assert.deepEqual(cloud, [], 'local export must never call cloud analysis')
  assert.deepEqual(errors, [])
  console.log(
    `PASS: real Demo via browser -> awpy -> nickname + confirmed SteamID -> algorithms -> downloaded ZIP. Zero cloud analysis requests.`,
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
