// Real drag/drop -> local awpy -> package -> backend -> automatic report navigation.
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const {fork}=require('node:child_process')
const {pathToFileURL}=require('node:url')
const {setTimeout:delay}=require('node:timers/promises')
const runtimeModules=path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || path.join(runtimeModules,'playwright'))
const root=path.resolve(__dirname,'..'),backend=path.resolve(root,'../backend_service/backend')
const demo=path.resolve(process.env.CSDM_TEST_DEMO || path.join(root,'../test_demos/zywoo/B8-vs-Vitality-Mirage-2394170.dem'))
const output=path.join(root,'test-results/automatic-demo-20261024')
fs.mkdirSync(output,{recursive:true})
const runtime=fs.mkdtempSync(path.join(output,'runtime-'))
const api='http://127.0.0.1:18081',base='http://127.0.0.1:15175'
let server,vite,browser,log=''
const checks=[],errors=[],requests=[]
function check(text){checks.push(text);console.log('PASS '+text)}
;(async()=>{
  server=fork(path.join(backend,'src/server.js'),[],{cwd:backend,env:{...process.env,PORT:'18081',DB_PATH:path.join(runtime,'test.db'),REPLAY_DIR:path.join(runtime,'replays'),UPLOAD_DIR:path.join(runtime,'uploads'),JWT_SECRET:'automatic-demo-isolated-test'},stdio:['ignore','pipe','pipe','ipc']})
  server.stdout.on('data',chunk=>log+=chunk);server.stderr.on('data',chunk=>log+=chunk)
  for(let i=0;i<100;i++){try{if((await fetch(api+'/api/v1/health')).ok)break}catch{}if(i===99)throw new Error(log);await delay(100)}
  Object.assign(process.env,{VITE_API_BASE_URL:'/api/v1',VITE_PROXY_TARGET:api,VITE_MOCK_AUTH:'false',VITE_MOCK_PROFILE:'false',VITE_MOCK_REPLAY:'false',VITE_MOCK_LOBBY:'false'})
  const {createServer}=await import(pathToFileURL(path.join(root,'node_modules/vite/dist/node/index.js')))
  vite=await createServer({root,server:{port:15175,strictPort:true,host:'127.0.0.1'}});await vite.listen()
  const registered=await fetch(api+'/api/v1/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'qa_auto_'+Date.now(),password:'AutomaticDemo_2026!'})})
  assert.equal(registered.status,201)
  const user=(await registered.json()).data
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'})
  const context=await browser.newContext({viewport:{width:1365,height:1000},acceptDownloads:true})
  await context.addInitScript(token=>localStorage.setItem('csdm.token',token),user.access_token)
  const page=await context.newPage();page.setDefaultTimeout(30000)
  page.on('pageerror',e=>errors.push(e.message))
  let downloads=0;page.on('download',()=>downloads++)
  page.on('request',r=>{if(/\/(local|api\/v1)\//.test(r.url())) requests.push({path:new URL(r.url()).pathname,method:r.method(),type:r.headers()['content-type']})})
  await page.goto(base+'/replays/new?view=cloud')
  await page.getByLabel('上传 Demo 或分析包',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'读取玩家名单',exact:true}).count(),0)
  assert.equal(await page.getByRole('button',{name:'开始处理',exact:true}).count(),0)
  assert.equal(await page.getByLabel('本机连接令牌',{exact:true}).count(),0)
  await page.getByLabel('选择比赛文件',{exact:true}).setInputFiles({name:'bad.dem',mimeType:'application/octet-stream',buffer:Buffer.from('invalid demo')})
  await page.getByRole('alert').waitFor()
  assert.equal(requests.filter(r=>r.path==='/api/v1/analysis-packages').length,0)
  check('one upload area; malformed raw demo stops before cloud upload; no manual parse/export/token fields')
  // Populate an inert file input so Chromium can attach the real 331 MiB file to DataTransfer without serializing it.
  await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='qa-drop-source';input.hidden=true;document.body.appendChild(input)})
  await page.locator('#qa-drop-source').setInputFiles(demo)
  await page.evaluate(()=>{const input=document.querySelector('#qa-drop-source');const data=new DataTransfer();data.items.add(input.files[0]);document.querySelector('.drop-zone').dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));input.remove()})
  await page.getByLabel('选择分析玩家',{exact:true}).waitFor({timeout:180000})
  assert.equal(requests.filter(r=>r.path==='/api/v1/analysis-packages').length,0,'must not analyze an arbitrary first player')
  await page.screenshot({path:path.join(output,'choose-player.png'),fullPage:true})
  await page.getByLabel('选择分析玩家',{exact:true}).selectOption('76561198113666193')
  await page.waitForURL(url=>/\/replays\/[\da-f-]+$/.test(url.pathname),{timeout:180000})
  await page.locator('.review-metrics').waitFor()
  const id=page.url().split('/').pop()
  const headers={Authorization:'Bearer '+user.access_token}
  const report=(await(await fetch(api+'/api/v1/analyses/'+id+'/report',{headers})).json()).data
  assert.equal(report.target_player_id,'76561198113666193');assert.equal(report.report.modules.basic_stats.metrics.kills,19)
  assert.equal(report.report.modules.basic_stats.metrics.deaths,9)
  assert.equal(await page.locator('.round-strip button').count(),18)
  assert.equal(downloads,0,'no intermediate ZIP download')
  assert.ok(requests.some(r=>r.path==='/local/jobs'&&r.type==='application/octet-stream'))
  assert.ok(requests.filter(r=>r.path.startsWith('/api/v1/')).every(r=>r.type!=='application/octet-stream'))
  check('real Demo drag/drop -> roster -> one player choice -> detailed extraction -> upload -> analysis -> report, without intermediate ZIP or action buttons')
  await page.screenshot({path:path.join(output,'automatic-result.png'),fullPage:false})

  // Remember the explicit choice and verify a later file needs no second choice.
  await page.goto(base+'/replays/new')
  await page.getByLabel('选择比赛文件',{exact:true}).setInputFiles(demo)
  await page.waitForURL(url=>/\/replays\/[\da-f-]+$/.test(url.pathname),{timeout:180000})
  assert.notEqual(page.url().split('/').pop(),id)
  check('repeat Demo selection automatically reuses the explicitly chosen player and opens a fresh report')

  // Already-exported packages remain supported in the same area.
  const localCalls=requests.filter(r=>r.path.startsWith('/local/')).length
  await page.goto(base+'/replays/new?view=cloud')
  await page.getByLabel('选择比赛文件',{exact:true}).setInputFiles(path.join(root,'docs/analysis-handoff/sample-analysis-v1.1.zip'))
  await page.waitForURL(url=>/\/replays\/[\da-f-]+$/.test(url.pathname),{timeout:60000})
  await page.locator('.review-metrics').waitFor()
  assert.equal(requests.filter(r=>r.path.startsWith('/local/')).length,localCalls)
  assert.ok((await page.locator('.metric-cards').innerText()).includes('33 / 14 / 2'))
  check('existing ZIP selects and automatically opens its report through the same input, without local parsing')

  // Account binding can select the target even in a fresh browser session.
  await fetch(api+'/api/v1/users/me/profile',{method:'PATCH',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({steam_id:'76561198113666193'})})
  await page.evaluate(()=>sessionStorage.clear())
  await page.goto(base+'/replays/new')
  await page.getByLabel('选择比赛文件',{exact:true}).setInputFiles(demo)
  await page.waitForURL(url=>/\/replays\/[\da-f-]+$/.test(url.pathname),{timeout:180000})
  check('bound SteamID automatically chooses the correct player with no player-selection click')
  const denied=await context.request.get(base+'/local/health',{headers:{Origin:'https://unrelated.example'}})
  assert.equal(denied.status(),403)
  assert.deepEqual(errors,[])
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({checks,errors,requests,downloads},null,2))
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{
  fs.writeFileSync(path.join(output,'backend.log'),log)
  if(browser)await browser.close();if(vite)await vite.close()
  if(server){const exited=new Promise(resolve=>server.once('exit',resolve));server.kill();await Promise.race([exited,delay(5000)])}
})

