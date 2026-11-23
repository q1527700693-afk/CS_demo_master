const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto'),
  { pathToFileURL } = require('node:url')
const runtime = path.join(
  process.env.USERPROFILE,
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules',
)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(runtime, 'playwright'))
const root = path.resolve(__dirname, '..'),
  backend = process.env.CSDM_TEST_CLOUD_BACKEND
if (!backend || !fs.existsSync(path.join(backend, 'src/routes/demoAnalyses.js')))
  throw Error('Set CSDM_TEST_CLOUD_BACKEND to a backend checkout containing the demo analysis API')
const output = process.env.CSDM_TEST_OUTPUT || path.join(root, 'test-results/v1.2.1')
fs.mkdirSync(output, { recursive: true })
const privateRoot = fs.mkdtempSync(path.join(output, 'runtime-'))
Object.assign(process.env, {
  DB_PATH: path.join(privateRoot, 'app.db'),
  REPLAY_DIR: path.join(privateRoot, 'replays'),
  UPLOAD_DIR: path.join(privateRoot, 'uploads'),
  JWT_SECRET: crypto.randomBytes(32).toString('hex'),
  DEEPSEEK_API_KEY: '',
  AI_AUTO_ANALYZE: 'false',
})
const app = require(path.join(backend, 'src/app')),
  parser = require(path.join(backend, 'src/services/demoParser')),
  ai = require(path.join(backend, 'src/services/aiAnalysis'))
const { build } = require(path.join(backend, 'tests/fixtures/demo-parse-sample'))
parser.probe = async () => ({
  available: true,
  python: 'isolated fixture',
  awpy: 'fixture',
  polars: 'fixture',
})
parser.parseDemo = async ({ input, output, targetPlayer }) => {
  await new Promise((r) => setTimeout(r, 1200))
  const bytes = fs.readFileSync(input),
    p = build({
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.length,
    })
  for (const player of p.players)
    if (!p.stats.some((s) => s.steamid === player.steamid))
      p.stats.push({
        steamid: player.steamid,
        name: player.name,
        rounds_played: p.rounds.length,
        adr: 55,
      })
  if (targetPlayer) p.target_player_id = targetPlayer
  p.match_started_at = '2026-10-20T08:30:00Z'
  p.all_player_samples = p.players.flatMap((player, i) =>
    p.target_samples.map((s) => ({
      ...s,
      steamid: player.steamid,
      name: player.name,
      side: player.side,
      x: s.x + i * 80,
    })),
  )
  p.target_samples = p.all_player_samples.filter((s) => s.steamid === p.target_player_id)
  p.all_death_snapshots = p.target_death_snapshots.map((s) => ({
    ...s,
    steamid: p.target_player_id,
  }))
  fs.writeFileSync(output, JSON.stringify(p))
  return p
}
ai.isConfigured = () => true
let failAi = true
ai.analyzeDemo = async (details, options) => {
  await new Promise((r) => setTimeout(r, 1500))
  if (failAi) {
    failAi = false
    throw Error('QA provider temporarily unavailable')
  }
  return {
    ai_status: 'completed',
    analysis_id: options.analysisId,
    model: 'isolated QA model',
    summary: 'Cloud coaching based on this demo',
    strengths: [
      {
        title: '云端道具亮点',
        explanation: '来自已解析比赛的证据',
        evidence_ids: [options.evidenceIds[0]],
      },
    ],
    improvement_areas: [],
    data_limitations: ['模拟模型，未调用付费服务'],
  }
}
const { startQueue } = require(path.join(backend, 'src/services/replayQueue')),
  { runJob } = require(path.join(backend, 'src/services/replayJobRunner'))
let server, stop, vite, browser, page
const checks = [],
  errors = []
