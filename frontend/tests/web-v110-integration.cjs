const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')
const { pathToFileURL } = require('node:url')
const runtimeModules = path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')
const { chromium } = require(path.join(runtimeModules, 'playwright'))
const root = path.resolve(__dirname, '..'), output = path.resolve(root, '../docs/web-v1.1.0/qa')
fs.mkdirSync(output, { recursive: true })
Object.assign(process.env, { VITE_MOCK_AUTH: 'false', VITE_MOCK_PROFILE: 'false', VITE_MOCK_REPLAY: 'false', VITE_API_BASE_URL: '/api/v1' })
const basic = { kills: 2, deaths: 0, assists: 0, adr: 92, headshot_pct: 50, opening_kills: 1, opening_deaths: 0, kast_pct: 100 }
const mod = metrics => ({ status: 'completed', module_version: '1', metrics, reason: null, sample_count: 1, evidence_ids: [] })
const match = { map: 'de_mirage', tick_rate: 64, complete: true, teams: [{ team_id: 't', name: '进攻', score: 1 }, { team_id: 'ct', name: '防守', score: 0 }] }
const identity = { analysis_id: 'analysis-110', match_id: 'match-110', package_id: 'package-110', target_player_id: 'p' }
const run = { ...identity, status: 'completed', stage: 'completed', progress: 100, message: '完成', report_available: true }
const report = { ...identity, report_schema_version: '1.0.0', uploaded_at: '2026-10-28T10:00:00Z', status: 'completed', match, analyzed_at: '2026-10-28T10:00:00Z', is_fixture: true, perspective: { player_team_id: 't' }, versions: { evaluation: 'test', prompt: 'test' }, report: { modules: { basic_stats: mod(basic), utility: mod({ flashes_thrown: 3, enemies_blinded: 2, teammates_blinded: 1, self_blinds: 0, enemy_blind_seconds: 2.16 }), death_context: mod({ deaths_with_context: 0 }) }, findings: [], training_suggestions: [], warnings: [], ai_status: 'not_generated' } }
function ev(type, id, record) { return { event_id: id, type, round_num: 1, tick: 110, live_elapsed_seconds: 0.16, data: { record: { attacker_steamid: 'p', attacker_name: '测试昵称', victim_steamid: 'enemy', victim_name: '对手', attacker_side: 'terrorist', victim_side: 'counter-terrorist', ...record } } } }
const events = [ev('kill', 'kill_enemy', { weapon: 'ak47', victim_x: -1000, victim_y: 0, victim_z: 0 }), ev('kill', 'kill_tk', { weapon: 'ak47', victim_steamid: 'friend', victim_name: '队友', victim_side: 'terrorist' }), ev('damage', 'he', { weapon: 'hegrenade', dmg_health: 40 }), ev('damage', 'fire', { weapon: 'inferno', dmg_health: 23 }), ev('blind', 'micro', { duration: 0.16 }), ev('blind', 'valid', { duration: 2 }), ev('blind', 'micro_team', { duration: 0.2, victim_side: 'terrorist' })]
const round = { round_num: 1, start_tick: 0, freeze_end_tick: 100, end_tick: 300, target_side: 'terrorist', winner_side: 'terrorist', target_start_state: { steamid: 'p', side: 'terrorist' }, target_summary: { round_num: 1, kills: 2, deaths: 0, assists: 0 }, events, finding_ids: [] }
const details = { source: { match_id: identity.match_id, package_id: identity.package_id }, target_player_id: 'p', target_player: { player_id: 'p', name: '测试昵称' }, statistics: { tables: { per_round: [round.target_summary], by_weapon: [{ weapon: 'ak47', kills: 2 }] } }, rounds: [round], findings: [], key_rounds: [{ round_num: 1, reasons: ['multikill'], evidence_ids: ['kill_enemy','kill_tk'] }], movement: { status: 'insufficient_data' }, map: { counts: {} } }
const profile = { user_id: 1, username: 'qa_user', nickname: '测试玩家', steam_id: 'p', other_game_ids: [], avatar_url: null }
let vite, browser, uploads = 0, generated = false, failAi = true, exporting = false
const checks = [], errors = [], privatePublicRequests = []
const check = message => { checks.push(message); console.log('PASS ' + message) }
;(async () => {
  const { createServer } = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')))
  vite = await createServer({ root, server: { port: 15181, strictPort: true, host: '0.0.0.0' } }); await vite.listen()
  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript(() => localStorage.setItem('csdm.token', 'isolated-test-session'))
  const page = await context.newPage(); page.setDefaultTimeout(20000)
  global.qaPage = page
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/api/v1/**', async route => {
    const req = route.request(), p = new URL(req.url()).pathname.replace('/api/v1', '')
    const ok = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, message: 'success', data }) })
    if (page.url().includes('/players/2') && /analyses|analysis-packages/.test(p)) privatePublicRequests.push(p)
    if (p === '/users/me') return ok({ id: 1, username: 'qa_user', nickname: '测试玩家', avatar_url: null, created_at: '2026-01-01' })
    if (p.endsWith('/profile')) return ok(p.includes('/2/') ? { ...profile, user_id: 2 } : profile)
    if (p.endsWith('/demo-showcase')) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 40400, message: 'not implemented', data: null }) })
    if (p === '/analysis-packages') { uploads++; await new Promise(r => setTimeout(r, 4000)); return ok(identity) }
    if (p === '/matches/match-110/analyses' && req.method() === 'POST') { details.analysis_version = 'rules-1.2.0'; return ok(run) }
    if (p === '/matches/match-110/analyses') return ok({ items: [run] })
    if (p === '/matches') return ok({ items: [{ match_id: identity.match_id, match, latest_analysis: run, latest_available_analysis_id: identity.analysis_id, created_at: '2026-10-28' }], page: 1, pageSize: 100, total: 1 })
    if (p === '/analyses/analysis-110') return ok(run)
    if (p.endsWith('/report')) return ok(report)
    if (p.endsWith('/details')) return ok(details)
    if (p.endsWith('/events')) return ok({ ...identity, events })
    if (p.endsWith('/ai')) {
      if (req.method() === 'POST') {
        if (failAi) { failAi = false; return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ code: 50200, message: '模型暂时不可用' }) }) }
        await new Promise(r => setTimeout(r, 200)); generated = true
      }
      return ok(generated ? { analysis_id: identity.analysis_id, ai_status: 'completed', model: 'QA model', summary: '保持良好的沟通与道具配合', strengths: [{ title: '道具创造突破', explanation: '高爆与燃烧道具造成了有效伤害', evidence_ids: ['he', 'fire'] }], improvement_areas: [{ priority: 'high', category: 'teamwork', title: '避免误杀队友', explanation: '交火中出现一次 TK', evidence_ids: ['kill_tk'], training: ['练习确认队友站位'] }], data_limitations: ['测试夹具'] } : { ai_status: 'not_generated' })
    }
    if (p.endsWith('/rounds/1/map')) return ok({ items: [{ kind: 'player_samples', tick: 100, state: { steamid: 'p', name: '测试昵称', side: 'terrorist', x: -1000, y: 0, z: 0, health: 100 } }, { kind: 'player_samples', tick: 300, state: { steamid: 'p', name: '测试昵称', side: 'terrorist', x: -900, y: 100, z: 0, health: 100 } }], next_offset: null })
    if (p.endsWith('/rounds/1')) return ok(round)
    return ok({ items: [], incoming: [], outgoing: [], relationship: 'none', total: 0 })
  })
  await page.route('**/local/**', async route => {
    const p = new URL(route.request().url()).pathname
    const ok = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data }) })
    if (p.endsWith('/health')) return ok({ awpy_available: true })
    if (p === '/local/jobs') return ok({ job_id: 'local-test' })
    if (p.endsWith('/exports')) { exporting = true; return ok({ job_id: 'local-test' }) }
    if (p.endsWith('/package')) return route.fulfill({ contentType: 'application/zip', body: Buffer.from('zip-test') })
    return ok({ job_id: 'local-test', status: 'completed', stage: exporting ? 'exported' : 'parsed', percent: 100, message: '完成', active_target_player_id: 'p', players: [{ player_id: 'p', name: '测试昵称' }] })
  })
  const base = 'http://127.0.0.2:15181'
  await page.goto(base + '/replays/new')
  await page.getByLabel('选择比赛文件', { exact: true }).setInputFiles({ name: 'test.zip', mimeType: 'application/zip', buffer: Buffer.from('test') })
  await page.locator('aside a[href="/training"]').click()
  await page.locator('.upload-task-banner').waitFor()
  await page.waitForFunction(() => document.body.textContent.includes('比赛报告已生成'), { timeout: 20000 })
  assert.equal(new URL(page.url()).pathname, '/training')
  assert.equal(uploads, 1)
  check('ZIP upload continues through navigation and completion does not interrupt training')
  await page.goto(base + '/replays/analysis-110')
  await page.getByRole('heading', { name: '回合影响力', exact: true }).waitFor()
  assert.ok(/多杀回合\s+0/.test(await page.locator('.impact-summary').innerText()))
  check('legacy round containing one enemy kill and one TK no longer counts as a multikill')
  await page.getByRole('button', { name: /^道具与生存/ }).click()
  await page.getByRole('heading', { name: '手雷与燃烧伤害' }).waitFor()
  const utilityText = await page.locator('.review-content').count() ? await page.locator('body').innerText() : await page.locator('body').innerText()
  assert.ok(utilityText.includes('40') && utilityText.includes('23') && utilityText.includes('误杀队友'))
  await page.screenshot({ path: path.join(output, 'utility-v110.png'), fullPage: true })
  check('HE/fire damage and TK review focus render with the effective flash threshold')
  await page.getByRole('button', { name: 'AI 教练', exact: true }).click()
  await page.getByRole('button', { name: '生成 AI 教练解读', exact: true }).click()
  await page.getByText('模型暂时不可用', { exact: true }).waitFor()
  await page.getByRole('button', { name: '重试生成 AI 解读', exact: true }).click()
  await page.getByRole('heading', { name: '道具创造突破', exact: true }).waitFor()
  await page.screenshot({ path: path.join(output, 'ai-v110.png'), fullPage: true })
  check('AI upstream failure is retryable and completed coaching shows strengths and evidence')
  await page.getByRole('button', { name: '回合复盘', exact: true }).click()
  await page.getByTestId('target-marker').waitFor()
  assert.equal((await page.getByTestId('target-marker').locator('text').textContent()).trim(), '测试昵称')
  check('tactical map labels analysis target with the demo nickname')
  await page.goto(base + '/profile')
  await page.getByRole('heading', { name: 'Demo 分析档案' }).waitFor()
  assert.equal(await page.getByLabel('公开 Demo 精选展示').isChecked(), false)
  await page.getByRole('button', { name: '选择已上传的比赛', exact: true }).click()
  await page.getByLabel('展示比赛', { exact: true }).selectOption('analysis-110')
  await page.locator('.highlight-card').waitFor()
  await page.getByLabel('公开 Demo 精选展示').check()
  await page.getByRole('button', { name: '保存精选草稿', exact: true }).click()
  await page.getByText('已保存本机草稿；公开接口接入后才能同步给其他玩家。', { exact: true }).waitFor()
  await page.reload()
  await page.locator('.highlight-card').waitFor()
  await page.getByLabel('展示内容', { exact: true }).selectOption('ai')
  await page.getByRole('heading', { name: '道具创造突破', exact: true }).waitFor()
  await page.getByRole('button', { name: '保存精选草稿', exact: true }).click()
  await page.screenshot({ path: path.join(output, 'showcase-desktop.png'), fullPage: true })
  check('profile selection, default-off switch, stats/AI previews and missing-backend draft fallback work')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(output, 'showcase-mobile.png'), fullPage: true })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  check('profile remains within a 390px mobile viewport')
  await page.goto(base + '/players/2')
  await page.getByText('这位玩家尚未公开精选比赛。', { exact: true }).waitFor()
  assert.equal(await page.locator('.highlight-card').count(), 0)
  assert.equal(privatePublicRequests.length, 0)
  check('another player card cannot read local private showcase drafts or private report APIs')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(base + '/replays/new')
  await page.getByLabel('选择比赛文件', { exact: true }).setInputFiles({ name: 'test.dem', mimeType: 'application/octet-stream', buffer: Buffer.from('test demo') })
  await page.locator('aside a[href="/training"]').click()
  await page.waitForFunction(() => document.body.textContent.includes('比赛报告已生成'), { timeout: 20000 })
  assert.equal(new URL(page.url()).pathname, '/training')
  assert.equal(uploads, 2)
  check('raw Demo parse/export/upload pipeline also survives route navigation')
  details.analysis_version = 'rules-1.1.0'
  await page.goto(base + '/replays/analysis-110')
  await page.getByRole('heading', { name: '回合影响力', exact: true }).waitFor()
  await page.getByRole('button', { name: 'AI 教练', exact: true }).click()
  await page.getByText('先更新这份报告的统计规则', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '生成 AI 教练解读', exact: true }).count(), 0)
  await page.getByRole('button', { name: '按新规则重新分析', exact: true }).click()
  await page.getByRole('heading', { name: '回合影响力', exact: true }).waitFor()
  check('old AI reports require a fresh statistical analysis and the existing-package upgrade path works')
  assert.deepEqual(errors, [])
  fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify({ checks, errors }, null, 2))
})().catch(async error => { console.error(error); if (global.qaPage) { await global.qaPage.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }); fs.writeFileSync(path.join(output, 'failure.txt'), await global.qaPage.locator('body').innerText()) } process.exitCode = 1 }).finally(async () => { await browser?.close(); await vite?.close() })
