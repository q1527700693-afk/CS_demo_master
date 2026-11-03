"""Generate standalone HTML pages for importing into a prototype tool."""
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "pages"
OUT.mkdir(exist_ok=True)

CSS = """
*{box-sizing:border-box}html{background:#080a0b}body{margin:0;background:#080a0b;color:#f4f4f2;font:14px/1.6 'Microsoft YaHei',Arial,sans-serif}a{color:inherit;text-decoration:none}button,input,select{font:inherit}button,.button{cursor:pointer;border:1px solid #30383e;border-radius:6px;background:#23282c;color:#fff;padding:10px 16px}button:hover,.button:hover{border-color:#ee9b5a}.primary{background:#ec9c60;border-color:#ec9c60;color:#171511;font-weight:700}.ghost{background:transparent}.small{font-size:12px}.muted{color:#9aabb6}.eyebrow{font-size:11px;letter-spacing:2px;color:#ef9b5b;font-weight:700}.shell{display:grid;grid-template-columns:236px minmax(0,1fr);min-height:100vh}.sidebar{background:#151719;border-right:1px solid #2b3034;padding:28px 20px;display:flex;flex-direction:column;gap:30px}.brand{font-size:20px;font-weight:900;letter-spacing:2px;line-height:1.15}.brand small{display:block;font-size:11px;letter-spacing:5px;color:#a4adb3}.brand b{color:#f0a063}.nav{display:grid;gap:8px}.nav a{padding:12px 14px;color:#afbac4;border-radius:5px}.nav a.active,.nav a:hover{color:#f1a060;background:#31251f}.sidebar-note{margin-top:auto;border-top:1px solid #333;padding-top:20px;color:#90a0a9;font-size:12px}.main{min-width:0}.top{height:72px;border-bottom:1px solid #252b30;display:flex;align-items:center;justify-content:space-between;padding:0 40px;color:#a8b5be}.content{max-width:1320px;margin:auto;padding:40px}.page-head{display:flex;align-items:end;justify-content:space-between;gap:24px;margin-bottom:28px}h1{font-size:36px;line-height:1.3;margin:8px 0 10px}h2{font-size:21px;margin:0 0 10px}h3{margin:0 0 8px;font-size:17px}p{margin:0 0 16px;color:#a5b3bd}.orange{color:#ef9d60}.grid{display:grid;gap:16px}.grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}.grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}.grid.four{grid-template-columns:repeat(4,minmax(0,1fr))}.panel,.card{background:#191d20;border:1px solid #30373b;border-radius:8px;padding:24px}.card{min-height:170px}.card:hover{border-color:#806046}.hero{background:radial-gradient(circle at 78% 40%,#233b40 0,#172125 24%,#191d20 52%);border:1px solid #344247;border-radius:10px;min-height:300px;padding:42px;display:flex;align-items:center;justify-content:space-between;overflow:hidden}.hero h2{font-size:39px;line-height:1.25}.radar{width:230px;height:230px;border:1px solid #7ba7a4;border-radius:50%;box-shadow:0 0 0 35px #85aaa611,0 0 0 70px #85aaa608;display:grid;place-items:center;color:#ed9b61;font-size:50px}.stat strong{font-size:29px;color:#eaf2f4}.section-title{margin:30px 0 16px;display:flex;justify-content:space-between;align-items:center}.row{display:flex;justify-content:space-between;gap:20px;align-items:center;padding:17px 0;border-bottom:1px solid #30373b}.row:last-child{border-bottom:0}.pill{display:inline-block;padding:3px 9px;border-radius:4px;background:#2c3837;color:#a5d0b9;font-size:12px}.tag{display:inline-block;padding:3px 8px;margin:3px 5px 3px 0;border:1px solid #3d4449;border-radius:3px;color:#b2bec7;font-size:12px}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}.field{display:grid;gap:7px;margin:15px 0;color:#c4d0d7}.field input,.field select{width:100%;border:1px solid #414a50;background:#101315;border-radius:5px;color:#fff;padding:12px}.tabs{display:flex;gap:24px;border-bottom:1px solid #363d42;margin:20px 0}.tabs a{padding:10px 0}.tabs .active{border-bottom:2px solid #ef9d60;color:#ef9d60}.chart{height:180px;display:flex;align-items:end;justify-content:space-around;gap:8px;border-bottom:1px solid #51606a;padding:15px 0}.bar{width:24px;background:#98c6bd;border-radius:3px 3px 0 0}.hint{padding:14px 18px;background:#1f2a26;border:1px solid #344c3f;border-radius:5px;color:#b3d0c1;margin-bottom:18px}.empty{border:1px dashed #47515a;border-radius:8px;padding:42px;text-align:center;color:#a9b6be}.footer{color:#687680;font-size:11px;letter-spacing:1px;margin:50px 0 0;border-top:1px solid #252b30;padding-top:18px}@media(max-width:860px){.shell{grid-template-columns:1fr}.sidebar{display:none}.top{padding:0 18px}.content{padding:24px 16px}.grid.two,.grid.three,.grid.four{grid-template-columns:1fr}.hero{padding:25px;min-height:250px}.hero h2{font-size:30px}.radar{display:none}.page-head{align-items:start;flex-direction:column}}
"""

