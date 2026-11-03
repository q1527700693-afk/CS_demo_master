"""Generate a one-run local Figma plugin that repairs and links the course prototype."""

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "figma_plugin"
OUT.mkdir(exist_ok=True)
layout = json.loads((ROOT / "figma-layout.json").read_text(encoding="utf-8"))
missing = layout[-3:]
hotspots = {page["key"]: page["hotspots"] for page in layout}

manifest = {
    "name": "CS Demo Master 原型连线",
    "id": "1465724538964020912",
    "api": "1.0.0",
    "editorType": ["figma"],
    "main": "code.js",
    "documentAccess": "dynamic-page",
    "networkAccess": {"allowedDomains": ["none"]},
}
(OUT / "manifest.json").write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)

script = r"""// Generated from the verified 34-screen web prototype. No network calls.
const MISSING = __MISSING__;
const HOTSPOTS = __HOTSPOTS__;
const KEYS = __KEYS__;
const PREFIX = 'PROTO_LINK__';

async function main() {
  const page = figma.currentPage;
  const existing = new Map();
  for (const child of page.children) {
    if (child.type !== 'FRAME') continue;
    const key = child.name.split(' · ')[0];
    if (KEYS.includes(key)) existing.set(key, child);
  }
  // Refuse to modify another Figma file.
  const required = KEYS.slice(0, 31);
  const absent = required.filter(key => !existing.has(key));
  if (absent.length) throw new Error('当前文件不是 CS Demo Master 设计稿，缺少画布：' + absent.join(', '));

  const created = [];
  const fonts = [{family:'Noto Sans SC',style:'Regular'},{family:'Noto Sans SC',style:'Bold'}];
  await Promise.all(fonts.map(font => figma.loadFontAsync(font)));
  const rgb = a => ({r:a[0]/255,g:a[1]/255,b:a[2]/255});

  for (const d of MISSING) {
    if (existing.has(d.key)) continue;
    const frame = figma.createFrame();
    frame.name = d.key + ' · ' + d.title;
    frame.resize(1440, d.height);
    frame.x = 100 + (d.gridIndex % 3) * 1540;
    frame.y = 100 + Math.floor(d.gridIndex / 3) * 1400;
    frame.fills = [{type:'SOLID',color:{r:8/255,g:10/255,b:11/255}}];
    for (const s of d.shapes) {
      const n = figma.createRectangle();
      frame.appendChild(n);
      n.name = s.name;
      n.x = s.box[0]; n.y = s.box[1];
      n.resize(Math.max(1,s.box[2]),Math.max(1,s.box[3]));
      n.cornerRadius = Math.max(0,Math.min(s.radius,n.width/2,n.height/2));
      n.fills = s.fill && s.fill[3] > 0 ? [{type:'SOLID',color:rgb(s.fill),opacity:s.fill[3]}] : [];
      if (s.stroke) {
        n.strokes = [{type:'SOLID',color:rgb(s.stroke)}];
        n.strokeWeight = Math.max(1,s.sw);
      }
    }
    for (const t of d.texts) {
      const n = figma.createText();
      frame.appendChild(n);
      n.fontName = {family:'Noto Sans SC',style:t.weight >= 600 ? 'Bold' : 'Regular'};
      n.fontSize = Math.max(9,t.size);
      n.characters = t.text;
      n.fills = [{type:'SOLID',color:rgb(t.color || [244,244,242])}];
      n.x = t.box[0]; n.y = t.box[1];
      n.resize(Math.max(2,Math.min(t.box[2]+6,1440-t.box[0]-2)),Math.max(t.box[3]+4,n.fontSize+5));
      n.textAutoResize = 'HEIGHT';
    }
    existing.set(d.key,frame);
    created.push(d.key);
  }

  let linked = 0;
  for (const key of KEYS) {
    const frame = existing.get(key);
    if (!frame) throw new Error('缺少画布：' + key);
    // Re-running the plugin replaces only its own hotspots.
    for (const child of [...frame.children]) {
      if (child.name.startsWith(PREFIX)) child.remove();
    }
    for (const item of HOTSPOTS[key]) {
      const target = existing.get(item.target);
      if (!target) throw new Error(key + ' 的目标不存在：' + item.target);
      const hotspot = figma.createRectangle();
      frame.appendChild(hotspot);
      hotspot.name = PREFIX + item.target + ' · ' + item.label;
      hotspot.x = item.box[0]; hotspot.y = item.box[1];
      hotspot.resize(Math.max(1,item.box[2]),Math.max(1,item.box[3]));
      hotspot.fills = [{type:'SOLID',color:{r:0,g:0,b:0},opacity:0}];
      hotspot.strokes = [];
      await hotspot.setReactionsAsync([{
        trigger:{type:'ON_CLICK'},
        actions:[{type:'NODE',destinationId:target.id,navigation:'NAVIGATE',transition:null}]
      }]);
      linked++;
    }
  }
  page.flowStartingPoints = [{nodeId:existing.get('index').id,name:'CS Demo Master · 从总览开始'}];
  figma.viewport.scrollAndZoomIntoView([existing.get('index')]);
  figma.closePlugin('完成：' + existing.size + ' 个画布，' + linked + ' 条点击连线；新建 ' + created.length + ' 个画布。');
}

main().catch(error => {
  figma.closePlugin('连线失败：' + (error && error.message ? error.message : String(error)));
});
"""
script = script.replace("__MISSING__", json.dumps([
    {**page, "gridIndex": 31 + index} for index, page in enumerate(missing)
], ensure_ascii=False, separators=(",", ":")))
script = script.replace("__HOTSPOTS__", json.dumps(hotspots, ensure_ascii=False, separators=(",", ":")))
script = script.replace("__KEYS__", json.dumps([page["key"] for page in layout], ensure_ascii=False, separators=(",", ":")))
(OUT / "code.js").write_text(script, encoding="utf-8")
print(f"Generated {OUT}: {len(layout)} screens, {sum(len(v) for v in hotspots.values())} links")
