// Serve a deliberately stale, long-lived native-module cache beside the current
// production build. Query-versioned module URLs must escape this old cache.
const http = require('node:http'), path = require('node:path'), fs = require('node:fs/promises')
const project = path.resolve(__dirname, '..'), dist = path.join(project, 'dist')
const legacy = path.resolve(project, '../front_end_v1.3.1/public/vector-trainer/src/renderer.js')
const mime = { '.js':'application/javascript', '.css':'text/css', '.html':'text/html', '.json':'application/json', '.glb':'model/gltf-binary', '.png':'image/png', '.jpg':'image/jpeg' }
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/legacy.html') {
      res.writeHead(200, { 'Content-Type':'text/html', 'Cache-Control':'no-store' })
      return res.end('<!doctype html><meta charset="utf-8"><div id="host"></div><script type="module">import { mountTrainer } from "/vector-trainer/src/app.js";mountTrainer(document.querySelector("#host"),{embedded:true});</script>')
    }
    const native = url.pathname.startsWith('/vector-trainer/') && url.pathname.endsWith('.js')
    const old = native && !url.searchParams.has('revision')
    let target = path.resolve(old ? path.join(project, 'public') : dist, '.' + url.pathname)
    const root = old ? path.join(project, 'public') : dist
    if (!target.startsWith(root + path.sep)) throw new Error('outside root')
    if (url.pathname === '/vector-trainer/src/renderer.js' && old) target = legacy
    let data
    try { data = await fs.readFile(target) } catch { if (path.extname(url.pathname)) throw new Error('missing asset'); target = path.join(dist, 'index.html'); data = await fs.readFile(target) }
    res.writeHead(200, { 'Content-Type':mime[path.extname(target)] || 'application/octet-stream', 'Cache-Control':native ? 'public, max-age=31536000, immutable' : 'no-cache' })
    res.end(data)
  } catch { res.writeHead(404).end() }
}).listen(4177, '127.0.0.1', () => console.log('Old-cache regression server: http://127.0.0.1:4177'))
