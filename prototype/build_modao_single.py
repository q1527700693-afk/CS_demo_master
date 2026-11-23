"""Combine the 20 core screens into one self-contained interactive HTML file."""
import re
from html import escape
from pathlib import Path

from build_modao_core import ORDER, CSS, NAV

ROOT=Path(__file__).resolve().parent
SOURCE=ROOT/'modao_core'
OUT=ROOT/'cs-demo-master-modao-single.html'

screens=[]
for number,key in enumerate(ORDER,1):
    source=(SOURCE/f'{key}.html').read_text(encoding='utf-8')
    body=re.search(r'<main class="content">(.*?)<div class="footer">',source,re.S)
    assert body,(key,'missing main')
    content=body.group(1)
    content=re.sub(r'href="([a-z-]+)\.html"',lambda m:f'href="#{m.group(1)}"',content)
    screens.append(f'<section class="screen" id="{key}" data-title="{escape(key)}" hidden>{content}</section>')

nav=''.join(f'<a href="#{key}" data-nav="{key}">{label}</a>' for key,label in NAV)
style=CSS+'''[hidden]{display:none!important}.screen{max-width:1320px;margin:auto;padding:40px}.screen:target{display:block}.nav a.active{color:#f1a060;background:#31251f}.top a{padding:5px 10px}.footer{max-width:1320px;margin:32px auto;padding:18px 40px}@media(max-width:860px){.screen{padding:24px 16px}.footer{padding:18px 16px}.sidebar{display:block;padding:16px}.nav{grid-template-columns:repeat(2,1fr)}.shell{grid-template-columns:1fr}}'''
script='''(() => {
  const keys = new Set(KEYS);
  const titles = TITLES;
  const pages = [...document.querySelectorAll('.screen')];
  function show() {
    const requested = decodeURIComponent(location.hash.slice(1));
    const key = keys.has(requested) ? requested : 'index';
    pages.forEach(page => page.hidden = page.id !== key);
    document.querySelectorAll('[data-nav]').forEach(link => link.classList.toggle('active', link.dataset.nav === key));
    document.getElementById('breadcrumb').textContent = titles[key];
    document.title = `${titles[key]} · CS Demo Master 原型`;
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', show);
  show();
})();'''.replace('KEYS',repr(ORDER).replace("'",'"')).replace('TITLES',repr({key:name for key,name in zip(ORDER,[
    '总览','登录','我的复盘','新建复盘','分析进度','比赛概览','回合复盘','道具与生存','详细数据','瞄准训练','训练设置','训练结算','校园车队','发布车队','车队详情','领取组队码','我的好友','好友申请','玩家名片','个人中心'])}).replace("'",'"'))

html=f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CS Demo Master 交互原型</title><style>{style}</style></head><body><div class="shell"><aside class="sidebar"><a class="brand" href="#index"><b>⌖</b> CS DEMO <small>MASTER</small></a><div class="eyebrow">PLAYER WORKSPACE / 01</div><nav class="nav">{nav}</nav><div class="sidebar-note">◎　原型演示数据<br>点击导航或页面按钮浏览流程</div></aside><div class="main"><header class="top"><span>工作台　/　<span id="breadcrumb">总览</span></span><span><a href="#profile">Demo Player</a><a href="#login">登录 / 注册</a></span></header><main>{''.join(screens)}</main><div class="footer">CS DEMO MASTER / 软件工程课程界面原型 · 示例内容</div></div></div><script>{script}</script></body></html>'''
OUT.write_text(html,encoding='utf-8')
print(f'Generated {OUT.name}: {len(screens)} screens, {len(html)} characters')