CSS += """[hidden]{display:none!important}.tabs a{cursor:pointer}.actions button.selected,.tabs a.active{color:#ef9d60;border-color:#ef9d60}.overlay{position:fixed;inset:0;background:#000b;display:grid;place-items:center;padding:20px;z-index:10}.dialog{width:min(620px,100%);background:#1c2226;border:1px solid #526069;border-radius:10px;padding:28px;box-shadow:0 20px 70px #000a}.dialog .close{float:right}.notice{position:fixed;bottom:20px;right:20px;background:#263c32;border:1px solid #689077;border-radius:6px;padding:12px 18px;z-index:20;color:#e8f5eb}.empty{cursor:pointer}button:focus-visible,a:focus-visible,input:focus-visible{outline:2px solid #ef9d60;outline-offset:2px}"""

SCRIPT = r"""
(() => {
  const page = 'PAGE_NAME';
  const main = document.querySelector('main');
  function toast(message) {
    document.querySelector('.notice')?.remove();
    const el = document.createElement('div'); el.className = 'notice'; el.textContent = message;
    document.body.append(el); setTimeout(() => el.remove(), 3500);
  }
  function dialog(title, content, actions='') {
    document.querySelector('.overlay')?.remove();
    const el = document.createElement('div'); el.className='overlay';
    el.innerHTML = `<section class="dialog"><button class="close" type="button">关闭 ×</button><div class="eyebrow">CS DEMO MASTER / INTERACTION</div><h2>${title}</h2>${content}<div class="actions">${actions}</div></section>`;
    document.body.append(el);
    el.querySelector('.close').onclick = () => el.remove();
    el.onclick = e => { if (e.target === el) el.remove(); };
    return el;
  }
  if (page === 'upload') {
    const tabs = [...document.querySelectorAll('.tabs a')];
    const drop = document.querySelector('.empty');
    const input = document.createElement('input'); input.type='file'; input.accept='.zip'; input.hidden=true; drop.append(input);
    tabs.forEach((tab, i) => tab.onclick = () => {
      tabs.forEach(x => x.classList.remove('active')); tab.classList.add('active');
      drop.childNodes[1].textContent = i ? '点击选择分析 ZIP 文件' : '连接本地工具，或选择已生成的分析 ZIP';
      toast(i ? '已切换到手动上传' : '已切换到自动导入');
    });
    drop.onclick = () => input.click();
    input.onchange = () => { if(input.files?.[0]) toast(`已选择 ${input.files[0].name}；原型使用示例报告展示下一步`); };
    drop.ondragover = e => e.preventDefault();
    drop.ondrop = e => { e.preventDefault(); if(e.dataTransfer.files[0]) toast(`已选择 ${e.dataTransfer.files[0].name}；原型使用示例报告展示下一步`); };
  }
  if (page === 'training') {
    document.querySelectorAll('.card button').forEach(button => button.onclick = () => {
      const mode = button.closest('.card').querySelector('h3').textContent;
      const modal = dialog(mode, `<p>选择训练时长并开始一轮模拟训练。完整 3D 训练请在前端应用中体验。</p><label class="field">时长<select id="duration"><option>30 秒</option><option>60 秒</option></select></label>`, '<button class="primary" id="start-training">开始训练 →</button>');
      modal.querySelector('#start-training').onclick = () => {
        const duration = modal.querySelector('#duration').value;
        modal.querySelector('.dialog').innerHTML = `<button class="close">关闭 ×</button><div class="eyebrow">TRAINING / ${mode}</div><h2>训练完成</h2><p>${duration} · 示例成绩：命中率 82% · 得分 2,460</p><div class="actions"><button id="again">再来一轮</button><a class="button" href="profile.html">查看个人名片 →</a></div>`;
        modal.querySelector('.close').onclick=()=>modal.remove();
        modal.querySelector('#again').onclick=()=>{modal.remove();button.click();};
      };
    });
  }
  if (page === 'lobbies') {
    const cards = [...document.querySelectorAll('.grid.three .card')];
    const modes = ['竞技匹配','优先模式','搭档模式','竞技匹配','优先模式','搭档模式'];
    cards.forEach((card,i) => {card.dataset.mode=modes[i];card.querySelector('.eyebrow').firstChild.textContent=modes[i]+'　　';});
    document.querySelectorAll('.actions > button').forEach(button => {
      const label = button.textContent.trim();
      if (!['全部模式','竞技匹配','优先模式','搭档模式'].includes(label)) return;
      button.onclick = () => {
        document.querySelectorAll('.actions > button').forEach(x => x.classList.remove('selected'));
        button.classList.add('selected'); cards.forEach(c => c.hidden = label !== '全部模式' && c.dataset.mode !== label);
        toast(`正在查看${label}车队`);
      };
    });
    cards.forEach(card => {
      const title=card.querySelector('h3').textContent;
      const buttons=card.querySelectorAll('button');
      buttons[0].onclick=()=>{
        const detail=dialog(title, `<p>${card.dataset.mode} · Mirage · 华东</p><p>队长：Alice　当前 3/5 人；欢迎友好交流、练习配合。</p><div class="hint">流程：领取组队码 → 游戏内加入 → 队长发车</div>`, '<button id="claim" class="primary">领取组队码</button>');
        detail.querySelector('#claim').onclick=()=>{detail.remove();buttons[1].click();};
      };
      buttons[1].onclick=()=>{
        buttons[1].textContent='已领取组队码';
        dialog('组队码已领取', `<p>${title} · ${card.dataset.mode}</p><div class="panel"><strong style="font-size:25px;letter-spacing:5px">ABCD-1234</strong></div><p class="small">这是原型演示码。请在正式系统领取真实组队码。</p>`, '<button id="copy-code">复制演示码</button>');
        document.querySelector('#copy-code').onclick=()=>toast('演示码：ABCD-1234');
      };
    });
    document.querySelector('#create .primary').onclick=()=>{
      const title=document.querySelector('#create input').value.trim();
      if(!title){toast('请填写车队名称');return;}
      document.querySelector('#create').hidden=true;
      toast(`已发布「${title}」（原型演示）`);
    };
  }
  if (page === 'friends') {
    const search = document.querySelector('.panel > button');
    search.onclick = () => {
      const term=document.querySelector('.panel input').value.trim();
      const results=document.querySelector('#results'); results.hidden=false;
      results.querySelector('h3').textContent=term || 'Alice';
      toast(`找到玩家 ${term || 'Alice'}`);
    };
    document.querySelector('#results button').onclick = e => { e.target.textContent='申请已发送'; e.target.disabled=true; toast('好友申请已发送'); };
    document.querySelectorAll('a').forEach(a=>{
      if(a.textContent.includes('查看名片')) a.href='player.html';
    });
  }
  if (page === 'profile') {
    document.querySelector('.panel button.primary').onclick=()=>{
      const nickname=document.querySelector('.panel input').value.trim();
      if(!nickname){toast('昵称不能为空');return;}
      document.querySelector('.panel h2:nth-of-type(2)').textContent=nickname;
      toast('资料已保存（原型演示）');
    };
  }
  if (page === 'report') {
    const tabs=[...document.querySelectorAll('.tabs a')];
    const ids=['overview','rounds','utility','data'];
    const panels=ids.map(id=>document.getElementById(id));
    const container=panels[0].parentElement;
    container.style.gridTemplateColumns='minmax(0,1fr)';
    function showPanel(id) {
      const selected=ids.includes(id) ? id : 'overview';
      panels.forEach(panel=>panel.hidden=panel.id!==selected);
      tabs.forEach(tab=>tab.classList.toggle('active',tab.getAttribute('href')==='#'+selected));
    }
    tabs.forEach(tab=>tab.onclick=()=>showPanel(tab.hash.slice(1)));
    window.addEventListener('hashchange',()=>showPanel(location.hash.slice(1)));
    showPanel(location.hash.slice(1));
  }
})();
"""

