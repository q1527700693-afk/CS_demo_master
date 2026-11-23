import { TrainingEngine } from './engine.js';
import { TrainingStore } from './storage.js';
import { MODES, DIFFICULTIES, normalizeConfig, modeById, primaryMetric, comparisonKey, isBetter } from './modes.js';
import { icon } from './icons.js';
import { playFeedback } from './audio.js';
import { newSessionId } from './session-id.js';
// Reaction tests have no graphics dependency. Load the arena only for aiming modes.

const styleURL=new URL('../styles.css',import.meta.url).href;
const activeStates=['running','countdown','paused'];
const percent=value=>value==null?'—':`${(value*100).toFixed(1)}%`;
const number=value=>value==null?'—':Math.round(value).toLocaleString('zh-CN');
const dateFormat=new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const ruleLabel=config=>config.mode==='reaction'&&config.rulesVersion>=3?'变色点击':config.rulesVersion===2?'3D':'旧版 2D';
const inputLabel=config=>config.mode==='reaction'?'变色点击':'第一人称';
const escapeHTML=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const crosshairHTML=()=>'<div class="crosshair"><i class="left"></i><i class="right"></i><i class="top"></i><i class="bottom"></i><i class="dot"></i></div>';

export class VectorTrainer extends HTMLElement {
  constructor(){
    super();this.attachShadow({mode:'open'});this.view='practice';this.filter='all';this.pageSize=20;this.lastUI=0;this.lastState='';this.lastResult=null;this.lockPending=false;this.mounted=false;this.expanded=false;this.settingsOpen=false;this.configTab='aim';
  }
  connectedCallback(){
    if(this.mounted)return;this.mounted=true;this.abort=new AbortController();
    let storage;try{storage=window.localStorage;}catch{}
    this.store=new TrainingStore(storage,message=>queueMicrotask(()=>this.toast(message)));this.config={...this.store.settings};
    this.engine=new TrainingEngine({onFinish:result=>this.complete(result)});this.engine.config={...this.config};
    this.shadowRoot.innerHTML=`<link rel="stylesheet" href="${styleURL}">
      <div class="shell">
        <header class="topbar"><div class="brand">VECTOR<span>训练场</span></div><nav class="nav" aria-label="主导航"><button data-view="practice" class="active" aria-current="page">训练</button><button data-view="history">记录</button><button data-view="guide">教程</button></nav><span class="offline" id="offline-status">本地成绩</span></header>
        <main class="main"><div class="page-heading"><div><span class="eyebrow">个人训练</span><h1 id="page-title">瞄准训练</h1></div><div id="hero-stats" class="summary"></div></div>
          <section id="practice-view"><div class="trainer-layout">
            <div class="practice"><section class="stage arena-wrap" id="arena-wrap" aria-label="3D 瞄准训练">
              <canvas id="arena" tabindex="0" aria-label="第一人称训练区域"></canvas>
              <button id="reaction-surface" class="reaction-surface" aria-label="反应测试点击区域" hidden><span class="reaction-symbol" aria-hidden="true">···</span><strong id="reaction-message">等待变绿</strong><span id="reaction-detail">变绿后立即点击</span></button>
              <div class="stage-shade"></div>
              <div class="stage-top"><div class="stage-mode"><span id="arena-english">GRIDSHOT</span><strong id="arena-title">网格点射</strong></div><div class="arena-hud" aria-label="本轮数据"><div><span>时间</span><strong id="hud-time">30.0</strong></div><div><span id="hud-primary-label">得分</span><strong id="hud-score">0</strong><em id="hud-score-unit"></em></div><div><span id="hud-accuracy-label">命中率</span><strong id="hud-accuracy">—</strong></div><div><span id="hud-hits-label">命中</span><strong id="hud-hits">0</strong></div></div></div>
              <div class="stage-controls"><button class="stage-button" data-action="pause" id="pause-button" aria-label="暂停训练">${icon('pause',16)}<span>暂停</span></button><button class="stage-button" data-action="settings" aria-label="训练设置">${icon('target',16)}<span>设置</span></button><button class="stage-button" data-action="fullscreen" aria-label="切换大屏">${icon('full',16)}<span id="expand-label">大屏</span></button><button class="stage-button" data-action="abandon" id="abandon-button" aria-label="退出训练">${icon('close',16)}<span>退出</span></button></div>
              <div class="aim-layer" id="aim-layer">${crosshairHTML()}</div>
              <div class="arena-overlay" id="arena-overlay"></div><div class="stage-bottom"><span><kbd>ESC</kbd> 菜单 <kbd>TAB</kbd> 设置</span><span class="fps-readout" id="hud-fps">— FPS</span><span class="weapon-label">USP-S <b>∞</b></span></div>
            </section><div class="mode-grid" aria-label="选择训练模式">${MODES.map(mode=>`<button class="mode-card" data-mode="${mode.id}" aria-label="${mode.name} ${mode.english}"><small>${mode.number}</small><span>${mode.name}</span><em>${mode.english}</em></button>`).join('')}</div></div>
            <div id="config-dock">${this.settingsHTML()}</div>
          </div><p class="mobile-note">瞄准训练需要桌面鼠标；反应测试可使用触屏。</p></section>
          <section id="history-view" hidden></section><section id="guide-view" hidden>${this.guideHTML()}</section>
        </main>
      </div><div id="settings-root"></div><div id="dialog-root"></div><div class="toast" id="toast" role="status" aria-live="polite" hidden></div><div class="sr-only" id="announcer" role="status" aria-live="polite"></div>`;
    this.canvas=this.$('#arena');this.reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.bindEvents();this.syncConfig();this.updateSummary();this.renderOverlay();this.startLoop();this.updateOfflineStatus();
  }
  disconnectedCallback(){
    this.abort?.abort();cancelAnimationFrame(this.frame);clearTimeout(this.toastTimer);clearTimeout(this.lockTimer);this.lockPending=false;this.releaseLock();this.graphics?.dispose(true);this.audio?.close().catch(()=>{});this.mounted=false;
  }
  $(selector){return this.shadowRoot.querySelector(selector);}
  $$(selector){return[...this.shadowRoot.querySelectorAll(selector)];}
  ensureGraphics(){
    if(this.graphics||this.graphicsLoading||this.graphicsError||this.config.mode==='reaction')return;
    this.graphicsLoading=true;
    import('./renderer.js').then(async({ArenaRenderer})=>{
      if(!this.mounted||this.config.mode==='reaction')return;
      const graphics=new ArenaRenderer(this.canvas);this.graphics=graphics;
      await graphics.ready;
      if(this.graphics!==graphics||!this.mounted)return;
    }).catch(error=>{if(this.mounted&&this.config.mode!=='reaction'){this.graphicsError=true;console.warn('3D renderer unavailable:',error.message);}}).finally(()=>{this.graphicsLoading=false;if(this.mounted){this.ensureGraphics();this.renderOverlay();}});
  }
  reactionInput(){
    if(this.config.mode!=='reaction'||this.engine.state!=='running'||this.settingsOpen)return;
    this.engine.shoot();this.updateReactionSurface();this.updateHUD();
  }
  updateReactionSurface(){
    if(this.config.mode!=='reaction')return;
    const e=this.engine,feedback=e.elapsedMs<e.feedbackUntil,ready=e.reactionPhase==='ready';
    const phase=e.state!=='running'?'idle':ready?'ready':feedback?(e.lastFeedback.includes('抢跑')?'early':'result'):'waiting';
    const key=`${phase}:${feedback?e.lastFeedback:''}`;if(key===this.reactionUI)return;this.reactionUI=key;
    this.$('#reaction-surface').dataset.phase=phase;
    this.$('#reaction-surface').setAttribute('aria-hidden',String(e.state!=='running'));
    this.$('#reaction-message').textContent=phase==='ready'?'点击！':phase==='early'?'太快了':phase==='result'?e.lastFeedback:'等待变绿';
    this.$('#reaction-detail').textContent=phase==='early'?'提前点击不计入成绩':phase==='result'?'准备下一次':phase==='ready'?'现在点击任意位置':'变绿后立即点击';
    this.$('.reaction-symbol').textContent=phase==='ready'?'!':phase==='early'?'×':phase==='result'?'✓':'···';
  }
  settingsHTML(){
    const range=(label,key,min,max,step,value)=>`<label class="setting-label" for="${key}">${label}<output id="${key}-value">${value}</output></label><input id="${key}" class="input-range" type="range" min="${min}" max="${max}" step="${step}" data-setting="${key}" aria-label="${label}">`;
    return `<aside class="config-panel" id="config-panel" aria-label="训练配置"><div class="config-title"><h2>设置</h2><button class="icon-button settings-close" data-action="close-settings" aria-label="关闭设置">${icon('close',18)}</button></div><div class="config-tabs"><button data-config-tab="aim" class="active">瞄准</button><button data-config-tab="crosshair">准星</button></div>
      <div id="aim-settings"><div class="control-group"><label class="setting-label">时长</label><div class="segmented">${[30,60,90].map(v=>`<button data-duration="${v}">${v} 秒</button>`).join('')}</div></div>
      <div class="control-group"><label class="setting-label">难度</label><div class="segmented">${Object.entries(DIFFICULTIES).map(([key,value])=>`<button data-difficulty="${key}">${value.label}</button>`).join('')}</div></div>
      <div class="control-group"><label class="setting-label" for="sensitivity">灵敏度<input id="sensitivity-number" data-setting="sensitivity" type="number" min="0.1" max="5" step="0.01" aria-label="灵敏度数值"></label><input id="sensitivity" class="input-range" type="range" min="0.1" max="5" step="0.01" data-setting="sensitivity" aria-label="鼠标灵敏度"><span class="setting-hint" id="sensitivity-hint">0.022° × 灵敏度 / 鼠标计数</span></div>
      <div class="control-group">${range('视野','fov',50,100,1,'64°')}</div><div class="control-group"><label class="setting-label" for="graphicsQuality">画面</label><select id="graphicsQuality" data-setting="graphicsQuality"><option value="performance">流畅</option><option value="detail">细节</option></select></div>
      <label class="check-row"><span>射击音效</span><input id="sound-toggle" data-setting="sound" type="checkbox"></label><button class="text-button reset-aim" data-action="reset-aim">恢复瞄准默认值</button></div>
      <div id="crosshair-settings" hidden><div class="crosshair-preview" aria-label="准星预览">${crosshairHTML()}</div><div class="control-group"><label class="setting-label" for="crosshairStyle">样式</label><select id="crosshairStyle" data-setting="crosshairStyle"><option value="cross">十字</option><option value="t">T 形</option><option value="dot">圆点</option></select></div>
      <div class="control-group color-row"><label for="crosshair">颜色</label><input id="crosshair" type="color" data-setting="crosshair" aria-label="准星颜色"><button class="color-preset" data-color="#92ff60" style="--color:#92ff60" aria-label="绿色准星"></button><button class="color-preset" data-color="#ffffff" style="--color:#ffffff" aria-label="白色准星"></button><button class="color-preset" data-color="#58eaff" style="--color:#58eaff" aria-label="青色准星"></button></div>
      <div class="control-group">${range('长度','crosshairLength',1,20,1,7)}</div><div class="control-group">${range('间距','crosshairGap',0,15,1,4)}</div><div class="control-group">${range('粗细','crosshairThickness',1,6,1,2)}</div><div class="control-group">${range('不透明度','crosshairOpacity',.2,1,.05,'100%')}</div>
      <label class="check-row"><span>中心点</span><input id="crosshairDot" data-setting="crosshairDot" type="checkbox"></label><label class="check-row"><span>轮廓</span><input id="crosshairOutline" data-setting="crosshairOutline" type="checkbox"></label><button class="text-button" data-action="reset-crosshair">恢复默认准星</button></div></aside>`;
  }
  bindEvents(){
    const options={signal:this.abort.signal};
    this.$('#reaction-surface').addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();this.$('#reaction-surface').focus({preventScroll:true});this.reactionInput();},options);
    this.$('#reaction-surface').addEventListener('keydown',event=>{if(!['Space','Enter'].includes(event.code))return;event.preventDefault();event.stopPropagation();if(!event.repeat)this.reactionInput();},options);
    this.shadowRoot.addEventListener('click',event=>{
      const b=event.target.closest('button');if(!b||b.disabled)return;
      if(b.dataset.view)return this.navigate(b.dataset.view);
      if(b.dataset.mode)return this.changeConfig({mode:b.dataset.mode});
      if(b.dataset.duration)return this.changeConfig({duration:Number(b.dataset.duration)});
      if(b.dataset.difficulty)return this.changeConfig({difficulty:b.dataset.difficulty});
      if(b.dataset.color)return this.changeConfig({crosshair:b.dataset.color});
      if(b.dataset.configTab){this.configTab=b.dataset.configTab;this.syncConfigTab();return;}
      if(b.dataset.filter){this.filter=b.dataset.filter;this.pageSize=20;this.renderHistory();return;}
      this.handleAction(b.dataset.action);
    },options);
    const setting=event=>{
      const element=event.target,key=element.dataset.setting;if(!key)return;
      if(element.type==='number'&&element.value==='')return;
      const value=element.type==='checkbox'?element.checked:['range','number'].includes(element.type)?Number(element.value):element.value;
      this.changeConfig({[key]:value});
    };
    this.shadowRoot.addEventListener('input',event=>{if(event.target.type!=='number')setting(event);},options);
    this.shadowRoot.addEventListener('change',event=>{if(event.target.tagName==='SELECT'||event.target.type==='number')setting(event);},options);
    this.canvas.addEventListener('pointerdown',event=>{
      if(event.button!==0||this.engine.state!=='running'||this.settingsOpen)return;event.preventDefault();
      if(!this.hasLock())return;
      const shot=this.engine.shoot();if(shot){this.graphics?.fire();if(shot.type!=='early')this.beep(shot.type==='hit');}
      this.updateHUD();
    },options);
    this.canvas.addEventListener('contextmenu',event=>event.preventDefault(),options);
    document.addEventListener('mousemove',event=>{
      if(!['running','countdown'].includes(this.engine.state))return;
      if(this.hasLock())this.engine.relativeMove(event.movementX,event.movementY);
    },options);
    document.addEventListener('pointerlockchange',()=>{
      if(this.hasLock()){
        if(this.lockPending){clearTimeout(this.lockTimer);this.lockPending=false;this.launchSession();}
        else if(!['running','countdown'].includes(this.engine.state))this.releaseLock();
      }else if(this.engine.config.input==='locked')this.pause();
    },options);
    document.addEventListener('pointerlockerror',()=>{if(this.lockPending&&!this.lockPromise)this.lockFailed();},options);
    document.addEventListener('fullscreenchange',()=>{if(this.nativeFullscreen&&document.fullscreenElement!==this){this.nativeFullscreen=false;this.setExpanded(false);this.pause();}},options);
    document.addEventListener('keydown',event=>this.keydown(event),options);
    window.addEventListener('blur',()=>this.pause(),options);document.addEventListener('visibilitychange',()=>{if(document.hidden)this.pause();},options);
    window.addEventListener('resize',()=>this.pause(),options);
    this.canvas.addEventListener('arena-context-lost',()=>{this.pause();this.graphicsError=true;this.renderOverlay();this.toast('图形上下文已丢失，请刷新页面。');},options);
    window.addEventListener('vector-offline-ready',()=>this.updateOfflineStatus(),options);window.addEventListener('online',()=>this.updateOfflineStatus(),options);window.addEventListener('offline',()=>this.updateOfflineStatus(),options);
    window.addEventListener('beforeunload',event=>{if(activeStates.includes(this.engine.state)){event.preventDefault();event.returnValue='';}},options);
  }
  handleAction(action){
    if(['start','resume','retry'].includes(action))this.requestStart();
    else if(action==='pause')this.pause();
    else if(action==='settings')this.openSettings();
    else if(action==='close-settings')this.closeSettings();
    else if(action==='abandon')this.exitTraining();
    else if(action==='reset')this.resetSession();
    else if(action==='fullscreen')this.fullscreen();
    else if(action==='reset-crosshair')this.changeConfig({crosshair:'#92ff60',crosshairLength:7,crosshairGap:4,crosshairThickness:2,crosshairOpacity:1,crosshairDot:false,crosshairOutline:true,crosshairStyle:'cross'});
    else if(action==='reset-aim')this.changeConfig({sensitivity:1,fov:64});
    else if(action==='export')this.exportRecords();
    else if(action==='clear')this.confirm('清除训练记录？','删除本机全部成绩，设置保留。',()=>{if(this.store.clear()){this.updateSummary();this.renderHistory();this.toast('记录已清除');}},'清除');
    else if(action==='more'){this.pageSize+=20;this.renderHistory();}
    else if(action==='confirm-cancel')this.closeDialog();
    else if(action==='confirm-ok'){const callback=this.dialogCallback;this.closeDialog();callback?.();}
    else if(action==='reload'){this.resetSession();location.reload();}
  }
  keydown(event){
    if(!this.isConnected)return;
    const ownsFocus=this.shadowRoot.activeElement||this.hasLock();if(!ownsFocus&&this.hasAttribute('embedded'))return;
    if(this.$('.dialog-backdrop')){if(event.key==='Escape'){event.preventDefault();this.closeDialog();}this.trapTab(event,this.$('.dialog'));return;}
    if(this.settingsOpen){if(event.key==='Escape'){event.preventDefault();this.closeSettings();}this.trapTab(event,this.$('#settings-root'));return;}
    // Escape must work even if a slider, select or number input has focus.
    if(event.key==='Escape'){event.preventDefault();if(this.lockPending||activeStates.includes(this.engine.state))this.pause();else if(this.expanded)this.exitExpanded();return;}
    if(event.key==='Tab'&&this.view==='practice'&&this.config.mode!=='reaction'&&['running','countdown','paused'].includes(this.engine.state)){event.preventDefault();this.openSettings();return;}
    if(['INPUT','SELECT','TEXTAREA'].includes(this.shadowRoot.activeElement?.tagName))return;
    if(event.code==='KeyF'&&this.view==='practice'){event.preventDefault();this.fullscreen();}
    if(event.code==='Space'&&this.view==='practice'&&this.shadowRoot.activeElement?.tagName!=='BUTTON'){event.preventDefault();if(['running','countdown'].includes(this.engine.state))this.pause();else this.requestStart();}
  }
  trapTab(event,root){if(event.key!=='Tab')return;const nodes=[...root.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')].filter(n=>n.getClientRects().length),first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&this.shadowRoot.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&this.shadowRoot.activeElement===last){event.preventDefault();first?.focus();}}
  changeConfig(patch){
    if(this.lockPending)return;
    const current=this.engine.state,active=activeStates.includes(current),keys=Object.keys(patch);
    if(active&&keys.some(key=>['mode','duration','difficulty'].includes(key))){this.syncConfig();return;}
    if(['running','countdown'].includes(current))this.pause();
    const next=normalizeConfig({...this.config,...patch});
    if(active&&this.engine.elapsedMs>0&&['sensitivity','fov'].some(key=>key in patch&&next[key]!==this.config[key]))this.engine.parametersChanged=true;
    this.config=next;
    if(active)this.engine.config={...next};else{this.engine.reset();this.engine.config={...next};this.lastResult=null;}
    this.store.saveSettings(next);this.syncConfig();this.renderOverlay();this.updateHUD();
  }
  syncConfig(){
    const busy=activeStates.includes(this.engine.state)||this.lockPending;
    const reaction=this.config.mode==='reaction';
    this.$('#arena-wrap').classList.toggle('reaction-mode',reaction);
    this.$('#arena-wrap').setAttribute('aria-label',reaction?'反应速度测试':'3D 瞄准训练');
    this.$('#reaction-surface').hidden=!reaction;
    this.$('#reaction-surface').disabled=!reaction||this.engine.state!=='running';
    this.canvas.hidden=reaction;
    this.$('#config-dock').classList.toggle('reaction-config',reaction);
    for(const button of this.$$('[data-config-tab]'))button.hidden=reaction;
    for(const group of this.$$('#aim-settings > .control-group'))group.hidden=reaction&&!group.querySelector('[data-duration]');
    this.$('#sound-toggle').closest('label').hidden=reaction;
    this.$('.reset-aim').hidden=reaction;
    if(reaction){this.releaseLock();this.graphics?.dispose();this.graphics=null;this.configTab='aim';}
    else this.ensureGraphics();
    if(this.view==='practice')this.$('#page-title').textContent=reaction?'反应测试':'瞄准训练';
    for(const b of this.$$('[data-duration]')){b.classList.toggle('selected',Number(b.dataset.duration)===this.config.duration);b.disabled=busy;}
    for(const b of this.$$('[data-difficulty]')){b.classList.toggle('selected',b.dataset.difficulty===this.config.difficulty);b.disabled=busy||this.config.mode==='reaction';}
    for(const b of this.$$('[data-mode]')){const selected=b.dataset.mode===this.config.mode;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));b.disabled=busy;}
    for(const node of this.$$('[data-setting]')){const key=node.dataset.setting;if(node.type==='number'&&this.shadowRoot.activeElement===node)continue;if(node.type==='checkbox')node.checked=this.config[key];else node.value=this.config[key];}
    this.$('#sensitivity-hint').textContent='0.022° × 灵敏度 / 鼠标计数';
    for(const key of ['fov','crosshairLength','crosshairGap','crosshairThickness','crosshairOpacity'])this.$(`#${key}-value`).textContent=key==='fov'?`${this.config[key]}°`:key==='crosshairOpacity'?`${Math.round(this.config[key]*100)}%`:this.config[key];
    const mode=modeById(this.config.mode);this.$('#arena-title').textContent=mode.name;this.$('#arena-english').textContent=mode.english;
    this.$('#pause-button').disabled=!activeStates.includes(this.engine.state);
    this.$('#abandon-button').disabled=!activeStates.includes(this.engine.state)&&!this.expanded;
    this.$('#arena-wrap').classList.toggle('playing',['running','countdown'].includes(this.engine.state));
    this.syncConfigTab();this.updateCrosshair();
  }
  syncConfigTab(){for(const b of this.$$('[data-config-tab]'))b.classList.toggle('active',b.dataset.configTab===this.configTab);this.$('#aim-settings').hidden=this.configTab!=='aim';this.$('#crosshair-settings').hidden=this.configTab!=='crosshair';}
  updateCrosshair(){
    const c=this.config;
    for(const node of this.$$('.crosshair')){
      node.style.setProperty('--hair-color',c.crosshair);node.style.setProperty('--hair-length',`${c.crosshairLength}px`);node.style.setProperty('--hair-gap',`${c.crosshairGap}px`);node.style.setProperty('--hair-width',`${c.crosshairThickness}px`);node.style.opacity=c.crosshairOpacity;
      node.classList.toggle('has-dot',c.crosshairDot||c.crosshairStyle==='dot');node.classList.toggle('outlined',c.crosshairOutline);node.classList.toggle('t-style',c.crosshairStyle==='t');node.classList.toggle('dot-style',c.crosshairStyle==='dot');
    }
    this.$('#aim-layer').hidden=this.config.mode==='reaction'||!['countdown','running'].includes(this.engine.state);
  }
  hasLock(){return this.shadowRoot.pointerLockElement===this.canvas||document.pointerLockElement===this.canvas;}
  releaseLock(){if(this.hasLock())document.exitPointerLock?.();}
  requestStart(){
    if((this.config.mode!=='reaction'&&(this.graphicsError||!this.graphics||this.graphicsLoading))||this.lockPending||['running','countdown'].includes(this.engine.state))return;
    this.closeSettings();this.initAudio();
    if(this.config.mode==='reaction'){this.launchSession();return;}
    if(!this.canvas.requestPointerLock){this.lockFailed(true);return;}
    this.lockPending=true;this.syncConfig();this.renderOverlay();
    const request=raw=>{
      try{const promise=this.canvas.requestPointerLock(raw?{unadjustedMovement:true}:undefined);this.lockPromise=!!promise?.catch;
        if(promise?.catch)promise.catch(()=>{if(!this.lockPending)return;if(raw)request(false);else this.lockFailed();});
      }catch{if(raw)request(false);else this.lockFailed();}
    };
    request(true);this.lockTimer=setTimeout(()=>{if(this.lockPending)this.lockFailed();},2500);
  }
  lockFailed(force=false){
    if(!this.lockPending&&!force)return;clearTimeout(this.lockTimer);this.lockPending=false;
    this.syncConfig();this.renderOverlay();this.toast('鼠标锁定未成功，请点击开始重试。');
  }
  launchSession(){this.lockPending=false;if(this.engine.state==='paused')this.engine.resume();else{this.lastResult=null;this.engine.start(this.config);}this.lastState='';this.syncConfig();this.renderOverlay();if(this.config.mode!=='reaction')this.canvas.focus({preventScroll:true});}
  pause(){
    if(this.lockPending){this.lockPending=false;clearTimeout(this.lockTimer);this.releaseLock();this.syncConfig();this.renderOverlay();return;}
    if(!['running','countdown'].includes(this.engine?.state))return;
    this.engine.pause();this.releaseLock();this.syncConfig();this.renderOverlay();this.announce('已暂停');
  }
  resetSession(){clearTimeout(this.lockTimer);this.lockPending=false;this.releaseLock();this.engine.reset();this.engine.config={...this.config};this.lastResult=null;this.lastState='';this.syncConfig();this.renderOverlay();this.updateHUD();}
  exitTraining(){this.closeSettings();this.closeDialog();this.resetSession();this.exitExpanded();this.$('[data-action="start"]')?.focus({preventScroll:true});}
  openSettings(){
    if(this.settingsOpen)return;this.pause();this.restoreSettingsFocus=this.shadowRoot.activeElement;this.settingsOpen=true;
    this.$('#settings-root').innerHTML='<div class="settings-backdrop"></div><div class="settings-drawer" role="dialog" aria-modal="true" aria-label="训练设置"></div>';
    this.$('.settings-drawer').appendChild(this.$('#config-panel'));this.$('.shell').inert=true;this.$('.settings-close').focus({preventScroll:true});
  }
  closeSettings(){if(!this.settingsOpen)return;this.$('#config-dock').appendChild(this.$('#config-panel'));this.$('#settings-root').innerHTML='';this.settingsOpen=false;this.$('.shell').inert=false;if(this.restoreSettingsFocus?.isConnected)this.restoreSettingsFocus.focus({preventScroll:true});}
  setExpanded(value){this.expanded=value;this.toggleAttribute('expanded',value);this.$('#expand-label').textContent=value?'还原':'大屏';this.$('[data-action="fullscreen"]').setAttribute('aria-pressed',String(value));this.$('#abandon-button').disabled=!activeStates.includes(this.engine.state)&&!value;}
  async fullscreen(){
    this.pause();if(this.expanded){await this.exitExpanded();return;}
    this.setExpanded(true);
    try{if(this.requestFullscreen&&document.fullscreenEnabled){await this.requestFullscreen();this.nativeFullscreen=document.fullscreenElement===this;}else this.toast('已启用窗口大屏');}catch{this.toast('已启用窗口大屏');}
  }
  async exitExpanded(){this.setExpanded(false);if(document.fullscreenElement===this)try{await document.exitFullscreen();}catch{}this.nativeFullscreen=false;}
  startLoop(){
    const loop=time=>{if(!this.mounted)return;this.engine.tick(time);
      if(this.view==='practice'&&this.config.mode!=='reaction'&&!this.graphicsError)this.graphics?.render(this.engine,time,this.reducedMotion);
      this.updateReactionSurface();
      if(time-this.lastUI>90){this.updateHUD();this.lastUI=time;}
      const key=this.engine.state==='countdown'?`countdown-${Math.max(1,Math.ceil((3000-this.engine.countdownMs)/1000))}`:this.engine.state;
      if(this.lastState!==key){this.lastState=key;this.syncConfig();this.renderOverlay();if(this.config.mode==='reaction'&&this.engine.state==='running')this.$('#reaction-surface').focus({preventScroll:true});}
      this.frame=requestAnimationFrame(loop);
    };this.frame=requestAnimationFrame(loop);
  }
  updateHUD(){
    const m=this.engine.metrics(),mode=this.config.mode;
    this.$('#hud-time').textContent=Math.max(0,this.config.duration-this.engine.elapsedMs/1000).toFixed(1);
    this.$('#hud-primary-label').textContent=mode==='reaction'?'反应':mode==='tracking'?'在靶':'得分';
    this.$('#hud-score').textContent=mode==='reaction'?number(m.reactionMs):mode==='tracking'?percent(m.trackingRatio):number(m.score);this.$('#hud-score-unit').textContent=mode==='reaction'?'ms':'';
    this.$('#hud-accuracy-label').textContent=mode==='reaction'?'抢跑':mode==='tracking'?'在靶时间':'命中率';this.$('#hud-accuracy').textContent=mode==='reaction'?number(m.falseStarts):mode==='tracking'?`${(m.trackedMs/1000).toFixed(1)}s`:percent(m.accuracy);
    this.$('#hud-fps').textContent=`${this.graphics?.fps||'—'} FPS`;
    this.$('#hud-hits-label').textContent=mode==='reaction'?'有效试次':'命中';this.$('#hud-hits').textContent=mode==='tracking'?'—':number(m.hits);
  }
  renderOverlay(){
    const node=this.$('#arena-overlay'),mode=modeById(this.config.mode);this.updateCrosshair();
    this.lastState=this.engine.state==='countdown'?`countdown-${Math.max(1,Math.ceil((3000-this.engine.countdownMs)/1000))}`:this.engine.state;
    if(this.config.mode!=='reaction'&&this.graphicsError){node.innerHTML='<div class="stage-menu"><h2>3D 图形不可用</h2><p>请开启浏览器硬件加速，或使用 Chrome / Edge。</p><button class="primary" data-action="reload">重新加载</button></div>';return;}
    if(this.config.mode!=='reaction'&&(!this.graphics||this.graphicsLoading)){node.innerHTML='<div class="stage-menu"><h2>加载训练场</h2></div>';return;}
    if(this.lockPending){node.innerHTML='<div class="stage-menu"><h2>正在获取鼠标</h2><button class="secondary" data-action="pause">取消</button></div>';return;}
    if(this.engine.state==='running'){node.innerHTML='';return;}
    if(this.engine.state==='countdown'){node.innerHTML=`<div class="countdown-number">${Math.max(1,Math.ceil((3000-this.engine.countdownMs)/1000))}</div>`;return;}
    if(this.engine.state==='paused'){node.innerHTML=`<div class="stage-menu pause-menu"><span class="menu-kicker">${mode.english}</span><h2>已暂停</h2><button class="primary" data-action="resume">继续训练</button><button class="secondary" data-action="settings">设置</button><button class="text-button exit-button" data-action="abandon">退出训练</button></div>`;return;}
    if(this.engine.state==='finished'&&this.lastResult){this.renderResult();return;}
    const best=this.store.best(this.config);
    node.innerHTML=`<div class="stage-menu start-card"><span class="menu-kicker">${mode.english}</span><h2>${mode.name}</h2><p>${this.config.mode==='reaction'?'变绿后点击 · 提前点击算抢跑':`${this.config.duration} 秒 / ${DIFFICULTIES[this.config.difficulty].label}`}</p><button class="primary" data-action="start">${this.config.mode==='reaction'?'开始测试':'开始训练'} ${icon('arrow',16)}</button>${best?`<small>个人最佳 ${this.metricText(best)}</small>`:''}</div>`;
  }
  complete(result){
    const best=this.store.best(result.config);this.newBest=!result.parametersChanged&&isBetter(result.config.mode,primaryMetric(result),best?primaryMetric(best):null);
    const session={...result,id:newSessionId(),completedAt:new Date().toISOString(),syncStatus:'local'};this.saved=this.store.save(session);this.lastResult=session;this.releaseLock();this.updateSummary();this.syncConfig();this.renderOverlay();
    this.dispatchEvent(new CustomEvent('training-complete',{detail:structuredClone(session),bubbles:true,composed:true}));this.announce('训练完成');requestAnimationFrame(()=>this.$('[data-action="retry"]')?.focus({preventScroll:true}));
  }
  metricText(session){const value=primaryMetric(session);return value==null?'—':session.config.mode==='reaction'?`${number(value)} ms`:session.config.mode==='tracking'?`${value.toFixed(1)}%`:`${number(value)} 分`;}
  renderResult(){
    const s=this.lastResult,m=s.metrics,mode=s.config.mode;
    const cells=mode==='reaction'?[['有效试次',m.hits],['抢跑',m.falseStarts],['最快',m.reactionSamples.length?`${number(Math.min(...m.reactionSamples))} ms`:'—']]:mode==='tracking'?[['在靶时间',`${(m.trackedMs/1000).toFixed(1)}s`],['时长',`${s.config.duration}s`],['难度',DIFFICULTIES[s.config.difficulty].label]]:[['命中率',percent(m.accuracy)],['命中 / 射击',`${m.hits} / ${m.shots}`],['命中 / 分钟',number(m.hitsPerMinute)]];
    this.$('#arena-overlay').innerHTML=`<div class="stage-menu result-card"><span class="menu-kicker">训练完成</span><div class="result-primary">${this.metricText(s)}</div><small>${s.parametersChanged?'本轮调整过参数，不计个人最佳':this.newBest?'个人最佳':''}${this.saved?' · 已保存':' · 暂存本页'}</small><div class="result-grid">${cells.map(([label,value])=>`<div><span>${label}</span><strong>${value}</strong></div>`).join('')}</div><button class="primary" data-action="retry">再练一次</button><button class="secondary" data-view="history">查看记录</button><button class="text-button" data-action="reset">返回设置</button></div>`;
  }
  updateSummary(){const list=this.store.sessions,minutes=list.reduce((sum,s)=>sum+s.durationMs,0)/60000;this.$('#hero-stats').textContent=`${list.length} 轮 / ${minutes.toFixed(1)} 分钟`;}
  navigate(view){
    if(!['practice','history','guide'].includes(view))return;this.closeSettings();if(view!=='practice'){this.pause();this.exitExpanded();}this.view=view;
    this.$('#page-title').textContent={practice:this.config.mode==='reaction'?'反应测试':'瞄准训练',history:'训练记录',guide:'操作说明'}[view];for(const v of['practice','history','guide'])this.$(`#${v}-view`).hidden=v!==view;
    for(const b of this.$$('.nav [data-view]')){b.classList.toggle('active',b.dataset.view===view);if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}if(view==='history')this.renderHistory();
  }
  renderHistory(){
    const all=this.store.sessions,filtered=all.filter(s=>this.filter==='all'||s.config.mode===this.filter),rows=filtered.slice(0,this.pageSize),reference=filtered.find(s=>!s.parametersChanged);
    const series=reference?filtered.filter(s=>!s.parametersChanged&&comparisonKey(s.config)===comparisonKey(reference.config)&&primaryMetric(s)!=null).slice(0,20).reverse():[];
    const description=reference?`${modeById(reference.config.mode).name} / ${reference.config.duration}s / ${inputLabel(reference.config)} / ${ruleLabel(reference.config)}`:'暂无数据';
    this.$('#history-view').innerHTML=`<div class="history-tools"><div class="filter-tabs"><button data-filter="all" class="${this.filter==='all'?'selected':''}">全部</button>${MODES.map(mode=>`<button data-filter="${mode.id}" class="${this.filter===mode.id?'selected':''}">${mode.name}</button>`).join('')}</div><div class="button-group"><button class="secondary" data-action="export" ${all.length?'':'disabled'}>${icon('download',15)} 导出</button><button class="secondary" data-action="clear" ${all.length?'':'disabled'} aria-label="清除全部训练记录">${icon('trash',15)}</button></div></div><section class="chart-panel"><h2>同参数趋势</h2><p class="muted">${description}</p>${this.trendSVG(series)}</section><section class="records-panel">${rows.length?`<div class="table-wrap"><table><thead><tr><th>时间</th><th>模式</th><th>设置</th><th>成绩</th><th>命中率</th></tr></thead><tbody>${rows.map(s=>`<tr><td>${dateFormat.format(new Date(s.completedAt))}</td><td>${modeById(s.config.mode).name}</td><td>${s.config.duration}s / ${inputLabel(s.config)}${s.parametersChanged?' / 已调整参数':''}${s.config.rulesVersion===2||s.config.mode==='reaction'&&s.config.rulesVersion>=3?'':' / 旧版'}</td><td><strong>${this.metricText(s)}</strong></td><td>${percent(s.metrics.accuracy)}</td></tr>`).join('')}</tbody></table></div>${filtered.length>rows.length?'<button class="secondary" data-action="more">加载更多</button>':''}`:'<div class="empty-state"><h2>暂无训练记录</h2><button class="primary" data-view="practice">开始训练</button></div>'}</section>`;
  }
  trendSVG(series){
    if(!series.length)return'<div class="chart-empty">完成训练后显示成绩</div>';
    const values=series.map(primaryMetric),min=Math.min(...values),max=Math.max(...values),spread=Math.max(1,max-min),low=Math.max(0,min-spread*.2),high=max+spread*.2;
    const x=i=>50+(series.length===1?400:i/(series.length-1)*800),y=v=>130-(v-low)/(high-low)*100,axis=v=>series[0].config.mode==='tracking'?`${v.toFixed(1)}%`:number(v),path=values.map((v,i)=>`${i?'L':'M'}${x(i)},${y(v)}`).join(' ');
    return`<svg class="trend-chart" viewBox="0 0 900 160" role="img" aria-label="同参数成绩趋势"><path d="M50 25H860M50 78H860M50 132H860" stroke="#ffffff15" fill="none"/><text x="4" y="29" fill="#a9b1ac" font-size="10">${axis(high)}</text><text x="4" y="136" fill="#a9b1ac" font-size="10">${axis(low)}</text><path d="${path}" fill="none" stroke="#d6c58a" stroke-width="2"/>${values.map((v,i)=>`<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="#d6c58a"><title>${this.metricText(series[i])}</title></circle>`).join('')}</svg>`;
  }
  guideHTML(){return`<div class="guide-grid"><section class="guide-panel"><h2>操作</h2><dl><dt>鼠标</dt><dd>第一人称转向，左键射击</dd><dt>Esc / 空格</dt><dd>暂停并释放鼠标</dd><dt>Tab</dt><dd>暂停并打开设置</dd><dt>F / 大屏</dt><dd>切换大屏；浏览器限制时使用窗口大屏</dd></dl><p>暂停后可继续、调整准星与灵敏度，或直接退出。未完成的训练不保存。</p></section><section class="guide-panel"><h2>训练模式</h2><ul><li>网格点射：切换三个靶球。</li><li>反应测试：等待色块变绿后点击，提前点击算抢跑。可用空格或回车响应。</li><li>大幅甩枪：命中远距离出现的靶球。</li><li>精准微调：命中较小靶球。</li><li>平滑跟枪：准星跟随靶球，无需开火。</li></ul></section><section class="guide-panel"><h2>准星与灵敏度</h2><p>设置 → 准星：调整样式、颜色、长度、间距、粗细、中心点与轮廓。</p><p>第一人称使用 0.022° × 灵敏度 / 鼠标计数，不随窗口尺寸变化。浏览器输入不是 CS2 的完整灵敏度校准。</p><p>训练中调整灵敏度或视野会标记本轮，不加入个人最佳比较。</p></section><section class="guide-panel"><h2>成绩与数据</h2><p>点射分数 = 命中数 × 100 × 命中率；反应看平均毫秒，跟枪看在靶时长占比。</p><p>成绩仅存本机，最多 500 轮。可导出或清除。显示“离线就绪”后可断网刷新。</p></section></div>`;}
  initAudio(){if(!this.config.sound)return;try{const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;this.audio??=new Audio();if(this.audio.state==='suspended')this.audio.resume().catch(()=>{});}catch{}}
  beep(hit){if(this.config.sound&&this.audio)playFeedback(this.audio,hit);}
  confirm(title,message,callback,label='确认'){this.restoreFocus=this.shadowRoot.activeElement;this.dialogCallback=callback;this.$('#dialog-root').innerHTML=`<div class="dialog-backdrop"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><h2 id="dialog-title">${escapeHTML(title)}</h2><p>${escapeHTML(message)}</p><div class="button-group"><button class="secondary" data-action="confirm-cancel">取消</button><button class="primary" data-action="confirm-ok">${escapeHTML(label)}</button></div></div></div>`;this.$('.shell').inert=true;this.$('[data-action="confirm-cancel"]').focus();}
  closeDialog(){this.$('#dialog-root').innerHTML='';this.$('.shell').inert=this.settingsOpen;this.dialogCallback=null;if(this.restoreFocus?.isConnected)this.restoreFocus.focus({preventScroll:true});}
  toast(message){const node=this.$('#toast');if(!node)return;node.textContent=message;node.hidden=false;clearTimeout(this.toastTimer);this.toastTimer=setTimeout(()=>{node.hidden=true;},4500);}
  announce(message){this.$('#announcer').textContent=message;}
  exportRecords(){const url=URL.createObjectURL(new Blob([this.store.exportJSON()],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`vector-training-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  exportSessions(){return structuredClone(this.store.sessions);}
  updateOfflineStatus(){this.$('#offline-status').textContent=window.vectorOfflineReady?(navigator.onLine?'离线就绪':'离线训练'):'本地成绩';}
}
if(!customElements.get('vector-trainer'))customElements.define('vector-trainer',VectorTrainer);
export function mountTrainer(container,{embedded=true,onComplete}={}){const element=document.createElement('vector-trainer');if(embedded)element.setAttribute('embedded','');if(onComplete)element.addEventListener('training-complete',event=>onComplete(event.detail));container.appendChild(element);return{element,destroy:()=>element.remove(),exportSessions:()=>element.exportSessions()};}
