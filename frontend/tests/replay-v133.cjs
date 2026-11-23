// Exercise the built web app with the legacy cloud API contract in an isolated browser.
const assert = require('node:assert/strict')
const path = require('node:path')
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE ||
    path.join(
      process.env.USERPROFILE,
      '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
    ),
)
const id = 'legacy-test',
  target = '76561198000000001',
  enemy = '76561198000000002'
const match = {
  map: 'de_cbble',
  tick_rate: 64,
  complete: true,
  teams: [
    { team_id: 'terrorist', name: 'Terrorist', score: 3 },
    { team_id: 'counter_terrorist', name: 'Counter-Terrorist', score: 1 },
  ],
}
const source = { match_id: 'demo-aaaaaaaaaaaa', package_id: 'demo-legacy' }
const metrics = { kills: 4, deaths: 3, assists: 1, adr: 90, kast: 75, rounds_played: 4 }
const modules = { basic_stats: { metrics }, utility: { metrics: { utility_damage: 43 } } }
const side = (n) => (n < 13 ? 'counter-terrorist' : 'terrorist')
const rounds = [1, 2, 13, 14].map((n) => ({
  round_num: n,
  winner_side: n === 1 ? 'counter-terrorist' : 'terrorist',
  start_tick: 0,
  end_tick: 128,
  target: { kills: 1, deaths: 1, assists: 0 },
  buy: {},
}))
const demo = {
  demo_id: id,
  status: 'completed',
  report_available: true,
  map: match.map,
  target_player_id: target,
  demo_sha256: 'a'.repeat(64),
  created_at: '2026-11-20T12:00:00Z',
  summary: { target_player_name: 'Test player', adr: 90 },
}
const details = {
  source,
  match,
  target_player_id: target,
  target_player: { steamid: target, name: 'Test player' },
  rounds,
  statistics: { modules },
  findings: [],
  key_rounds: [],
  movement: {},
  map: { counts: {} },
}
const report = {
  ...source,
  analysis_id: id,
  report_schema_version: '1.0.0',
  target_player_id: target,
  perspective: { player_team_id: 'team-counter-terrorist' },
  match,
  versions: { evaluation: 'test', prompt: 'test' },
  report: { modules, findings: [], scores: {}, warnings: [], training_suggestions: [] },
}
function response(url) {
  const route = new URL(url).pathname.replace('/api/v1', '')
  if (route === '/users/me') return { id: 1, username: 'qa', nickname: 'Test player' }
  if (route === '/demo-analyses') return { items: [demo], total: 1 }
  if (route.endsWith('/performance')) return undefined
  if (route.endsWith('/report')) return report
  if (route.endsWith('/details')) return details
  if (route.endsWith('/ai')) return { ai_status: 'not_configured', analysis_id: id }
  const round = route.match(/\/rounds\/(\d+)(\/map)?$/)
  if (!round) return { items: [], total: 0 }
  const n = Number(round[1])
  if (round[2])
    return {
      next_offset: null,
      items: [0, 32, 64, 96, 128].flatMap((tick) =>
        [
          [target, side(n)],
          [enemy, side(n) === 'terrorist' ? 'counter-terrorist' : 'terrorist'],
          ['friend', side(n)],
        ].map(([steamid, s]) => ({
          kind: 'all_player_samples',
          round_num: n,
          tick,
          state: { steamid, side: s, x: -2000 + tick, y: 1000, z: 0, health: 100 },
        })),
      ),
    }
  const events =
    n === 1
      ? [
          ['hegrenade', enemy, 31],
          ['inferno', enemy, 12],
          ['molotov', 'friend', 4],
          ['hegrenade', 'unrecorded', 7],
        ].map(([weapon, victim, amount], i) => ({
          event_id: 'hit' + i,
          type: 'damage',
          round_num: n,
          tick: 10 + i,
          data: { attacker_steamid: target, victim_steamid: victim, weapon, dmg_health: amount },
        }))
      : []
  return { ...rounds.find((r) => r.round_num === n), events }
}
async function main() {
  const server = process.env.REPLAY_TEST_URL ? null : await (await import('vite')).preview({
    root: path.resolve(__dirname, '..'), preview: {host:'127.0.0.1',port:0},
  })
  const base = process.env.REPLAY_TEST_URL || 'http://127.0.0.1:' + server.httpServer.address().port
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  })
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.route('**/api/v1/**', async (r) => {
      if (r.request().method() !== 'GET') throw Error('Unexpected write')
      const data = response(r.request().url())
      await r.fulfill({
        status: data === undefined ? 404 : 200,
        json: { code: data === undefined ? 404 : 0, data },
      })
    })
    await page.addInitScript(() => localStorage.setItem('csdm.token', 'fixture'))
    await page.goto(base)
    const entry = page.getByTestId('overview-replay-entry')
    await entry.waitFor()
    assert.match(await entry.innerText(), /3\s*:\s*1/)
    assert.match(await entry.innerText(), /1\.39\s*估算/)
    await entry.getByRole('link').click()
    await page.locator('.match-score').waitFor()
    assert.deepEqual(await page.locator('.match-score strong').allTextContents(), ['3', '1'])
    await page.getByRole('button', { name: '道具与生存', exact: true }).click()
    const damage = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: '手雷与燃烧伤害' }) })
      .last()
    await damage.waitFor()
    assert.deepEqual(await damage.locator('.utility-totals strong').allTextContents(), [
      '31',
      '12',
      '4',
    ])
    assert.match(await damage.innerText(), /7 点/)
    await page.getByRole('button', { name: '回合复盘', exact: true }).click()
    const radar = page.getByTestId('radar-background')
    await radar.waitFor()
    assert.match(await radar.getAttribute('href'), /de_cbble\.png$/)
    assert.equal(
      await page.evaluate(async () => {
        const img = new Image()
        img.src = document.querySelector('[data-testid="radar-background"]').getAttribute('href')
        await img.decode()
        return img.naturalWidth
      }),
      1024,
    )
    const slider = page.getByRole('slider', { name: '地图时间游标' })
    await slider.fill('0')
    const marker = page.getByTestId('target-marker')
    const first = await marker.getAttribute('transform')
    await slider.fill('6')
    await page.waitForFunction(
      (start) =>
        document.querySelector('[data-testid="target-marker"]')?.getAttribute('transform') !==
        start,
      first,
    )
    await page.getByRole('button', { name: '播放回合' }).click()
    await page.waitForFunction(() => Number(document.querySelector('input[type=range]').value) > 20)
    assert.deepEqual(errors, [])
    console.log(
      'PASS v1.3.3 overview, report, legacy damage, switched-side score, Cobblestone radar and interpolated playback',
    )
  } finally {
    await browser.close()
    if (server) await server.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
