// Read-only backend smoke + isolated browser fixtures. Never registers accounts
// or changes the existing test user's profile, avatar or training data.
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdir, readFile, writeFile } = require('node:fs/promises')
const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.TEST_URL || 'http://127.0.0.1:5174'
const output = path.resolve(__dirname, '../test-results/player-cards')
const created = '2026-10-21T00:00:00.000Z'
const alice = {
  id: 101,
  username: 'card_alice',
  nickname: 'Alice <img src=x onerror=alert(1)>',
  avatar_url: null,
  created_at: created,
}
const bob = {
  id: 102,
  username: 'card_bob',
  nickname: 'Bob',
  avatar_url: null,
  created_at: created,
}
function card(user) {
  return {
    user_id: user.id,
    username: user.username,
    nickname: user.nickname,
    avatar_url: user.avatar_url,
    steam_id: '76561198000000001',
    steam_friend_code: '00123456',
    wanmei_id: null,
    '5E_id': null,
    signature: '一起认真训练，一起复盘。',
    skill_level: '完美 C+ / 5E 2200',
    looking_for: '周末晚间五排，友好沟通。',
    other_game_ids: [{ game: 'Faceit', account: 'alice_01' }],
    has_platform_id: true,
    updated_at: created,
  }
}
function session(id, mode = 'gridshot', value = 100, changed = false) {
  return {
    schemaVersion: 1,
    id,
    completedAt: created,
    durationMs: 30000,
    parametersChanged: changed,
    config: {
      rulesVersion: mode === 'reaction' ? 3 : 2,
      mode,
      duration: 30,
      difficulty: 'normal',
      input: 'locked',
      sensitivity: 1,
      fov: 64,
    },
    metrics: {
      hits: 10,
      shots: 20,
      accuracy: 0.5,
      score: ['reaction', 'tracking'].includes(mode) ? null : value,
      reactionMs: mode === 'reaction' ? value : null,
      trackingRatio: mode === 'tracking' ? value : null,
    },
    events: [{ ignoredInputEvent: true }],
  }
}
;(async () => {
  await mkdir(output, { recursive: true })
  const browser = await chromium.launch({
    executablePath:
      process.env.BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    reducedMotion: 'reduce',
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  const page = await context.newPage()
  const errors = []
  const writes = []
  const unsupported = []
  const checks = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname
    if (pathname.startsWith('/api/') && request.method() !== 'GET') writes.push(pathname)
    if (
      pathname.startsWith('/api/') &&
      /\/training-bests|\/demo-highlights|\/minigames\//.test(pathname)
    )
      unsupported.push(pathname)
  })
  const check = (message) => {
    checks.push(message)
    console.log('PASS ' + message)
  }
  const ready = async () => page.locator('#startup-splash').waitFor({ state: 'detached' })
  const trainer = () => page.locator('vector-trainer')
  const emit = async (record) =>
    trainer().evaluate(
      (element, detail) =>
        element.dispatchEvent(
          new CustomEvent('training-complete', { detail, bubbles: true, composed: true }),
        ),
      record,
    )
  const values = () => page.locator('.best-value strong').allTextContents()
  try {
    // Verify the real implemented public-card endpoint anonymously, without fixtures.
    const id = process.env.TEST_PUBLIC_USER_ID || '1'
    const response = await context.request.get(base + `/api/v1/users/${id}/profile`)
    assert.equal(response.status(), 200)
    const existing = (await response.json()).data
    await page.goto(base + `/players/${id}`, { waitUntil: 'networkidle' })
    await ready()
    await page.locator('.player-heading h2').waitFor()
    assert.equal(await page.locator('.player-heading > p').innerText(), '@' + existing.username)
    assert.deepEqual(await values(), ['—', '—', '—', '—', '—'])
    await page.getByRole('link', { name: '登录后加好友' }).waitFor()
    check('real anonymous public profile endpoint and card page; no invented public scores')

    let current = alice
    // Friend writes are covered by social-backend-integration.cjs; this read-only
    // training/card fixture supplies the now-supported relationship reads.
    await context.route(/\/api\/v1\/friends(?:\?.*)?$/, (route) =>
      route.fulfill({
        json: { code: 0, message: 'success', data: { items: [], page: 1, pageSize: 50, total: 0 } },
      }),
    )
    await context.route('**/api/v1/friends/requests', (route) =>
      route.fulfill({
        json: {
          code: 0,
          message: 'success',
          data: { incoming: [], outgoing: [], incoming_count: 0 },
        },
      }),
    )
    await context.route('**/api/v1/users/me', (route) =>
      route.fulfill({ json: { code: 0, message: 'success', data: current } }),
    )
    await context.route('**/api/v1/users/me/profile', (route) =>
      route.fulfill({ json: { code: 0, message: 'success', data: card(current) } }),
    )
    await context.route(/\/api\/v1\/users\/\d+\/profile$/, (route) => {
      const match = new URL(route.request().url()).pathname.match(/\/users\/(\d+)\/profile$/)
      const user = match[1] === '101' ? alice : match[1] === '102' ? bob : null
      return route.fulfill({
        status: user ? 200 : 404,
        json: user
          ? { code: 0, message: 'success', data: card(user) }
          : { code: 40400, message: 'Resource not found', data: null },
      })
    })
    await page.goto(base + '/training', { waitUntil: 'networkidle' })
    await ready()
    await trainer().waitFor()
    await emit(session('guest-shared', 'gridshot', 9900))
    assert.equal(
      await page.evaluate(
        () =>
          Object.keys(localStorage).filter((key) => key.startsWith('csdm.training.bests.')).length,
      ),
      0,
    )
    await page.evaluate(() => {
      localStorage.setItem('csdm.token', 'card-fixture-a')
      // Existing shared history must not automatically become Alice's record.
      localStorage.setItem('vector.trainer.sessions.v1', '[]')
    })
    await page.reload({ waitUntil: 'networkidle' })
    await ready()
    await trainer().waitFor()
    for (const record of [
      session('g1', 'gridshot', 120),
      session('g2', 'gridshot', 240),
      session('g3', 'gridshot', 80),
      session('r1', 'reaction', 260),
      session('r2', 'reaction', 180),
      session('s1', 'spidershot', 360),
      session('m1', 'microshot', 420),
      session('t1', 'tracking', 0.45),
      session('t2', 'tracking', 0.75),
      session('excluded', 'gridshot', 9900, true),
    ])
      await emit(record)
    await emit(session('g2', 'gridshot', 9999))
    await page.evaluate(() => localStorage.setItem('csdm.token', 'changed-during-round'))
    await emit(session('wrong-owner', 'gridshot', 9999))
    await page.evaluate(() => localStorage.setItem('csdm.token', 'card-fixture-a'))
    await page.locator('nav a[href="/friends"]').click()
    await page.getByRole('heading', { name: '玩家与好友.' }).waitFor()
    await page.getByRole('link', { name: '我的名片', exact: true }).click()
    await page.locator('.player-heading h2').waitFor()
    assert.deepEqual(await values(), ['240', '180', '360', '420', '75.0'])
    assert.equal(
      await page
        .locator('.best-card[data-mode="gridshot"] .best-footer')
        .innerText()
        .then((text) => text.includes('3 轮')),
      true,
    )
    assert.equal(await page.locator('.player-heading h2 img').count(), 0)
    await page.getByText('00123456', { exact: true }).waitFor()
    await page.getByRole('link', { name: '编辑名片', exact: true }).waitFor()
    await page.getByRole('heading', { name: 'Demo 分析档案', exact: true }).waitFor()
    check(
      'native completion callback records all five modes with correct best direction, deduplication, ownership and parameter-change exclusion',
    )
    await page.getByRole('button', { name: '复制名片链接', exact: true }).click()
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), base + '/players/101')
    await page.screenshot({ path: path.join(output, 'my-card-desktop.png'), fullPage: true })
    await page.reload({ waitUntil: 'networkidle' })
    await ready()
    assert.deepEqual(await values(), ['240', '180', '360', '420', '75.0'])
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForFunction(
      () => document.querySelector('.sidebar').getBoundingClientRect().right <= 0,
    )
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: path.join(output, 'my-card-mobile.png'), fullPage: true })
    check(
      'read-only card survives refresh, safely escapes player text, copies its link and fits mobile width',
    )

    current = bob
    await page.evaluate(() => localStorage.setItem('csdm.token', 'card-fixture-b'))
    await page.goto(base + '/players/102', { waitUntil: 'networkidle' })
    await ready()
    assert.deepEqual(await values(), ['—', '—', '—', '—', '—'])
    await page.goto(base + '/players/101', { waitUntil: 'networkidle' })
    await ready()
    assert.deepEqual(await values(), ['—', '—', '—', '—', '—'])
    await page.getByText('公开战绩待接入', { exact: true }).waitFor()
    check('switching accounts or viewing another player never exposes local training records')
    await page.goto(base + '/friends', { waitUntil: 'networkidle' })
    await ready()
    assert.equal(await page.getByLabel('用户名或昵称', { exact: true }).isEnabled(), true)
    assert.equal(await page.getByRole('button', { name: '搜索', exact: true }).isEnabled(), true)
    await page.getByLabel('玩家 ID', { exact: true }).fill('abc')
    await page.getByRole('button', { name: '查看名片', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '请输入有效的数字玩家 ID' }).waitFor()
    await page.getByLabel('玩家 ID', { exact: true }).fill('101')
    await page.getByRole('button', { name: '查看名片', exact: true }).click()
    await page.waitForURL('**/players/101')
    await page.locator('.player-heading h2').waitFor()
    await page.setViewportSize({ width: 1440, height: 1050 })
    await page.goto(base + '/friends', { waitUntil: 'networkidle' })
    await ready()
    await page.screenshot({ path: path.join(output, 'friends-desktop.png'), fullPage: true })
    check(
      'friend search is enabled and real ID lookup works; social mutation coverage lives in the real backend suite',
    )
    await page.goto(base + '/players/404', { waitUntil: 'networkidle' })
    await ready()
    await page.getByRole('alert').filter({ hasText: '没有找到这位玩家' }).waitFor()
    assert.equal(await page.locator('.player-hero').count(), 0)
    await page.goto(base + '/players/invalid', { waitUntil: 'networkidle' })
    await ready()
    await page.getByRole('alert').filter({ hasText: '玩家 ID 无效' }).waitFor()
    await page.evaluate(() => localStorage.removeItem('csdm.token'))
    await page.goto(base + '/friends', { waitUntil: 'networkidle' })
    await ready()
    await page.waitForURL('**/login?redirect=/friends')
    assert.deepEqual(writes, [])
    assert.deepEqual(unsupported, [])
    assert.deepEqual(errors, [])
    check(
      'invalid IDs, missing players and protected friends page work; no backend writes or unsupported API requests',
    )

    const manifest = JSON.parse(
      await readFile(
        path.resolve(__dirname, '../public/vector-trainer/integration-source.json'),
        'utf8',
      ),
    )
    for (const file of manifest.files) {
      const data = await readFile(path.resolve(__dirname, '../public/vector-trainer', file.path))
      assert.equal(createHash('sha256').update(data).digest('hex'), file.sha256)
      const original = await readFile(path.resolve(__dirname, '..', manifest.source, file.path))
      assert.equal(createHash('sha256').update(original).digest('hex'), file.sha256)
    }
    check('all 47 native game files remain byte-for-byte unchanged')
    await writeFile(
      path.join(output, 'result.json'),
      JSON.stringify({ checks, errors, writes, unsupported }, null, 2),
    )
    console.log(JSON.stringify({ checks, errors, writes, unsupported }, null, 2))
  } catch (error) {
    await page
      .screenshot({ path: path.join(output, 'failure.png'), fullPage: true })
      .catch(() => {})
    console.error('PAGE', page.url(), 'ERRORS', errors)
    throw error
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