const check = (s) => {
  checks.push(s)
  console.log('PASS ' + s)
}
;(async () => {
  server = app.listen(18083, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  stop = startQueue({
    runner: async (dir, kind, onStage) => {
      if (
        kind === 'demo' &&
        JSON.parse(fs.readFileSync(path.join(dir, 'task.json'), 'utf8')).selection_mode !== 'choose'
      )
        await new Promise((r) => setTimeout(r, 1600))
      return runJob(dir, kind, onStage)
    },
  })
  Object.assign(process.env, {
    VITE_API_BASE_URL: '/api/v1',
    VITE_PROXY_TARGET: 'http://127.0.0.1:18083',
    VITE_MOCK_AUTH: 'false',
    VITE_MOCK_PROFILE: 'false',
    VITE_MOCK_REPLAY: 'false',
  })
  const { createServer } = await import(
    pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js'))
  )
  vite = await createServer({ root, server: { port: 15182, strictPort: true, host: '0.0.0.0' } })
  await vite.listen()
  const response = await fetch('http://127.0.0.1:18083/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'qa_v121_' + Date.now(),
      password: crypto.randomBytes(20).toString('hex'),
    }),
  })
  assert.equal(response.status, 201)
  const auth = (await response.json()).data
  browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await ctx.addInitScript((token) => localStorage.setItem('csdm.token', token), auth.access_token)
  page = await ctx.newPage()
  page.setDefaultTimeout(30000)
  page.on('pageerror', (e) => errors.push(e.message))
  const requests = []
  page.on('request', (r) => {
    if (r.url().includes('/local/')) requests.push(r.url())
  })
  const base = 'http://127.0.0.2:15182'
  await page.goto(base + '/replays/new')
  await page.getByText('云端解析可用', { exact: false }).waitFor()
  assert.equal(await page.getByRole('button', { name: /本地解析 Demo/ }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: /云端解析 Demo/ }).isDisabled(), false)
  await page.getByLabel('选择比赛文件', { exact: true }).setInputFiles({
    name: 'Mirage.demo.dem',
    mimeType: 'application/octet-stream',
    buffer: Buffer.concat([Buffer.from('PBDEMS2\0'), Buffer.alloc(2048, 7)]),
  })
  assert.equal(await page.getByLabel('云端分析玩家 SteamID64', { exact: true }).count(), 0)
  await page.getByLabel('选择分析玩家', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('对局时间', { exact: true }).count(), 0)
  const firstPlayer = await page
    .getByLabel('选择分析玩家', { exact: true })
    .locator('option')
    .nth(1)
    .getAttribute('value')
  await page.getByLabel('选择分析玩家', { exact: true }).selectOption(firstPlayer)
  await page.getByRole('link', { name: '总览', exact: true }).click()
  await page.waitForFunction(() => document.body.textContent.includes('云端分析完成'), null, {
    timeout: 30000,
  })
  assert.equal(new URL(page.url()).pathname, '/')
  await page.getByRole('link', { name: '查看报告', exact: true }).waitFor()
  assert.equal(await page.getByTestId('overview-replay-entry').count(), 1)
  assert.equal(await page.getByRole('columnheader', { name: '日期', exact: true }).count(), 0)
  assert.ok((await page.getByTestId('overview-replay-entry').innerText()).includes('#01'))
  await page.screenshot({
    path: path.join(output, 'overview-background-completion.png'),
    fullPage: true,
  })
  assert.equal(requests.length, 0)
  check('web upload continues in background and the visible overview refreshes its cloud report')
  await page.locator('aside a[href="/replays"]').click()
  await page.getByTestId('analysis-entry').waitFor()
  assert.equal(await page.getByTestId('analysis-entry').count(), 1)
  await page.getByRole('link', { name: '查看复盘', exact: true }).click()
  await page.getByRole('heading', { name: '回合影响力', exact: true }).waitFor()
  let firstUrl = page.url(),
    firstTitle = await page.locator('h1.analysis-title').innerText()
  await page.waitForFunction(() =>
    /^#\d+ · /.test(document.querySelector('h1.analysis-title')?.textContent || ''),
  )
  firstTitle = await page.locator('h1.analysis-title').innerText()
  assert.ok(
    firstTitle.includes('荒漠迷城') &&
      firstTitle.startsWith('#01 · ') &&
      !firstTitle.includes('2026'),
  )
  check('cloud report uses an ordinal/player/map name without a match time')
  await page.getByRole('button', { name: '回合复盘', exact: true }).click()
  await page.locator('.neighbor-marker').first().waitFor()
  assert.ok((await page.locator('.neighbor-marker').count()) >= 2)
  assert.ok((await page.locator('.utility-marker').count()) > 0)
  await page.getByLabel('地图时间游标', { exact: true }).evaluate((el) => {
    el.value = '1000'
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.getByTestId('target-marker').waitFor()
  assert.ok((await page.getByTestId('target-marker').locator('text').textContent()).trim())
  check('real cloud API round events, timing and paginated map data render in the report')
  await page.getByRole('button', { name: 'AI 教练', exact: true }).click()
  await page.getByRole('button', { name: '生成 AI 教练解读', exact: true }).click()
  await page.getByText('QA provider temporarily unavailable', { exact: true }).waitFor()
  await page.getByRole('button', { name: '重试生成 AI 解读', exact: true }).click()
  await page.getByRole('heading', { name: '云端道具亮点', exact: true }).waitFor()
  await page.screenshot({ path: path.join(output, 'cloud-ai.png'), fullPage: true })
  check('queued AI polling, provider failure and retry work through the actual HTTP queue')
  const secondTarget = await page
    .getByLabel('分析其他玩家', { exact: true })
    .locator('option')
    .nth(1)
    .getAttribute('value')
  await page.getByLabel('分析其他玩家', { exact: true }).selectOption(secondTarget)
  await page.getByRole('button', { name: '新建该玩家的分析', exact: true }).click()
  await page.waitForURL(
    (url) =>
      url.pathname.startsWith('/replays/cloud') && url.pathname !== new URL(firstUrl).pathname,
    { timeout: 30000 },
  )
  await page.getByRole('heading', { name: '回合影响力', exact: true }).waitFor()
  assert.notEqual(page.url(), firstUrl)
  const secondTitle = await page.locator('h1.analysis-title').innerText()
  assert.notEqual(firstTitle, secondTitle)
  await page.goto(base + '/replays')
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="analysis-entry"]').length === 2,
  )
  assert.equal(await page.getByTestId('analysis-entry').count(), 2)
  assert.equal(await page.locator(`[data-player-id="${secondTarget}"]`).count(), 1)
  await page.screenshot({ path: path.join(output, 'separate-players.png'), fullPage: true })
  await page.goto(firstUrl)
  await page.getByRole('heading', { name: '回合影响力', exact: true }).waitFor()
  assert.equal(await page.locator('h1.analysis-title').innerText(), firstTitle)
  check('switching a demo player creates a new perspective and leaves both named records readable')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(base + '/replays')
  await page.getByTestId('analysis-entry').first().waitFor()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await page.screenshot({ path: path.join(output, 'history-mobile.png'), fullPage: true })
  check('long analysis names fit the mobile history view')
  await page.getByRole('link', { name: '新建复盘', exact: true }).click()
  await page.getByLabel('选择比赛文件', { exact: true }).waitFor()
  assert.equal(await page.locator('.stage.completed').count(), 0)
  assert.equal(await page.getByLabel('选择分析玩家', { exact: true }).count(), 0)
  assert.ok(!(await page.locator('body').innerText()).includes('100%'))
  check('a new replay clears completed progress without cancelling active uploads')
  await page.goto(base + '/replays')
  const toDelete = page
    .getByTestId('analysis-entry')
    .filter({ has: page.locator(`[data-player-id="${secondTarget}"]`) })
  const row = page.locator(`[data-testid="analysis-entry"][data-player-id="${secondTarget}"]`)
  const deleteColor = await row
    .getByRole('button', { name: /删除复盘/ })
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  const rgb = deleteColor.match(/\d+/g).map(Number)
  assert.ok(rgb[0] > rgb[1] * 1.5 && rgb[0] > rgb[2])
  await row.getByRole('button', { name: /删除复盘/ }).click()
  await row.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(await page.getByTestId('analysis-entry').count(), 2)
  await row.getByRole('button', { name: /删除复盘/ }).click()
  await row.getByRole('button', { name: '确认删除', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="analysis-entry"]').length === 1,
  )
  await page.goto(firstUrl)
  await page.getByRole('heading', { name: '回合影响力', exact: true }).waitFor()
  check('red delete buttons remove only the confirmed player perspective')
  await page.goto(base + '/')
  await page.getByRole('link', { name: '查看报告', exact: true }).waitFor()
  assert.equal(await page.getByTestId('overview-replay-entry').count(), 1)
  const firstId = decodeURIComponent(new URL(firstUrl).pathname.split('/').at(-1)).replace(
    /^cloud:/,
    '',
  )
  const rosterResponse = await fetch(
    `http://127.0.0.1:18083/api/v1/demo-analyses/${firstId}/players`,
    { headers: { authorization: 'Bearer ' + auth.access_token } },
  )
  const rosterData = (await rosterResponse.json()).data
  const third = rosterData.players.find(
    (p) => p.player_id !== firstPlayer && p.player_id !== secondTarget,
  )
  const createdResponse = await fetch(
    `http://127.0.0.1:18083/api/v1/demo-analyses/${firstId}/analyses`,
    {
      method: 'POST',
      headers: { authorization: 'Bearer ' + auth.access_token, 'content-type': 'application/json' },
      body: JSON.stringify({ target_player_id: third.player_id }),
    },
  )
  assert.equal(createdResponse.status, 202)
  const thirdRun = (await createdResponse.json()).data
  for (let i = 0; i < 100; i++) {
    const r = await fetch(`http://127.0.0.1:18083/api/v1/demo-analyses/${thirdRun.demo_id}`, {
      headers: { authorization: 'Bearer ' + auth.access_token },
    })
    if ((await r.json()).data.report_available) break
    await new Promise((r) => setTimeout(r, 100))
  }
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="overview-replay-entry"]').length === 2,
  )
  assert.ok(
    (await page.getByTestId('overview-replay-entry').first().innerText()).includes(third.name),
  )
  const removedResponse = await fetch(
    `http://127.0.0.1:18083/api/v1/demo-analyses/${thirdRun.demo_id}`,
    { method: 'DELETE', headers: { authorization: 'Bearer ' + auth.access_token } },
  )
  assert.equal(removedResponse.status, 200)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="overview-replay-entry"]').length === 1,
  )
  check('overview refreshes external completions and deletions when the window regains focus')
  await page.goto(base + '/profile')
  await page.getByLabel('展示比赛', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '选择已上传的比赛', exact: true }).count(), 0)
  await page.getByLabel('公开 Demo 精选展示', { exact: true }).check()
  await page.waitForFunction(
    () => document.querySelector('[aria-label="展示比赛"]').options.length > 1,
  )
  check('enabling a profile showcase directly loads uploaded match choices')
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    userAgent: 'Mozilla/5.0 Chrome/152.0.0.0 Electron/45.0.0 Safari/537.36',
  })
  await desktop.addInitScript(
    (token) => localStorage.setItem('csdm.token', token),
    auth.access_token,
  )
  const dp = await desktop.newPage()
  dp.on('pageerror', (e) => errors.push(e.message))
  let cloudRequests = 0,
    localCalls = 0
  dp.on('request', (r) => {
    if (r.url().includes('/demo-analyses')) cloudRequests++
  })
  await dp.route('**/local/**', async (route) => {
    localCalls++
    const p = new URL(route.request().url()).pathname
    const data = p.endsWith('/health')
      ? { awpy_available: true }
      : p === '/local/jobs'
        ? { job_id: 'local-qa' }
        : {
            status: 'completed',
            stage: 'parsed',
            message: '读取名单完成',
            players: [{ player_id: '76561198000000001', name: 'LocalPlayer' }],
          }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, data }),
    })
  })
  await dp.goto(base + '/replays/new')
  assert.equal(await dp.getByRole('button', { name: /云端解析 Demo/ }).isDisabled(), true)
  assert.equal(await dp.getByRole('button', { name: /本地解析 Demo/ }).isDisabled(), false)
  await dp.getByLabel('选择比赛文件', { exact: true }).setInputFiles({
    name: 'local.dem',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('local fixture'),
  })
  await dp.getByLabel('选择分析玩家', { exact: true }).waitFor()
  assert.ok(localCalls >= 3)
  assert.equal(cloudRequests, 0)
  await dp.screenshot({ path: path.join(output, 'desktop-local-channel.png'), fullPage: true })
  assert.equal(await dp.getByLabel('对局时间', { exact: true }).count(), 0)
  const exportRequest = dp.waitForRequest(
    (r) => r.url().endsWith('/exports') && r.method() === 'POST',
  )
  await dp.getByLabel('选择分析玩家', { exact: true }).selectOption('76561198000000001')
  const localSelection = (await exportRequest).postDataJSON()
  assert.equal(localSelection.target_player_id, '76561198000000001')
  assert.equal(Object.hasOwn(localSelection, 'played_at'), false)
  await dp.evaluate(() => window.dispatchEvent(new Event('auth:expired')))
  check(
    'Electron runtime disables cloud uploads and retains the local parsing/player-selection channel',
  )
  assert.deepEqual(errors, [])
  fs.writeFileSync(
    path.join(output, 'browser-results.json'),
    JSON.stringify({ checks, errors }, null, 2),
  )
})()
  .catch(async (e) => {
    console.error(e)
    if (page) {
      await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true })
      fs.writeFileSync(path.join(output, 'failure.txt'), await page.locator('body').innerText())
    }
    process.exitCode = 1
  })
  .finally(async () => {
    await browser?.close()
    await vite?.close()
    stop?.()
    if (server) {
      server.closeAllConnections()
      await new Promise((r) => server.close(r))
    }
    require(path.join(backend, 'src/services/replayStore')).db.close()
  })
