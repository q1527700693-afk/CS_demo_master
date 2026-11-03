const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { chromium } = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))

;(async () => {
  const root = __dirname
  const html = path.join(root, 'figma-source.html')
  const out = path.join(root, 'figma-frames')
  fs.mkdirSync(out, { recursive: true })
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
    const url = pathToFileURL(html).href
    await page.goto(url)
    const screens = await page.locator('.screen').evaluateAll(nodes => nodes.map(node => ({ key: node.id, title: node.dataset.title })))
    const keys = new Set(screens.map(screen => screen.key))
    const links = await page.locator('a[href^="#"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href').slice(1)))
    assert(links.every(key => keys.has(key)), `Missing destinations: ${links.filter(key => !keys.has(key)).join(', ')}`)
    const hotspots = {}
    for (const [index, screen] of screens.entries()) {
      await page.goto(`${url}#${screen.key}`)
      assert.equal(await page.locator('.screen:visible').count(), 1)
      assert(await page.locator(`#${screen.key}`).isVisible())
      hotspots[screen.key] = await page.locator('a[href^="#"]:visible').evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect()
        return {
          label: node.textContent.trim().replace(/\s+/g, ' '),
          target: node.getAttribute('href').slice(1),
          x: Math.round(box.x + window.scrollX),
          y: Math.round(box.y + window.scrollY),
          width: Math.round(box.width),
          height: Math.round(box.height),
        }
      }))
      await page.screenshot({ path: path.join(out, `${String(index + 1).padStart(2, '0')}-${screen.key}.png`), fullPage: true })
    }
    for (const key of ['report-overview', 'report-rounds', 'report-utility', 'report-data']) {
      await page.goto(`${url}#${key}`)
      assert(await page.locator(`#${key}`).isVisible())
    }
    await page.goto(`${url}#lobby-create`)
    await page.locator('#lobby-create a[href="#lobby-created"]').click()
    await page.locator('#lobby-created').waitFor({ state: 'visible' })
    await page.locator('#lobby-created a[href="#lobby-owner"]').click()
    await page.locator('#lobby-owner').waitFor({ state: 'visible' })
    await page.locator('#lobby-owner a[href="#lobby-departed"]').click()
    await page.locator('#lobby-departed').waitFor({ state: 'visible' })
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ screens, links: links.length, hotspots }, null, 2))
    console.log(`Exported ${screens.length} frames; checked ${links.length} links and publish-lobby flow`)
  } finally {
    await browser.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
