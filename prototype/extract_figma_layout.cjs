const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { chromium } = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'))

;(async () => {
  const root = __dirname
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'figma-frames', 'manifest.json'), 'utf8'))
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
    const result = []
    for (const screen of manifest.screens) {
      await page.goto(pathToFileURL(path.join(root, 'modao_pages', `${screen.key}.html`)).href)
      const layout = await page.evaluate(() => {
        const rgb = value => {
          const m = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
          return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] == null ? 1 : Number(m[4])] : null
        }
        const box = el => {
          const r = el.getBoundingClientRect()
          return [r.x + window.scrollX, r.y + window.scrollY, r.width, r.height].map(Math.round)
        }
        const visible = el => {
          const s = getComputedStyle(el)
          const b = box(el)
          return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0 && b[2] > 0 && b[3] > 0
        }
        const shapes = []
        const shapeSelector = '.sidebar,.top,.hero,.panel,.card,.button,.tag,.pill,.hint,.empty,.bar,.nav a.active,.tabs a.active,input,select'
        for (const el of document.querySelectorAll(shapeSelector)) {
          if (!visible(el)) continue
          const s = getComputedStyle(el)
          const fill = rgb(s.backgroundColor)
          const stroke = rgb(s.borderTopColor)
          const sw = parseFloat(s.borderTopWidth) || 0
          const b = box(el)
          if (b[0] < -10 || b[1] < -10 || b[0] + b[2] > 1450 || b[2] > 1440) continue
          shapes.push({name: `${el.tagName.toLowerCase()}.${String(el.className).trim().replace(/\s+/g, '.')}`,box:b,fill,stroke:sw?stroke:null,sw,radius:parseFloat(s.borderTopLeftRadius)||0})
        }
        const texts = []
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        for (let node; node = walker.nextNode();) {
          const value = node.textContent.trim().replace(/\s+/g, ' ')
          if (!value || !visible(node.parentElement)) continue
          const range = document.createRange()
          range.selectNodeContents(node)
          const r = range.getBoundingClientRect()
          if (!r.width || !r.height) continue
          const s = getComputedStyle(node.parentElement)
          const b = [Math.round(r.x+window.scrollX),Math.round(r.y+window.scrollY),Math.round(r.width),Math.round(r.height)]
          if (b[0] < -10 || b[1] < -10 || b[0]+b[2] > 1450) continue
          texts.push({text:value,box:b,size:Math.round(parseFloat(s.fontSize)),weight:parseInt(s.fontWeight)||400,color:rgb(s.color)})
        }
        for (const el of document.querySelectorAll('input,select')) {
          if (!visible(el)) continue
          const s=getComputedStyle(el), b=box(el)
          texts.push({text:el.value||el.selectedOptions?.[0]?.textContent||'',box:[b[0]+10,b[1]+8,b[2]-20,b[3]-16],size:Math.round(parseFloat(s.fontSize)),weight:400,color:rgb(s.color)})
        }
        const hotspots = [...document.querySelectorAll('a[href$=".html"]')].filter(visible).map(el=>({target:el.getAttribute('href').replace(/\.html$/,''),label:el.textContent.trim().replace(/\s+/g,' '),box:box(el)}))
        return {height:Math.max(document.documentElement.scrollHeight,900),shapes,texts,hotspots}
      })
      result.push({...screen,...layout})
    }
    const out = path.join(root, 'figma-layout.json')
    fs.writeFileSync(out, JSON.stringify(result))
    console.log(`Extracted ${result.length} editable layouts, ${result.reduce((n,x)=>n+x.texts.length,0)} texts, ${result.reduce((n,x)=>n+x.hotspots.length,0)} links`)
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