PAGES = [
    ("index", "总览", "⌗"), ("login", "登录 / 注册", "→"),
    ("replays", "我的复盘", "▤"), ("upload", "新建复盘", "+"),
    ("report", "复盘报告", "▥"), ("training", "瞄准训练", "◎"),
    ("lobbies", "校园车队", "♧"), ("friends", "玩家与好友", "♙"),
    ("profile", "个人中心", "◯"), ("player", "玩家名片", "♙"),
]

def link(page, label, cls="button"):
    return f'<a class="{cls}" href="{page}.html">{label}</a>'

def card(title, body, actions="", extra=""):
    return f'<article class="card">{extra}<h3>{title}</h3><p>{body}</p><div class="actions">{actions}</div></article>'

def section(title, body):
    return f'<div class="section-title"><h2>{title}</h2></div>{body}'

def page_body(name):
    if name == "index":
        return f'''<div class="page-head"><div><div class="eyebrow">YOUR NEXT ROUND STARTS HERE</div><h1>把上一场，变成下一场的优势<span class="orange">.</span></h1><p>看懂关键回合，找到训练方向，和对的人一起上场。</p></div>{link("upload","＋ 新建复盘","button primary")}</div><section class="hero"><div><div class="eyebrow">REVIEW. PRACTICE. REPEAT.</div><h2>打得更多，<br>也要<span class="orange">看得更清楚。</span></h2><p>从一份对局数据开始，回看交火、经济与道具。</p>{link("upload","开始我的复盘 →","button primary")}</div><div class="radar">◎</div></section>{section("状态一览",'<div class="grid four">'+''.join(card(t,f'<strong>{v}</strong><br>{d}') for t,v,d in [('已复盘对局','03','场'),('平均 Rating','1.18','综合表现'),('平均 ADR','89.3','每回合伤害'),('对局胜率','67%','最近对局')])+'</div>')}{section("下一步",'<div class="grid three">'+card('分析上一场','找出关键回合和复盘重点',link('replays','查看复盘 →'))+card('先练一组','进入瞄准训练，练习反应和定位',link('training','进入训练 →'))+card('下一场一起打','寻找校园队友与车队',link('lobbies','寻找车队 →'))+'</div>')}'''
    if name == "login":
        return f'''<div class="grid two"><div class="hero"><div><div class="eyebrow">WELCOME TO THE SQUAD</div><h1>下一次进步，<br>从这里<span class="orange">开始。</span></h1><p>保存复盘、记录训练成绩，与校园玩家一起变强。</p></div></div><div class="panel"><div class="eyebrow">ACCOUNT</div><h2>回到你的工作台</h2><p>演示原型可直接点击按钮进入，不需要真实账号。</p><label class="field">用户名<input value="demo_player"></label><label class="field">密码<input type="password" value="Demo123456!"></label><div class="actions">{link('index','登录并进入 →','button primary')}{link('profile','创建账号 →')}</div><p class="small muted" style="margin-top:24px">注册后可完善玩家名片；正式产品需后端验证身份。</p></div></div>'''
    if name == "replays":
        rows=''.join(f'<div class="row"><div><strong>{map_} · {date}</strong><br><span class="muted small">{score}　·　{note}</span></div><div>{link("report","查看报告 →")}</div></div>' for map_,date,score,note in [('Mirage','10 月 24 日','10 : 13','23 回合 · 已分析'),('Inferno','10 月 21 日','13 : 9','22 回合 · 已分析'),('Ancient','10 月 18 日','16 : 14','30 回合 · 已分析')])
        return f'''<div class="page-head"><div><div class="eyebrow">MATCH ARCHIVE</div><h1>我的复盘<span class="orange">.</span></h1><p>每场对局都留下值得回看的瞬间。</p></div>{link('upload','＋ 新建复盘','button primary')}</div><div class="hint">原始 Demo 留在本地。这里展示导出的分析报告与历史记录。</div><div class="panel"><h2>最近对局</h2>{rows}</div>'''
    if name == "upload":
        return f'''<div class="eyebrow">NEW REVIEW</div><h1>新建复盘<span class="orange">.</span></h1><p>把本地 Demo 解析结果提交到工作台，按四个阶段查看进度。</p><div class="grid two"><div class="panel"><h2>选择导入方式</h2><div class="tabs"><a class="active">自动导入</a><a>手动上传 ZIP</a></div><div class="empty"><div style="font-size:38px;color:#ed9d61">⇧</div>拖入分析 ZIP，或点击选择文件<br><span class="small">支持本地工具生成的报告包</span></div><div class="actions">{link('report','使用示例数据开始分析 →','button primary')}{link('replays','返回复盘列表')}</div></div><div class="panel"><h2>分析流程</h2><div class="row">01　读取数据 <span class="pill">准备中</span></div><div class="row">02　识别回合与玩家 <span class="muted">待开始</span></div><div class="row">03　计算表现指标 <span class="muted">待开始</span></div><div class="row">04　生成交互报告 <span class="muted">待开始</span></div><p class="small muted" style="margin-top:18px">答辩原型使用示例数据，不上传真实 Demo。</p></div></div>'''
    if name == "report":
        bars=''.join(f'<div class="bar" style="height:{h}px"></div>' for h in [70,85,45,110,90,125,80,115,95,135,70,145,105,120,98,160,82,125,110,140,100,130,90])
        return f'''<div class="eyebrow">MATCH REPORT / DE_MIRAGE</div><div class="page-head"><div><h1>Mirage / 复盘报告</h1><p>2026 / 10 / 24　·　23 个回合　·　我方 10 : 13 对方</p></div>{link('replays','← 我的复盘')}</div><div class="grid four">{''.join(card(t,f'<div class="stat"><strong>{v}</strong></div>{d}') for t,v,d in [('击杀 / 死亡 / 助攻','33 / 14 / 2','本场个人表现'),('场均伤害','141.6','ADR'),('贡献回合率','78.3%','击杀、助攻、生存'),('爆头率','30.3%','爆头击杀占比')])}</div><div class="tabs"><a class="active" href="#overview">比赛概览</a><a href="#rounds">回合复盘</a><a href="#utility">道具与生存</a><a href="#data">详细数据</a></div><div class="grid two"><div id="overview" class="panel"><h2>回合影响力</h2><p>点击关键回合，定位到回合复盘。</p><div class="chart">{bars}</div></div><div id="rounds" class="panel"><h2>优先复盘</h2><div class="row">第 3 回合 · 受到自己的闪光影响 <a href="#utility" class="orange">定位 →</a></div><div class="row">第 11 回合 · 进攻路线与道具配合 <a href="#utility" class="orange">定位 →</a></div><div class="row">第 18 回合 · 换弹时阵亡 <a href="#data" class="orange">定位 →</a></div></div><div id="utility" class="panel"><h2>道具与生存</h2><p>查看投掷物轨迹、受闪时刻和每回合生存时间。</p><span class="tag">闪光弹</span><span class="tag">烟雾弹</span><span class="tag">燃烧弹</span></div><div id="data" class="panel"><h2>详细数据</h2><p>逐回合击杀、伤害、经济与位置记录。</p>{link('replays','返回全部对局 →')}</div></div>'''
    if name == "training":
        return f'''<div class="eyebrow">WARM UP</div><h1>瞄准训练<span class="orange">.</span></h1><p>选择训练模式，记录本地最佳成绩，练好下一场的第一枪。</p><div class="grid three">{''.join(card(t,d,'<button onclick="alert(\'原型展示模式选择；完整训练请打开前端应用\')">选择模式</button>') for t,d in [('网格点射','切换三个靶球，训练定位与点击'),('反应测试','色块变绿后点击，测量反应时间'),('大幅甩枪','命中远距离出现的靶球'),('精准微调','命中较小靶球'),('平滑跟枪','跟随移动靶球，无需开火')])}</div><div class="hint" style="margin-top:24px">实际前端的训练模块包含完整游戏。原型展示模式选择与操作入口。</div>'''
    if name == "lobbies":
        return f'''<div class="page-head"><div><div class="eyebrow">FIND YOUR FIVE</div><h1>下一场，一起打<span class="orange">.</span></h1><p>浏览校园车队，领取组队码，和队友进入游戏。</p></div><button class="primary" onclick="document.getElementById('create').hidden=false">＋ 发布车队</button></div><div id="create" class="panel" hidden><h2>发布车队</h2><div class="grid two"><label class="field">车队名称<input value="周末五排"></label><label class="field">模式<select><option>竞技匹配</option><option>优先模式</option></select></label></div><button onclick="document.getElementById('create').hidden=true;alert('原型示意：车队已发布')" class="primary">确认发布</button></div><div class="hint">领取组队码 → 在游戏内加入 → 队长发车</div><div class="actions"><button>全部模式</button><button>竞技匹配</button><button>优先模式</button><button>搭档模式</button></div><div class="grid three" style="margin-top:20px">{''.join(card(f'练习车队 {i}','Mirage · 完美 C+ · 华东<br>周末一起练习，友好交流。',f'<button onclick="alert(\'原型示意：车队详情与组队码\')">查看详情</button><button class="primary" onclick="alert(\'原型示意：已领取组队码\')">领取组队码</button>', '<span class="eyebrow">竞技匹配　　<span class="pill">招募中</span></span>') for i in [1,2,3,4,5,6])}</div>'''
    if name == "friends":
        return f'''<div class="eyebrow">PLAYER NETWORK</div><h1>玩家与好友<span class="orange">.</span></h1><p>搜索玩家、查看名片、发送申请，找到合适的队友。</p><div class="panel"><label class="field">搜索玩家<input placeholder="输入用户名或昵称"></label><button class="primary" onclick="document.getElementById('results').hidden=false">搜索玩家</button></div><div id="results" class="grid three" style="margin-top:20px" hidden>{card('Alice','擅长 Mirage · 寻找稳定队友','<button onclick="alert(\'好友申请已发送（原型演示）\')">添加好友</button>'+link('profile','查看名片'))}</div><div class="section-title"><h2>我的好友</h2></div><div class="grid three">{''.join(card(t,d,link('profile','查看名片 →')) for t,d in [('Alice','擅长突破与补枪'),('Bob','团队沟通与道具配合'),('Charlie','周末在线，寻找五排')])}</div>'''
    if name == "profile":
        return f'''<div class="eyebrow">MY PLAYER CARD</div><h1>个人中心<span class="orange">.</span></h1><p>设置玩家名片，让队友更快了解你。</p><div class="grid two"><div class="panel"><h2>玩家名片</h2><div style="font-size:42px;color:#ef9d60">◉</div><h2>Demo Player</h2><p>@demo_player · 华东 · 完美 C+</p><span class="tag">寻找队友</span><span class="tag">Mirage</span><span class="tag">竞技匹配</span><div class="actions">{link('friends','查看好友 →')}{link('lobbies','寻找车队 →')}</div></div><div class="panel"><h2>编辑资料</h2><label class="field">昵称<input value="Demo Player"></label><label class="field">Steam 好友码<input value="1234 5678"></label><label class="field">个人签名<input value="想找队友一起复盘和训练"></label><button class="primary" onclick="alert('资料已保存（原型演示）')">保存资料</button></div></div>'''
    if name == "player":
        return f'''<div class="eyebrow">PLAYER CARD</div><h1>Alice 的玩家名片<span class="orange">.</span></h1><p>查看擅长地图、游戏水平和队友需求。</p><div class="grid two"><div class="panel"><div style="font-size:50px;color:#ef9d60">◉</div><h2>Alice</h2><p>@alice · 华东 · 完美 C+</p><span class="tag">Mirage</span><span class="tag">寻找队友</span><span class="tag">周末在线</span><div class="actions"><button class="primary" onclick="this.textContent='申请已发送';this.disabled=true">添加好友</button>{link('friends','返回玩家与好友 →')}</div></div><div class="panel"><h2>玩家简介</h2><p>喜欢交流配合，主要进行竞技匹配和周末五排。</p><div class="row">游戏水平 <strong>完美 C+</strong></div><div class="row">常玩地图 <strong>Mirage / Inferno</strong></div><div class="row">队友需求 <strong>友好交流、稳定开黑</strong></div></div></div>'''
    raise ValueError(name)

