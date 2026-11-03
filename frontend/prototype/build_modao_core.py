"""Build a 20-canvas import within MoDao's per-call page limit."""
import re
from pathlib import Path
from html import escape
from build_modao import PAGES, CSS, a, head

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'modao_core'
OUT.mkdir(exist_ok=True)

ORDER=['index','login','replays','upload','upload-progress','report-overview','report-rounds','report-utility','report-data','training','training-setup','training-result','lobbies','lobby-create','lobby-detail','lobby-code','friends','friends-request','player','profile']
NAV=[('index','⌗　总览'),('replays','▤　我的复盘'),('training','◎　瞄准训练'),('lobbies','♧　校园车队'),('friends','♙　玩家与好友'),('profile','◯　个人中心')]
data={key:(name,body) for key,name,body in PAGES}

def extra(key,body):
    if key=='login':
        body+=f'''<div class="section-title"><h2>还没有账号？</h2></div><div class="panel" style="max-width:700px"><p>输入用户名、密码与确认密码后创建账号。原型中的“创建账号”进入个人资料填写阶段。</p>{a('profile','创建账号并完善名片 →',True)}</div>'''
    if key=='replays':
        body+=f'''<div class="section-title"><h2>本地复盘库</h2></div><div class="panel"><p>每次分析单独保存在本机，包括报告、表格、事件和地图回放。</p><div class="row">Mirage · Pose · 完整保存 {a('report-overview','查看复盘 →')}</div><div class="row">Inferno · Pose · 完整保存 {a('report-overview','查看复盘 →')}</div></div>'''
    if key=='upload':
        body+=f'''<div class="section-title"><h2>其他导入方式</h2></div><div class="grid two"><div class="panel"><h3>手动上传 ZIP</h3><p>选择本机已有的分析包。</p>{a('upload-progress','使用示例 ZIP →')}</div><div class="panel"><h3>本地解析 Demo</h3><p>本地工具解析原始录像，导出分析 ZIP 后生成报告。</p>{a('upload-progress','解析示例 Demo →')}</div></div>'''
    if key=='report-rounds':
        body+=f'''<div class="section-title"><h2>第 3 回合地图</h2></div><div class="grid two"><div class="panel"><div class="empty" style="height:230px;display:grid;place-items:center">Mirage · A 区进点轨迹</div></div><div class="panel"><div class="row">00:28 投掷闪光弹</div><div class="row">00:32 自身受到闪光影响</div><div class="row">00:37 队友先行进点</div>{a('report-utility','查看道具分析 →')}</div></div>'''
    if key=='training':
        body+=f'''<div class="section-title"><h2>训练记录与教程</h2></div><div class="grid two"><div class="panel"><h3>最近成绩</h3><div class="row">网格点射 <strong>2,460 分</strong></div><div class="row">反应测试 <strong>336 ms</strong></div><div class="row">平滑跟枪 <strong>71%</strong></div></div><div class="panel"><h3>操作说明</h3><p>鼠标转向与射击；Esc / 空格暂停；Tab 打开设置；F 切换大屏。</p>{a('training-setup','设置并开始训练 →')}</div></div>'''
    if key=='lobbies':
        body+=f'''<div class="section-title"><h2>车队管理</h2></div><div class="panel"><p>发布车队后，可查看领码成员、复制组队码，并由队长确认发车。</p>{a('lobby-detail','查看车队详情 →')}</div>'''
    if key=='lobby-detail':
        body+=f'''<div class="section-title"><h2>队长管理</h2></div><div class="panel"><p>当前成员：Alice、Bob、Charlie。队长确认成员已进入游戏房间后发车。</p><span class="pill">可发车 · 原型展示</span></div>'''
    if key=='friends':
        body+=f'''<div class="section-title"><h2>搜索玩家</h2></div><div class="panel"><label class="field">用户名或昵称<input value="Alice"></label>{a('player','查看 Alice 的名片 →',True)}</div><div class="section-title"><h2>好友申请</h2></div><div class="panel"><p>收到的申请与发出的申请在此管理。</p>{a('friends-request','查看申请 →')}</div>'''
    if key=='profile':
        body+=f'''<div class="section-title"><h2>编辑玩家名片</h2></div><div class="panel"><div class="grid two"><label class="field">昵称<input value="Demo Player"></label><label class="field">Steam 好友码<input value="1234 5678"></label><label class="field">游戏水平<input value="完美 C+"></label><label class="field">常玩地图<input value="Mirage"></label></div><p class="muted small">这是编辑区域示意；原型展示资料字段与保存后的名片。</p></div>'''
    return body

def strip_missing_links(body):
    def replace(match):
        href=match.group(1)
        label=match.group(2)
        return match.group(0) if href in ORDER else f'<span class="tag">{label}</span>'
    return re.sub(r'<a[^>]*href="([a-z-]+)\.html"[^>]*>(.*?)</a>',replace,body)

def document(key,name,body):
    nav=''.join(f'<span class="{"active" if key==target else ""}">{label}</span>' for target,label in NAV)
    style=CSS+'.nav span{display:block;padding:12px 14px;color:#afbac4;border-radius:5px}.nav span.active{color:#f1a060;background:#31251f}'
    return f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{escape(name)} · CS Demo Master 原型</title><style>{style}</style></head><body><div class="shell"><aside class="sidebar"><div class="brand"><b>⌖</b> CS DEMO <small>MASTER</small></div><div class="eyebrow">PLAYER WORKSPACE / 01</div><nav class="nav">{nav}</nav><div class="sidebar-note">◎　界面原型演示数据<br>从页面按钮进入下一状态</div></aside><div class="main"><header class="top"><span>工作台　/　{escape(name)}</span><span class="muted">Demo Player · 原型演示</span></header><main class="content">{body}<div class="footer">CS DEMO MASTER / 软件工程课程界面原型 · 示例内容</div></main></div></div></body></html>'''

for number,key in enumerate(ORDER,1):
    name=data[key][0].split(' ',1)[1]
    body=extra(key,data[key][1])
    if key=='login': body=body.replace('href="register.html"','href="profile.html"')
    if key=='lobby-create': body=body.replace('href="lobby-created.html"','href="lobby-detail.html"')
    body=strip_missing_links(body)
    (OUT/f'{key}.html').write_text(document(key,f'{number:02d} {name}',body),encoding='utf-8')
print(f'Generated {len(ORDER)} core canvases in {OUT}')
