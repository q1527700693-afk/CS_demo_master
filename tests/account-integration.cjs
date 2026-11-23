// Runs against the real dev backend, with an isolated local test database.
const assert = require('node:assert/strict')
const { mkdir, writeFile } = require('node:fs/promises')
const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.TEST_URL || 'http://127.0.0.1:5174'
const backend = process.env.TEST_BACKEND || 'http://127.0.0.1:18000'
if (!['127.0.0.1', 'localhost'].includes(new URL(backend).hostname))
  throw new Error('Use an isolated local test backend')
const output = path.resolve(__dirname, '../test-results/accounts')
const password = 'FrontendQA_123!'
;(async () => {
  await mkdir(output, { recursive: true })
  const browser = await chromium.launch({
    executablePath:
      process.env.BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } })
  const page = await context.newPage()
  const errors = []
  const requests = []
  const checks = []
  const username = `qa_web_${Date.now()}`
  const steamAccount = 100000000 + (Date.now() % 100000000)
  const steam64 = String(76561197960265728n + BigInt(steamAccount))
  const check = (message) => {
    checks.push(message)
    console.log('PASS ' + message)
  }
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (request.url().includes('/api/'))
      requests.push({ url: new URL(request.url()).pathname, method: request.method() })
  })
  const match = (url, method) => (response) =>
    new URL(response.url()).pathname === '/api/v1' + url && response.request().method() === method
  const submitCard = async () => {
    const response = page.waitForResponse(match('/users/me/profile', 'PATCH'))
    await page.getByRole('button', { name: '保存资料', exact: true }).click()
    return (await response).json()
  }
  async function apiCard(token) {
    const response = await context.request.get(backend + '/api/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(response.status(), 200)
    return (await response.json()).data
  }
  try {
    await page.goto(base + '/login', { waitUntil: 'networkidle' })
    await page.locator('#startup-splash').waitFor({ state: 'detached' })
    assert.equal(await page.getByRole('button', { name: '使用演示账号进入' }).count(), 0)
    await page.getByRole('button', { name: '注册', exact: true }).click()
    await page.getByLabel('用户名', { exact: true }).fill(username)
    await page.getByLabel('密码', { exact: true }).fill(password)
    await page.getByLabel('确认密码', { exact: true }).fill('different_pass')
    await page.getByRole('button', { name: '创建账号', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '两次输入的密码不一致' }).waitFor()
    assert.equal(requests.filter((row) => row.url.endsWith('/auth/register')).length, 0)
    await page.getByLabel('确认密码', { exact: true }).fill(password)
    await page.getByRole('button', { name: '创建账号', exact: true }).click()
    await page.waitForURL('**/profile')
    await page.getByRole('heading', { name: '我的玩家名片', exact: true }).waitFor()
    const token = await page.evaluate(() => localStorage.getItem('csdm.token'))
    assert.ok(token && token.split('.').length === 3)
    assert.equal((await apiCard(token)).username, username)
    assert.equal((await apiCard(token)).nickname, null)
    assert.equal(await page.locator('.user-pill > span:last-child').innerText(), username)
    check('real username registration, password confirmation, JWT and nullable nickname fallback')

    const blank = await submitCard()
    assert.equal(blank.code, 0)
    assert.equal(blank.data.has_platform_id, false)
    await page.getByLabel('个性签名').fill('无需绑定平台，也可以保存资料。')
    assert.equal((await submitCard()).code, 0)
    assert.equal((await apiCard(token)).signature, '无需绑定平台，也可以保存资料。')
    const beforeInvalidCode = requests.filter(
      (row) => row.url.endsWith('/profile') && row.method === 'PATCH',
    ).length
    await page.getByLabel('Steam 好友码', { exact: true }).fill('abc123')
    await page.getByRole('button', { name: '保存资料', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Steam 好友码需为 6–12 位数字' }).waitFor()
    assert.equal(
      requests.filter((row) => row.url.endsWith('/profile') && row.method === 'PATCH').length,
      beforeInvalidCode,
    )
    await page.getByLabel('Steam 好友码', { exact: true }).fill('00123456')
    const friendOnly = await submitCard()
    assert.equal(friendOnly.code, 0)
    assert.equal(friendOnly.data.steam_id, null)
    assert.equal(friendOnly.data.steam_friend_code, '00123456')
    assert.equal(friendOnly.data.has_platform_id, false)
    const badCode = await context.request.patch(backend + '/api/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${token}` },
      data: { steam_friend_code: 'bad123' },
    })
    assert.equal(badCode.status(), 400)
    assert.equal((await apiCard(token)).steam_friend_code, '00123456')
    await page.reload({ waitUntil: 'networkidle' })
    await page.locator('#startup-splash').waitFor({ state: 'detached' })
    assert.equal(await page.getByLabel('Steam 好友码', { exact: true }).inputValue(), '00123456')
    check(
      'empty platforms, signature-only save, independent friend code with leading zeros and validation',
    )

    await page.getByLabel('Steam 账号').fill(`[U:1:${steamAccount}]`)
    await page.getByLabel('个性签名').fill('前端联调：认真沟通，一起复盘。')
    await page.getByLabel('游戏水平').fill('完美 C+ / 5E 2200')
    await page.getByLabel('想找的队友').fill('周末晚间五排，友好交流')
    await page.getByRole('button', { name: '添加游戏账号', exact: true }).click()
    await page.getByLabel('游戏名称 1', { exact: true }).fill('Faceit')
    await page.getByLabel('游戏账号 1', { exact: true }).fill('web_player')
    assert.equal((await submitCard()).code, 0)
    const stored = await apiCard(token)
    assert.equal(stored.steam_id, steam64)
    assert.equal(stored.steam_friend_code, '00123456')
    assert.equal(stored.signature, '前端联调：认真沟通，一起复盘。')
    assert.deepEqual(stored.other_game_ids, [{ game: 'Faceit', account: 'web_player' }])
    await page.reload({ waitUntil: 'networkidle' })
    await page.locator('#startup-splash').waitFor({ state: 'detached' })
    assert.equal(await page.getByLabel('Steam 账号').inputValue(), steam64)
    assert.equal(await page.getByLabel('个性签名').inputValue(), stored.signature)
    assert.equal(await page.getByLabel('Steam 好友码', { exact: true }).inputValue(), '00123456')
    check(
      'full card persistence in real SQLite, separate Steam ID and friend code, normalization and refresh restoration',
    )

    await page.getByLabel('Steam 账号').fill('')
    await page.getByLabel('Steam 好友码', { exact: true }).fill('')
    const cleared = await submitCard()
    assert.equal(cleared.code, 0)
    assert.equal(cleared.data.steam_id, null)
    assert.equal(cleared.data.steam_friend_code, null)
    assert.equal(cleared.data.has_platform_id, false)
    assert.equal(cleared.data.signature, stored.signature)
    await page.getByLabel('Steam 账号').fill(steam64)
    const other = await context.request.post(backend + '/api/v1/auth/register', {
      data: { username: username + '_b', password },
    })
    assert.equal(other.status(), 201)
    const otherToken = (await other.json()).data.access_token
    const reserved = 'PW_' + Date.now()
    const reserve = await context.request.patch(backend + '/api/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${otherToken}` },
      data: { wanmei_id: reserved },
    })
    assert.equal(reserve.status(), 200)
    await page.getByLabel('完美世界账号').fill(reserved)
    assert.equal((await submitCard()).code, 40900)
    await page.getByRole('alert').filter({ hasText: '该平台账号已绑定其他用户' }).waitFor()
    await page.getByLabel('完美世界账号').fill('')
    check(
      'all platform fields can be cleared while preserving the card; duplicate-platform conflicts remain enforced',
    )

    const image = Buffer.from(
      await page.evaluate(() => {
        const canvas = document.createElement('canvas')
        canvas.width = 128
        canvas.height = 96
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#ed9a60'
        ctx.fillRect(0, 0, 128, 96)
        return canvas.toDataURL('image/png').split(',')[1]
      }),
      'base64',
    )
    let response = page.waitForResponse(match('/users/me/avatar', 'POST'))
    await page
      .getByLabel('选择头像')
      .setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: image })
    const avatar = (await (await response).json()).data
    assert.equal(avatar.width, 512)
    assert.equal(avatar.height, 512)
    assert.equal((await apiCard(token)).avatar_url, avatar.avatar_url)
    await page.locator('.top-actions .avatar img').waitFor()
    await page.waitForFunction(
      () => document.querySelector('.top-actions .avatar img').naturalWidth === 512,
    )
    const proxied = await context.request.get(base + avatar.avatar_url)
    assert.equal(proxied.status(), 200)
    assert.ok(proxied.headers()['content-type'].includes('image/jpeg'))
    response = page.waitForResponse(match('/users/me/avatar', 'POST'))
    await page
      .getByLabel('选择头像')
      .setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: image })
    const replacement = (await (await response).json()).data
    assert.notEqual(replacement.avatar_url, avatar.avatar_url)
    assert.equal((await context.request.get(backend + avatar.avatar_url)).status(), 404)
    check(
      'real avatar upload, 512px resize, frontend /uploads proxy, synchronized header and old-file replacement',
    )

    let count = requests.filter(
      (row) => row.url.endsWith('/avatar') && row.method === 'POST',
    ).length
    await page.getByLabel('选择头像').setInputFiles({
      name: 'large.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
    })
    await page.getByRole('alert').filter({ hasText: '不超过 2 MB' }).waitFor()
    assert.equal(
      requests.filter((row) => row.url.endsWith('/avatar') && row.method === 'POST').length,
      count,
    )
    await page
      .getByLabel('选择头像')
      .setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') })
    await page.getByRole('alert').filter({ hasText: '仅支持 JPEG' }).waitFor()
    response = page.waitForResponse(match('/users/me/avatar', 'POST'))
    await page.getByLabel('选择头像').setInputFiles({
      name: 'fake.png',
      mimeType: 'image/png',
      buffer: Buffer.from('not a real image'),
    })
    assert.equal((await response).status(), 400)
    assert.equal((await apiCard(token)).avatar_url, replacement.avatar_url)
    await page.getByLabel('个性签名').fill('尚未保存的草稿')
    response = page.waitForResponse(match('/users/me/avatar', 'DELETE'))
    await page.getByRole('button', { name: '删除头像', exact: true }).click()
    assert.equal((await response).status(), 200)
    await page.locator('.top-actions .avatar img').waitFor({ state: 'detached' })
    assert.equal(await page.getByLabel('个性签名').inputValue(), '尚未保存的草稿')
    assert.equal((await apiCard(token)).avatar_url, null)
    check(
      'avatar type/size checks, real invalid-image rejection, deletion and preservation of unsaved form edits',
    )

    await page.getByRole('button', { name: '退出登录', exact: true }).click()
    await page.waitForURL(base + '/')
    assert.equal(await page.evaluate(() => localStorage.getItem('csdm.token')), null)
    assert.equal(
      requests.some((row) => row.url.endsWith('/auth/logout')),
      false,
    )
    await page.goto(base + '/profile', { waitUntil: 'networkidle' })
    await page.locator('#startup-splash').waitFor({ state: 'detached' })
    await page.waitForURL('**/login?redirect=/profile')
    await page.getByLabel('用户名', { exact: true }).fill(username)
    await page.getByLabel('密码', { exact: true }).fill('wrong_password')
    await page.getByRole('button', { name: '登录', exact: true }).last().click()
    await page.getByRole('alert').filter({ hasText: '用户名或密码不正确' }).waitFor()
    await page.getByLabel('密码', { exact: true }).fill(password)
    await page.getByRole('button', { name: '登录', exact: true }).last().click()
    await page.waitForURL('**/profile')
    await page.getByRole('heading', { name: '我的玩家名片', exact: true }).waitFor()
    check('local-only logout, protected redirect, invalid credentials and real login')

    await page.screenshot({ path: path.join(output, 'profile-desktop.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForFunction(
      () => document.querySelector('.sidebar').getBoundingClientRect().right <= 0,
    )
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.getByRole('button', { name: '上传头像', exact: true }).waitFor()
    await page.screenshot({ path: path.join(output, 'profile-mobile.png'), fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1050 })
    await page.locator('nav a[href="/lobbies"]').click()
    await page.waitForURL('**/lobbies')
    await page.locator('.lobby-card').first().waitFor()
    assert.equal((await context.request.get(backend + '/api/v1/lobbies')).status(), 501)
    const demos = await page.evaluate(async () =>
      (
        await fetch('/api/v1/demos?page=1&pageSize=100', {
          headers: { Authorization: `Bearer ${localStorage.getItem('csdm.token')}` },
        })
      ).json(),
    )
    assert.equal(demos.code, 0)
    check(
      'mobile form and avatar controls remain usable; lobby and Demo remain mocked placeholders',
    )

    await page.locator('nav a[href="/profile"]').click()
    await page.getByRole('heading', { name: '我的玩家名片', exact: true }).waitFor()
    await page.evaluate(() => localStorage.setItem('csdm.token', 'invalid-test-token'))
    await page.getByRole('button', { name: '保存资料', exact: true }).click()
    await page.waitForURL('**/login?redirect=/profile')
    assert.equal(await page.evaluate(() => localStorage.getItem('csdm.token')), null)
    await page.getByRole('button', { name: '注册', exact: true }).click()
    await page.getByLabel('用户名', { exact: true }).fill(username)
    await page.getByLabel('密码', { exact: true }).fill(password)
    await page.getByLabel('确认密码', { exact: true }).fill(password)
    await page.getByRole('button', { name: '创建账号', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '该用户名已被注册' }).waitFor()
    check('invalid JWT clears login and redirects; duplicate usernames are handled')
    assert.deepEqual(errors, [])
    await writeFile(path.join(output, 'result.json'), JSON.stringify({ checks, errors }, null, 2))
    console.log(JSON.stringify({ checks, errors }, null, 2))
  } catch (error) {
    await page
      .screenshot({ path: path.join(output, 'failure.png'), fullPage: true })
      .catch(() => {})
    console.error('BROWSER ERRORS', errors)
    throw error
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
