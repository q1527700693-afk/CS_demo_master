const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const layout = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'figma-layout.json'), 'utf8'))
let nextId = 1000
const page = {children:[], flowStartingPoints:[]}
function node(type) {
  const item = {
    type,id:`mock:${nextId++}`,name:'',parent:page,children:[],width:1,height:1,
    resize(w,h){this.width=w;this.height=h},
    appendChild(child){
      if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child),1)
      this.children.push(child);child.parent=this
    },
    remove(){this.parent.children.splice(this.parent.children.indexOf(this),1)},
    async setReactionsAsync(value){this.reactions=value},
  }
  page.children.push(item)
  return item
}
for (const d of layout.slice(0,31)) {
  const frame=node('FRAME')
  frame.name=`${d.key} · ${d.title}`
}
let message=''
const figma={
  currentPage:page,
  createFrame:()=>node('FRAME'),
  createRectangle:()=>node('RECTANGLE'),
  createText:()=>node('TEXT'),
  loadFontAsync:async()=>{},
  viewport:{scrollAndZoomIntoView(){}},
  closePlugin(value){message=value},
}
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'code.js'),'utf8'),{figma})
setTimeout(() => {
  const frames=page.children.filter(item=>item.type==='FRAME')
  const links=frames.flatMap(frame=>frame.children.filter(child=>child.name.startsWith('PROTO_LINK__')))
  assert.equal(frames.length,34)
  assert.equal(links.length,442)
  assert.equal(page.flowStartingPoints.length,1)
  const ids=new Set(frames.map(frame=>frame.id))
  assert(links.every(link=>ids.has(link.reactions[0].actions[0].destinationId)))
  assert(message.startsWith('完成：'),message)
  console.log(message)
},100)
