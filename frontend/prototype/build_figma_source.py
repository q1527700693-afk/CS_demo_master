"""Build a complete, self-contained source for the Figma prototype."""

import re
from html import escape
from pathlib import Path

from build_modao import CSS, NAV, PAGES


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "figma-source.html"

screens = []
for key, name, body in PAGES:
    body = re.sub(
        r'href="([a-z-]+)\.html"',
        lambda match: f'href="#{match.group(1)}"',
        body,
    )
    screens.append(
        f'<section class="screen" id="{key}" data-title="{escape(name)}" hidden>'
        f'{body}</section>'
    )

nav = "".join(
    f'<a href="#{key}" data-nav="{key}">{label}</a>' for key, label in NAV
)
style = CSS + """
[hidden]{display:none!important}
.screen{max-width:1320px;margin:auto;padding:40px}
.nav a.active{color:#f1a060;background:#31251f}
.top a{padding:5px 10px}
.footer{max-width:1320px;margin:32px auto;padding:18px 40px}
@media(max-width:860px){.screen{padding:24px 16px}.footer{padding:18px 16px}.sidebar{display:block;padding:16px}.nav{grid-template-columns:repeat(2,1fr)}.shell{grid-template-columns:1fr}}
"""
titles = {key: name for key, name, _ in PAGES}
import json

script = """(() => {
  const titles = TITLES;
  const pages = [...document.querySelectorAll('.screen')];
  function show() {
    const requested = decodeURIComponent(location.hash.slice(1));
    const key = Object.hasOwn(titles, requested) ? requested : 'index';
    pages.forEach(page => page.hidden = page.id !== key);
    document.querySelectorAll('[data-nav]').forEach(link =>
      link.classList.toggle('active', link.dataset.nav === key));
    document.getElementById('breadcrumb').textContent = titles[key];
    document.title = `${titles[key]} · CS Demo Master 原型`;
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', show);
  show();
})();""".replace("TITLES", json.dumps(titles, ensure_ascii=False))

html = f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CS Demo Master · Figma 原型素材</title><style>{style}</style></head><body><div class="shell"><aside class="sidebar"><a class="brand" href="#index"><b>⌖</b> CS DEMO <small>MASTER</small></a><div class="eyebrow">PLAYER WORKSPACE / 01</div><nav class="nav">{nav}</nav><div class="sidebar-note">◎　界面原型演示数据<br>按流程点击画布按钮</div></aside><div class="main"><header class="top"><span>工作台　/　<span id="breadcrumb">01 总览</span></span><span><a href="#profile">Demo Player</a><a href="#login">登录 / 注册</a></span></header><main>{''.join(screens)}</main><div class="footer">CS DEMO MASTER / 软件工程课程界面原型 · 示例内容</div></div></div><script>{script}</script></body></html>'''
OUT.write_text(html, encoding="utf-8")
print(f"Generated {OUT.name}: {len(screens)} screens")
