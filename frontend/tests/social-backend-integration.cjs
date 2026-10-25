// Real API + three browser sessions; all writes use a disposable SQLite database.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { fork } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { setTimeout: delay } = require('node:timers/promises')
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE ||
    path.join(
      process.env.USERPROFILE,
      '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
    ),
)
const root = path.resolve(__dirname, '..')
const backend = path.resolve(root, '../backend_service/backend')
const output = path.join(root, 'test-results/social-integration-20261025')
fs.mkdirSync(output, { recursive: true })
const runtime = fs.mkdtempSync(path.join(output, 'runtime-'))
const api = 'http://127.0.0.1:18081/api/v1'
const base = 'http://127.0.0.1:15175'
const password = 'SocialTest_2026!'
const checks = [],
  errors = [],
  responses = []
let worker,
  vite,
  browser,
  log = '',
  failurePage
const check = (message) => {
  checks.push(message)
  console.log('PASS ' + message)
}
async function call(endpoint, account, method = 'GET', body, expected = 200) {
  const response = await fetch(api + endpoint, {
    method,
    headers: {
      ...(account ? { Authorization: 'Bearer ' + account.access_token } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const result = await response.json()
  assert.equal(response.status, expected, `${method} ${endpoint}: ${JSON.stringify(result)}`)
  return result.data
}
async function register(username, nickname) {
  return call('/auth/register', null, 'POST', { username, nickname, password }, 201)
}
async function see(page, text) {
  await page.getByText(text, { exact: true }).first().waitFor()
}
async function go(page, route) {
  failurePage = page
  await page.goto(base + route)
  await page.locator('#startup-splash').waitFor({ state: 'detached' })
}
async function makePage(account) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
    permissions: ['clipboard-read', 'clipboard-write'],
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('dialog', (dialog) => dialog.accept())
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('response', (response) => {
    if (response.url().includes('/api/v1/'))
      responses.push({
        path: new URL(response.url()).pathname,
        status: response.status(),
        mock: response.fromServiceWorker(),
      })
  })
  if (account) {
    await go(page, '/login?redirect=/friends')
    await page.getByLabel('用户名', { exact: true }).fill(account.user.username)
    await page.getByLabel('密码', { exact: true }).fill(password)
    await page.getByRole('button', { name: '登录', exact: true }).last().click()
    await page.waitForURL('**/friends')
    await page.getByRole('button', { name: /^我的好友/ }).waitFor()
  }
  return page
}
const detailOf = (page) => page.getByRole('region', { name: '车队详情', exact: true })
const searchBox = (page) =>
  page.getByRole('complementary').filter({ has: page.getByLabel('用户名或昵称') })
async function search(page, value) {
  await page.getByLabel('用户名或昵称').fill(value)
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await page.locator('.search-summary').waitFor()
}
async function confirmAction(page, button, toast) {
  failurePage = page
  await button.click()
  await see(page, toast)
}
;(async () => {
  worker = fork(path.join(backend, 'src/server.js'), [], {
    cwd: backend,
    env: {
      ...process.env,
      PORT: '18081',
      DB_PATH: path.join(runtime, 'test.db'),
      UPLOAD_DIR: path.join(runtime, 'uploads'),
      REPLAY_DIR: path.join(runtime, 'replays'),
      JWT_SECRET: 'social-isolated-tests-only',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  worker.stdout.on('data', (chunk) => (log += chunk))
  worker.stderr.on('data', (chunk) => (log += chunk))
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(api + '/health')).ok) break
    } catch {}
    if (i === 99) throw new Error(log)
    await delay(100)
  }
  Object.assign(process.env, {
    VITE_API_BASE_URL: '/api/v1',
    VITE_PROXY_TARGET: 'http://127.0.0.1:18081',
    VITE_MOCK_AUTH: 'false',
    VITE_MOCK_PROFILE: 'false',
    VITE_MOCK_REPLAY: 'false',
    VITE_MOCK_LOBBY: 'false',
  })
  const { createServer } = await import(
    pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js'))
  )
  vite = await createServer({ root, server: { host: '127.0.0.1', port: 15175, strictPort: true } })
  await vite.listen()
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  })
  const alice = await register('qa_alice', '晚风 / Alice'),
    bob = await register('qa_bob', '队友 Bob'),
    carol = await register('qa_carol', '队友 Carol')
  const a = await makePage(alice),
    b = await makePage(bob),
    c = await makePage(carol),
    guest = await makePage()
  check('三个独立浏览器会话通过真实登录与 JWT 访问好友页面')
  await go(a, '/profile')
  await a.getByLabel('个性签名', { exact: true }).fill('认真沟通，一起复盘。')
  await a.getByLabel('游戏水平', { exact: true }).fill('完美 C+ / 5E 2200')
  await a.getByLabel('想找的队友', { exact: true }).fill('周末五排，友好沟通。')
  await a.getByRole('button', { name: /保存/ }).click()
  await see(a, '玩家名片已保存')
  const sharp = require(path.join(backend, 'node_modules/sharp'))
  const png = await sharp({
    create: { width: 128, height: 128, channels: 3, background: '#ed9a60' },
  })
    .png()
    .toBuffer()
  await a
    .getByLabel('选择头像')
    .setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: png })
  await see(a, '头像已更新')
  const profile = await call('/users/me/profile', alice)
  assert.ok(profile.avatar_url)
  await go(b, '/friends')
  await search(b, 'qa_alice')
  const resultA = b.locator('.search-result').filter({ hasText: 'qa_alice' })
  await resultA.getByText('完美 C+ / 5E 2200', { exact: true }).waitFor()
  await resultA.locator('img').waitFor()
  assert.ok((await resultA.innerText()).includes('周末五排，友好沟通。'))
  await resultA.getByRole('link', { name: /查看.*名片/ }).click()
  await b.waitForURL(`**/players/${alice.user.id}`)
  await see(b, '认真沟通，一起复盘。')
  check('资料与头像真实保存，并同步到玩家搜索结果和公开名片')
  await confirmAction(b, b.getByRole('button', { name: '添加好友', exact: true }), '好友申请已发送')
  await b.getByRole('button', { name: '撤回申请' }).waitFor()
  await go(a, '/friends')
  await a.getByRole('button', { name: /^收到的申请/ }).click()
  await a.getByRole('button', { name: '接受申请' }).waitFor()
  await confirmAction(a, a.getByRole('button', { name: '接受申请' }), '已成为好友')
  await a.getByRole('button', { name: /^我的好友/ }).click()
  await see(a, '队友 Bob')
  await go(b, '/friends')
  await see(b, '晚风 / Alice')
  assert.equal((await call('/friends', alice)).total, 1)
  assert.equal((await call('/friends', bob)).total, 1)
  await b.screenshot({ path: path.join(output, 'friends-desktop.png'), fullPage: true })
  check('名片发送申请、接收方接受、双方好友列表与申请计数同步')
  await confirmAction(b, b.getByRole('button', { name: '解除好友' }), '已解除好友关系')
  assert.equal((await call('/friends', alice)).total, 0)
  await go(b, `/players/${alice.user.id}`)
  await confirmAction(b, b.getByRole('button', { name: '添加好友', exact: true }), '好友申请已发送')
  await confirmAction(b, b.getByRole('button', { name: '撤回申请' }), '已撤回申请')
  await confirmAction(b, b.getByRole('button', { name: '添加好友', exact: true }), '好友申请已发送')
  await go(a, '/friends')
  await a.getByRole('button', { name: /^收到的申请/ }).click()
  await confirmAction(a, a.getByRole('button', { name: '拒绝', exact: true }), '已拒绝申请')
  assert.equal((await call('/friends/requests', bob)).outgoing.length, 0)
  check('解除好友、重复申请、撤回和拒绝完整闭环')
  await go(a, '/lobbies')
  await a.getByRole('button', { name: '发布车队', exact: true }).click()
  await a.getByText('已参考个人资料填写游戏水平和组队说明，可按本次车队调整。').waitFor()
  assert.equal(await a.getByLabel('游戏水平', { exact: true }).inputValue(), '完美 C+ / 5E 2200')
  assert.equal(await a.getByLabel('组队说明', { exact: true }).inputValue(), '周末五排，友好沟通。')
  await a.getByLabel('车队名称', { exact: true }).fill('周末默契五排')
  await a.getByLabel('地图', { exact: true }).fill('Mirage')
  await a.getByLabel('地区', { exact: true }).fill('华东')
  await a.getByLabel('当前游戏内人数', { exact: true }).fill('4')
  await a.getByLabel('游戏组队码', { exact: true }).fill('QA-TEAM-2026')
  await a.getByRole('button', { name: '确认发布', exact: true }).click()
  await a.waitForURL((url) => url.searchParams.has('team'))
  const lobbyId = Number(new URL(a.url()).searchParams.get('team'))
  await a.getByTestId('team-code').waitFor()
  await a.screenshot({ path: path.join(output, 'lobby-owner-desktop.png'), fullPage: true })
  const publicLobby = await call(`/lobbies/${lobbyId}`)
  assert.equal(publicLobby.team_code, null)
  await go(guest, `/lobbies?team=${lobbyId}`)
  assert.equal(await guest.getByTestId('team-code').count(), 0)
  await detailOf(guest).getByRole('button', { name: '登录后领码' }).click()
  await guest.waitForURL(
    (url) =>
      url.pathname === '/login' && url.searchParams.get('redirect') === `/lobbies?team=${lobbyId}`,
  )
  check('真实发布继承资料偏好；游客可查看招募但无法查看组队码，领码引导登录并保留跳转')
  await go(b, `/lobbies?team=${lobbyId}`)
  assert.equal(await b.getByTestId('team-code').count(), 0)
  let releaseOldRead, reportOldRead
  const heldRead = new Promise((resolve) => {
    releaseOldRead = resolve
  })
  const oldReadReady = new Promise((resolve) => {
    reportOldRead = resolve
  })
  const detailPattern = `**/api/v1/lobbies/${lobbyId}`
  await b.route(detailPattern, async (route) => {
    const response = await route.fetch()
    reportOldRead()
    await heldRead
    await route.fulfill({ response })
  })
  await detailOf(b).getByRole('button', { name: '刷新详情', exact: true }).click()
  await oldReadReady
  await confirmAction(
    b,
    b
      .locator(`[data-lobby-id="${lobbyId}"]`)
      .getByRole('button', { name: '领取组队码', exact: true }),
    '已领取组队码，请在游戏内加入',
  )
  const oldReadDelivered = b.waitForResponse(
    (response) => new URL(response.url()).pathname === `/api/v1/lobbies/${lobbyId}`,
  )
  releaseOldRead()
  await oldReadDelivered
  await b.unroute(detailPattern)
  await delay(100)
  assert.equal(await b.getByTestId('team-code').innerText(), 'QA-TEAM-2026')
  check('延迟到达的真实详情响应不会覆盖刚完成的领码状态')
  await b.getByRole('button', { name: '复制组队码' }).click()
  assert.equal(await b.evaluate(() => navigator.clipboard.readText()), 'QA-TEAM-2026')
  let live = await call(`/lobbies/${lobbyId}`, alice)
  assert.equal(live.current_players, 4)
  assert.equal(live.claim_count, 1)
  await b.reload()
  await b.getByTestId('team-code').waitFor()
  await confirmAction(
    b,
    detailOf(b).getByRole('button', { name: '取消领码', exact: true }),
    '已取消领码',
  )
  assert.equal((await call(`/lobbies/${lobbyId}`, bob)).team_code, null)
  await confirmAction(
    b,
    detailOf(b).getByRole('button', { name: '领取组队码', exact: true }),
    '已领取组队码，请在游戏内加入',
  )
  check('领码、复制、刷新恢复与取消领码正常，游戏内人数始终不被领码改变')
  await go(a, `/lobbies?team=${lobbyId}`)
  await confirmAction(a, detailOf(a).getByRole('button', { name: '移除成员' }), '已移除领码成员')
  await go(b, `/lobbies?team=${lobbyId}`)
  assert.equal(await b.getByTestId('team-code').count(), 0)
  await detailOf(b).getByRole('button', { name: '领取组队码', exact: true }).click()
  await see(b, '你已被队长移出领码名单，无法再次领取该车队组队码。')
  await call(`/lobbies/${lobbyId}/depart`, bob, 'POST', undefined, 403)
  await call(`/lobbies/${lobbyId}`, bob, 'DELETE', undefined, 403)
  check('队长移除成员后组队码隐藏且不能再次领取，非队长发车和删除被拒绝')
  await go(c, `/lobbies?team=${lobbyId}`)
  await confirmAction(
    c,
    detailOf(c).getByRole('button', { name: '领取组队码', exact: true }),
    '已领取组队码，请在游戏内加入',
  )
  await go(a, `/lobbies?team=${lobbyId}`)
  await confirmAction(
    a,
    detailOf(a).getByRole('button', { name: '确认发车', exact: true }),
    '已发车，车队已从大厅隐藏',
  )
  assert.equal((await call('/lobbies', alice)).total, 0)
  await call(`/lobbies/${lobbyId}`, carol, 'GET', undefined, 404)
  await go(c, `/lobbies?team=${lobbyId}`)
  await see(c, '记录已被处理、删除或到期，请刷新后重试。')
  await confirmAction(
    a,
    detailOf(a).getByRole('button', { name: '删除招募', exact: true }),
    '车队招募已删除',
  )
  check('发车后大厅隐藏且停止领码，队长仍可查看和删除；失效链接有明确提示')
  // Enough records to exercise server pagination and filters, all in the isolated database.
  for (let i = 0; i < 22; i++)
    await register('qa_search_' + String(i).padStart(2, '0'), '搜索队友 ' + i)
  for (let i = 0; i < 14; i++)
    await call(
      '/lobbies',
      alice,
      'POST',
      {
        title: '练习车队 ' + i,
        description: '周末一起练习，友好交流。',
        mode: i === 0 ? 'wingman' : 'competitive',
        map: i % 2 ? 'Mirage' : 'Inferno',
        region: '华东',
        skill_level: '完美 C+',
        team_size: 5,
        current_players: 3,
        team_code: 'PAGE-CODE-' + i,
      },
      201,
    )
  await go(b, '/friends')
  await search(b, 'qa_search')
  assert.equal(await b.locator('.search-result').count(), 20)
  await b.locator('.discovery-panel').getByRole('button', { name: '下一页', exact: true }).click()
  await b.locator('.pagination').getByText('2 / 2', { exact: true }).waitFor()
  assert.equal(await b.locator('.search-result').count(), 2)
  await go(b, '/lobbies')
  assert.equal(await b.locator('.team-card').count(), 12)
  await b.getByRole('button', { name: '下一页', exact: true }).click()
  await b.locator('.pagination').getByText('2 / 2', { exact: true }).waitFor()
  assert.equal(await b.locator('.team-card').count(), 2)
  await b.getByRole('button', { name: '搭档模式', exact: true }).click()
  await b.getByText('1 支招募中的车队 · 按最新发布排序').waitFor()
  assert.equal(await b.locator('.team-card').count(), 1)
  check('玩家搜索分页、车队服务端分页及模式筛选使用真实总数')
  await b.getByRole('button', { name: '全部模式', exact: true }).click()
  await b.getByText('14 支招募中的车队 · 按最新发布排序').waitFor()
  await b.screenshot({ path: path.join(output, 'lobbies-desktop.png'), fullPage: true })
  // Error responses below are transport-failure injection, not business data mocks.
  await b.route('**/api/v1/lobbies?*', (route) => route.abort('failed'))
  await b.getByRole('button', { name: '刷新大厅' }).click()
  await b.getByRole('button', { name: '重新加载', exact: true }).waitFor()
  await b.unroute('**/api/v1/lobbies?*')
  await b.getByRole('button', { name: '重新加载', exact: true }).click()
  await b.getByText('14 支招募中的车队 · 按最新发布排序').waitFor()
  check('后端连接失败可见且重试可恢复，不回退为模拟成功')
  for (const route of ['/friends', '/profile', `/players/${alice.user.id}`, '/lobbies']) {
    await b.setViewportSize({ width: 390, height: 844 })
    await go(b, route)
    await b.getByRole('navigation', { name: '玩家社区' }).waitFor()
    await delay(250)
    assert.ok(
      await b.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `horizontal overflow: ${route}`,
    )
    await b.screenshot({
      path: path.join(output, `mobile-${route.split('/')[1]}.png`),
      fullPage: true,
    })
  }
  check('390px 手机布局：好友、资料、名片、车队均无横向溢出')
  await b.setViewportSize({ width: 1440, height: 1080 })
  await go(b, '/friends')
  await b.getByRole('button', { name: '退出登录', exact: true }).click()
  await b.waitForURL(base + '/')
  await go(b, `/players/${alice.user.id}`)
  await b.getByRole('link', { name: '登录后加好友' }).waitFor()
  assert.equal(await b.getByRole('button', { name: '解除好友' }).count(), 0)
  check('退出登录清空好友状态，公开名片正确恢复登录入口')
  assert.deepEqual(errors, [])
  assert.equal(responses.filter((x) => x.mock).length, 0)
  check('浏览器无未捕获错误，所有业务 API 均来自真实后端')
  fs.writeFileSync(
    path.join(output, 'result.json'),
    JSON.stringify(
      { passed: true, checks, errors, apiResponses: responses.length, runtime },
      null,
      2,
    ),
  )
})()
  .catch(async (error) => {
    console.error(error)
    if (failurePage) {
      await failurePage
        .screenshot({ path: path.join(output, 'failure.png'), fullPage: true })
        .catch(() => {})
      fs.writeFileSync(
        path.join(output, 'failure.txt'),
        await failurePage
          .locator('body')
          .innerText()
          .catch(() => ''),
      )
    }
    fs.writeFileSync(
      path.join(output, 'result.json'),
      JSON.stringify({ passed: false, checks, errors, failure: error.stack, runtime }, null, 2),
    )
    process.exitCode = 1
  })
  .finally(async () => {
    fs.writeFileSync(path.join(output, 'backend.log'), log)
    if (browser) await browser.close()
    if (vite) await vite.close()
    if (worker) worker.kill()
  })
