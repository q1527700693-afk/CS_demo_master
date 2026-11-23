const assert = require('node:assert/strict')
const path = require('node:path')
const { chromium } = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))

;(async () => {
  const browser = await chromium.launch({headless:true, executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'})
  try {
    const page = await browser.newPage({viewport:{width:1440,height:900}})
    const base = 'https://hajiyao.github.io/cs-demo-master-prototype/'
    const response = await page.goto(base, {waitUntil:'domcontentloaded',timeout:30000})
    assert.equal(response.status(), 200)
    assert.equal(await page.locator('.screen').count(), 34)
    assert.equal(await page.locator('.screen:visible').count(), 1)
    const missing = await page.locator('a[href^="#"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href').slice(1)).filter(key => !document.getElementById(key)))
    assert.deepEqual(missing, [])
    for (const next of ['report-rounds','report-utility','report-data','report-overview']) {
      await page.goto(`${base}#report-overview`)
      await page.locator(`#report-overview .tabs a[href="#${next}"]`).click()
      await page.locator(`#${next}`).waitFor({state:'visible'})
    }
    await page.goto(`${base}#lobby-create`)
    for (const [from,to] of [['lobby-create','lobby-created'],['lobby-created','lobby-owner'],['lobby-owner','lobby-departed']]) {
      await page.locator(`#${from} a[href="#${to}"]`).first().click()
      await page.locator(`#${to}`).waitFor({state:'visible'})
    }
    console.log(`Public site OK: ${response.status()}, 34 screens, report tabs, publish-lobby flow`)
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode=1 })
