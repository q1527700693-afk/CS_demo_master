// Isolated browser tests: real Vue/API client, synthetic HTTP responses, no production data.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const runtime = path.join(
  process.env.USERPROFILE,
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules',
)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(runtime, 'playwright'))
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'test-results/tactical-v1.3.0')
fs.mkdirSync(output, { recursive: true })
const teams = [
  { team_clan_name: '对手 & A', names: ['Opponent'], steamids: ['1'] },
  { team_clan_name: '我方 B', names: ['Player'], steamids: ['2'] },
]
function summary(team) {
  return {
    status: 'ok',
    map: 'de_dust2',
    own_team: { label: team, team_clan_name: team },
    opponent_team: { label: '对手' },
    scout_defense_profile: {
      rounds_observed: 6,
      initial: { A: 2, B: 2 },
      hold_rate: { A: 0, B: null },
      retake_seconds: { A: 15, B: null },
      rotation: {
        sampled_rounds: 6,
        rotated_rounds: 2,
        average_seconds: 8,
        speed: '较快',
        abandoned_opposite_rounds: 1,
      },
      confidence: 'medium',
      signals: ['优先观察 B 点回防'],
    },
    round_recommendations: [
      {
        round_num: 3,
        primary_site: 'B',
        site_scores: { A: 2, B: 5 },
        recommended_tactic_name: team + ' · B 点夹击',
        confidence: 'medium',
        reasons: ['B 点回防较慢'],
        risks: ['回合样本较少'],
        spawn_labels: ['B 点近身位'],
        economy: {
          own: { buy_type: 'force', buy_label: '半起' },
          enemy: { buy_type: 'full', buy_label: '长枪' },
        },
        review: {
          outcome: 'win',
          actual_site: 'B',
          followed_plan: true,
          credits: ['首杀打开局面'],
          causes: [],
          suggestions: ['注意补枪距离'],
        },
      },
    ],
    weapon_highlights: [
      {
        player_name: 'Player',
        weapon: 'revolver',
        weapon_label: 'R8 Revolver',
        cost: 600,
        kills: 2,
        first_bloods: 1,
        economy_kills: 2,
        multi_kill_rounds: 1,
        rounds: [3],
        reason: '低经济首杀与多杀',
        evidence_ids: ['kill_1', 'not_loaded'],
      },
    ],
    player_weapon_impact: [
      { name: 'Player', weapon_impact_score: 4.5, kills: 2, first_bloods: 1, economy_kills: 2 },
    ],
    weapon_transitions: [
      { player_name: 'Player', round_num: 3, from_label: 'Glock', to_label: 'R8' },
    ],
    weapon_limitations: ['Weapon prices are approximate CS2 values.'],
    limitations: ['倾向分不是胜率，样本较少时谨慎解读。'],
  }
}
const harness = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<div id="app" class="review-dashboard" style="max-width:1100px;margin:auto"></div>
<script type="module">
import {createApp, reactive, h} from 'vue'
import Review from '/src/features/replay/ReviewDust2.vue'
import '/src/styles.css'
import '/src/features/replay/review.css'
window.state = reactive({analysisId:'cloud:fixture',map:'de_dust2',targetPlayerId:'2',
events:[{event_id:'kill_1',round_num:3,tick:100,type:'kill',data:{}}]})
window.selectedRounds=[];window.selectedEvents=[]
createApp({render:()=>h(Review,{...window.state,onRound:r=>window.selectedRounds.push(r),onEvent:e=>window.selectedEvents.push(e.event_id)})}).mount('#app')
</script></html>`
fs.writeFileSync(path.join(output, 'harness.html'), harness)
let vite,
  browser,
  page,
  mode = 'ok',
  teamMode = 'ok'
const requests = [],
  errors = [],
  checks = []
const check = (message) => {
  checks.push(message)
  console.log('PASS ' + message)
}
;(async () => {
  Object.assign(process.env, {
    VITE_API_BASE_URL: '/api/v1',
    VITE_MOCK_AUTH: 'false',
    VITE_MOCK_PROFILE: 'false',
    VITE_MOCK_REPLAY: 'false',
  })
  const { createServer } = await import(
    pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js'))
  )
  vite = await createServer({ root, server: { port: 15183, host: '127.0.0.1', strictPort: true } })
  await vite.listen()
  browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/api/v1/demo-analyses/**', async (route) => {
    const u = new URL(route.request().url())
    requests.push(u.pathname + u.search)
    let data,
      status = 200
    if (u.pathname.endsWith('/teams')) {
      status = teamMode === 'old' ? 404 : 200
      data = { teams: teamMode === 'empty' ? [] : teams }
    } else {
      const team = u.searchParams.get('team')
      data = summary(team)
      if (mode === 'aggregate') {
        const highlight = data.weapon_highlights[0]
        delete highlight.weapon
        delete highlight.weapon_label
        delete highlight.cost
        highlight.weapons = [
          { weapon: 'revolver', weapon_label: 'R8 Revolver', kills: 2, first_bloods: 1 },
          { weapon: 'deagle', weapon_label: 'Desert Eagle', kills: 1, first_bloods: 0 },
        ]
      }
      if (mode === 'error') status = 500
      if (mode === 'slow' && team === teams[0].team_clan_name)
        await new Promise((r) => setTimeout(r, 700))
    }
    try {
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({
          code: status === 200 ? 0 : status * 100,
          message: '测试服务暂时不可用',
          data,
        }),
      })
    } catch (e) {
      if (!/closed|disposed|aborted/i.test(e.message)) throw e
    }
  })
  const base = 'http://127.0.0.1:15183/test-results/tactical-v1.3.0/harness.html'
  await page.goto(base)
  const select = page.getByLabel('选择自家队伍')
  await page.getByText('我方 B · B 点夹击', { exact: true }).waitFor()
  assert.equal(await select.inputValue(), '我方 B')
  assert.equal(
    await page
      .locator('.dust2-metric')
      .filter({ hasText: 'A 守住率' })
      .locator('strong')
      .innerText(),
    '0%',
  )
  assert.equal(
    await page
      .locator('.dust2-metric')
      .filter({ hasText: 'B 守住率' })
      .locator('strong')
      .innerText(),
    '—',
  )
  check('Default perspective matches the analyzed player; zero and missing metrics remain distinct')
  assert.ok((await page.locator('.dust2-profile').innerText()).includes('较快'))
  assert.ok((await page.locator('.dust2-round-card').innerText()).includes('B 点近身位'))
  assert.ok((await page.locator('.dust2-round-card').innerText()).includes('首杀打开局面'))
  check('Live-only rotation, economy, spawn positions and round reviews are preserved')
  await page.getByRole('button', { name: '回看第 3 回合' }).click()
  await page.getByRole('button', { name: 'kill_1 ↗', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.selectedRounds), [3])
  assert.deepEqual(await page.evaluate(() => window.selectedEvents), ['kill_1'])
  assert.equal(
    await page.getByRole('button', { name: 'not_loaded ↗', exact: true }).isDisabled(),
    true,
  )
  check('Round and loaded evidence navigation emit the correct identities')
  mode = 'slow'
  await Promise.all([
    page.waitForRequest(
      (r) => r.url().includes('team=') && new URL(r.url()).searchParams.get('team') === '对手 & A',
    ),
    select.selectOption('对手 & A'),
  ])
  await select.selectOption('我方 B')
  await page.getByText('我方 B · B 点夹击', { exact: true }).waitFor()
  await page.waitForTimeout(850)
  assert.equal(await page.getByText('对手 & A · B 点夹击', { exact: true }).count(), 0)
  check('Fast perspective changes cannot display an earlier response')
  mode = 'error'
  await select.selectOption('对手 & A')
  await page.getByRole('button', { name: '重试分析' }).waitFor()
  mode = 'ok'
  await page.getByRole('button', { name: '重试分析' }).click()
  await page.getByText('对手 & A · B 点夹击', { exact: true }).waitFor()
  check('Summary failures can be retried without reopening the report')
  mode = 'aggregate'
  await select.selectOption('我方 B')
  await page.getByText('Desert Eagle 1 杀', { exact: true }).waitFor()
  assert.equal(await page.locator('.dust2-weapon-card').count(), 1)
  check('Aggregated multi-weapon highlights remain grouped by player')
  await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true })
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    'Mobile overflow',
  )
  check('390px mobile view has no horizontal overflow')
  teamMode = 'old'
  await page.reload()
  await page
    .getByText('当前服务尚未开放这份报告的战术分析，请稍后重试。', { exact: false })
    .waitFor()
  teamMode = 'ok'
  await page.getByRole('button', { name: '重新读取队伍' }).click()
  await page.getByText('我方 B · B 点夹击', { exact: true }).waitFor()
  check('An older backend produces an actionable fallback and supports recovery')
  teamMode = 'empty'
  await page.reload()
  await page.getByText('这份报告没有可识别的队伍名单', { exact: false }).waitFor()
  check('Missing rosters do not generate a fabricated tactical report')
  let count = requests.length
  await page.evaluate(() => {
    window.state.map = 'de_mirage'
  })
  await page.getByText('目前只支持 Dust2', { exact: true }).waitFor()
  assert.equal(requests.length, count)
  await page.evaluate(() => {
    window.state.analysisId = 'zip-fixture'
    window.state.map = 'de_dust2'
  })
  await page.getByText('战术分析暂时只支持云端上传的 .dem', { exact: true }).waitFor()
  assert.equal(requests.length, count)
  check('Other maps and ZIP reports show scope guidance without calling unsupported APIs')
  assert.deepEqual(errors, [])
  fs.writeFileSync(
    path.join(output, 'results.json'),
    JSON.stringify({ checks, errors, synthetic: true }, null, 2),
  )
})()
  .catch(async (e) => {
    console.error(e)
    if (page)
      await page
        .screenshot({ path: path.join(output, 'failure.png'), fullPage: true })
        .catch(() => {})
    process.exitCode = 1
  })
  .finally(async () => {
    await browser?.close()
    await vite?.close()
  })