def document(name, title):
    nav=''.join(f'<a href="{key}.html" class="{"active" if key==name else ""}">{icon}　{label}</a>' for key,label,icon in PAGES if key not in ('login','upload','report','player'))
    body=page_body(name)
    if name == 'report':
        body = body.replace(
            '<span class="tag">闪光弹</span><span class="tag">烟雾弹</span><span class="tag">燃烧弹</span>',
            '<div class="row">闪光弹 <strong>8 次投掷 · 3 次有效致盲</strong></div><div class="row">烟雾弹 <strong>5 次投掷 · 2 次掩护进攻</strong></div><div class="row">燃烧弹 <strong>4 次投掷 · 1 次阻断推进</strong></div><div class="hint" style="margin-top:18px">第 3 回合：自己的闪光弹影响了进点时机，建议复查投掷角度。</div>',
        ).replace(
            '<p>逐回合击杀、伤害、经济与位置记录。</p>',
            '<p>逐回合击杀、伤害、经济与位置记录。</p><div class="row"><strong>回合</strong><strong>击杀 / 伤害 / 结果</strong></div><div class="row">第 1 回合 <span>2 / 186 / 获胜</span></div><div class="row">第 2 回合 <span>1 / 75 / 获胜</span></div><div class="row">第 3 回合 <span>0 / 28 / 失败</span></div><div class="row">第 4 回合 <span>1 / 102 / 获胜</span></div><div class="row">第 5 回合 <span>3 / 244 / 获胜</span></div>',
        )
    return f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{escape(title)} · CS Demo Master 原型</title><style>{CSS}</style></head><body><div class="shell"><aside class="sidebar"><a class="brand" href="index.html"><b>⌖</b> CS DEMO <small>MASTER</small></a><div class="eyebrow">PLAYER WORKSPACE / 01</div><nav class="nav">{nav}</nav><div class="sidebar-note">◎　原型演示数据<br>点击导航与按钮体验主流程</div></aside><div class="main"><header class="top"><span>工作台　/　{escape(title)}</span><span>{link('profile','Demo Player','ghost')}　{link('login','登录 / 注册','ghost')}</span></header><main class="content">{body}<div class="footer">CS DEMO MASTER / 软件工程课程界面原型 · 示例内容</div></main></div></div><script>{SCRIPT.replace('PAGE_NAME',name)}</script></body></html>'''

for name,title,_ in PAGES:
    (OUT / f"{name}.html").write_text(document(name,title), encoding="utf-8")
(ROOT / "index.html").write_text('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=pages/index.html"><a href="pages/index.html">打开原型</a>', encoding="utf-8")
print(f"Generated {len(PAGES)} pages in {OUT}")
