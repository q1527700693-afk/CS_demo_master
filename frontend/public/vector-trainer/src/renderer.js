import * as THREE from '../vendor/three/three.module.js';
import { createValveViewmodel } from './weapon.js';
import { mergeGeometries } from '../vendor/three/addons/utils/BufferGeometryUtils.js';
import { targetWorld, EYE_HEIGHT } from './spatial.js';

export class ArenaRenderer {
  constructor(canvas) {
    this.canvas=canvas;
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
    this.renderScale=1;this.renderer.setPixelRatio(1);this.quality='performance';this.lastRender=0;this.frameWindow=[];this.fps=0;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.0;
    this.renderer.shadowMap.enabled=false;
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#e1e3e5');this.scene.fog=new THREE.Fog('#e1e3e5',45,110);
    this.camera=new THREE.PerspectiveCamera(64,16/9,.08,150);this.camera.position.set(0,EYE_HEIGHT,0);this.camera.rotation.order='YXZ';
    this.targets=new Map();this.targetScene=new THREE.Scene();this.targetGeometry=new THREE.SphereGeometry(1,24,16);
    this.targetMaterial=new THREE.MeshStandardMaterial({color:0xe5773e,roughness:.47,metalness:.1,emissive:0x47200b,emissiveIntensity:.15});
    this.activeMaterial=new THREE.MeshStandardMaterial({color:0xa8db63,roughness:.5,emissive:0x416215,emissiveIntensity:.3});
    this.buildRange();
    this.weaponScene=new THREE.Scene();this.weaponCamera=new THREE.PerspectiveCamera(58,16/9,.01,20);this.weaponAim=new THREE.Vector3();
    const environmentCanvas=document.createElement('canvas');environmentCanvas.width=256;environmentCanvas.height=128;
    const envContext=environmentCanvas.getContext('2d'),gradient=envContext.createLinearGradient(0,0,0,128);
    gradient.addColorStop(0,'#f2ead3');gradient.addColorStop(.48,'#b6c2bc');gradient.addColorStop(.55,'#737d73');gradient.addColorStop(1,'#303a33');envContext.fillStyle=gradient;envContext.fillRect(0,0,256,128);envContext.fillStyle='#fff9e6';envContext.fillRect(25,15,48,8);envContext.fillRect(150,24,65,7);
    this.environment=new THREE.CanvasTexture(environmentCanvas);this.environment.mapping=THREE.EquirectangularReflectionMapping;this.environment.colorSpace=THREE.SRGBColorSpace;this.weaponScene.environment=this.environment;this.scene.environment=this.environment;this.targetScene.environment=this.environment;
    this.targetScene.add(new THREE.HemisphereLight(0xf3f5f7,0x8e949b,2.3));
    const targetKey=new THREE.DirectionalLight(0xffffff,2);targetKey.position.set(-12,25,8);this.targetScene.add(targetKey);
    this.weapon={root:new THREE.Group(),fire(){},update(){}};this.weaponScene.add(this.weapon.root);
    const rangeReady=this.ready;this.ready=Promise.all([rangeReady,createValveViewmodel()]).then(([,weapon])=>{if(this.disposed){this.disposeScene(weapon.root);for(const source of weapon.sources||[])this.disposeScene(source);return;}this.weaponScene.remove(this.weapon.root);this.weapon=weapon;this.weaponScene.add(weapon.root);this.assetsReady=true;});
    this.weaponScene.add(new THREE.HemisphereLight(0xe4e8ed,0x42474c,2.0));
    const key=new THREE.DirectionalLight(0xfff7eb,2.5);key.position.set(-3,5,1);this.weaponScene.add(key);
    const rim=new THREE.DirectionalLight(0xc8d5e1,.8);rim.position.set(3,1,-3);this.weaponScene.add(rim);
    this.lastTime=0;this.recoil=0;
    this.onContextLost=event=>{event.preventDefault();canvas.dispatchEvent(new CustomEvent('arena-context-lost'));};
    canvas.addEventListener('webglcontextlost',this.onContextLost);
  }
  buildRange() {
    const scene=this.scene;
    scene.add(new THREE.HemisphereLight(0xf3f5f7,0x8e949b,2.3));
    const key=new THREE.DirectionalLight(0xffffff,2);key.position.set(-12,25,8);scene.add(key);
    // Matte gray room: three merged surface colors, no floor maps or shadows.
    const room=new THREE.Group();room.name='Graybox training room';scene.add(room);
    const floor=new THREE.MeshLambertMaterial({color:0xb7bcc2}),wall=new THREE.MeshLambertMaterial({color:0xe0e2e4}),trim=new THREE.MeshLambertMaterial({color:0xc2c7cd});
    const box=(w,h,d,x,y,z,material)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);mesh.position.set(x,y,z);room.add(mesh);};
    box(36,.2,110,0,-.12,-25,floor);
    box(36,24,.3,0,12,-48,wall);box(.3,24,110,-18,12,-25,wall);box(.3,24,110,18,12,-25,wall);
    box(36,.18,.3,0,.09,-47.7,trim);box(.3,.18,110,-17.7,.09,-25,trim);box(.3,.18,110,17.7,.09,-25,trim);
    // Shallow wall recesses and floor seams supply depth without scenery clutter.
    for(let x=-15;x<=15;x+=5)box(.035,24,.025,x,12,-47.82,trim);
    this.mergeStatic(room);
    const points=[];for(let x=-15;x<=15;x+=5)points.push(x,.002,20,x,.002,-48);
    for(let z=20;z>=-48;z-=5)points.push(-18,.002,z,18,.002,z);
    const seams=new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(points,3)),new THREE.LineBasicMaterial({color:0xa6adb5,transparent:true,opacity:.3}));seams.name='Floor perspective seams';scene.add(seams);
    this.ready=this.loadWallArt();
  }
  async loadWallArt(){
    const texture=await new THREE.TextureLoader().loadAsync(new URL('../assets/decor/character-T-butterfly-ruby-cutout.png',import.meta.url).href);
    if(this.disposed){texture.dispose();return;}
    texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(4,this.renderer.capabilities.getMaxAnisotropy());
    const material=new THREE.MeshBasicMaterial({map:texture,toneMapped:false,transparent:true,alphaTest:.05,depthWrite:false});
    const height=9,width=height*texture.image.width/texture.image.height;
    const art=new THREE.Group();art.name='Side wall artwork';this.scene.add(art);
    for(const [name,x,rotation,mirrored]of [['left',-17.82,Math.PI/2,false],['right',17.82,-Math.PI/2,true]]){
      // Transparent character decal, 50% taller. Keep its far edge at z=-28
      // so enlargement never extends into the target envelope.
      const geometry=new THREE.PlaneGeometry(width,height);
      if(mirrored){const uv=geometry.attributes.uv;for(let i=0;i<uv.count;i++)uv.setX(i,1-uv.getX(i));}
      const picture=new THREE.Mesh(geometry,material);picture.name=`Wall art ${name}`;picture.position.set(x,5.5,-28+width/2);picture.rotation.y=rotation;picture.userData.mirrored=mirrored;art.add(picture);
    }
  }
  mergeStatic(group){
    group.updateMatrixWorld(true);const inverse=new THREE.Matrix4().copy(group.matrixWorld).invert(),buckets=new Map(),originals=[];
    group.traverse(o=>{if(!o.isMesh||Array.isArray(o.material))return;const key=o.material.uuid;let bucket=buckets.get(key);if(!bucket)buckets.set(key,bucket={material:o.material,geometries:[]});const geometry=o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,o.matrixWorld));for(const name of Object.keys(geometry.attributes))if(!['position','normal','uv'].includes(name))geometry.deleteAttribute(name);bucket.geometries.push(geometry);originals.push(o);});
    for(const mesh of originals)mesh.removeFromParent();
    for(const {material,geometries}of buckets.values()){const geometry=mergeGeometries(geometries);if(!geometry)throw new Error('Static geometry merge failed');for(const g of geometries)g.dispose();const mesh=new THREE.Mesh(geometry,material);group.add(mesh);}
  }
  disposeScene(scene){
    const geometries=new Set(),materials=new Set(),textures=new Set();
    scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});
    for(const g of geometries)g.dispose();for(const t of textures){t.dispose();t.source?.data?.close?.();}for(const m of materials)m.dispose();
  }
  fire(){this.recoil=1;this.weapon.fire();}
  updateResolution(rect,engine,time){
    const detail=engine.config.graphicsQuality==='detail',quality=detail?'detail':'performance';
    if(quality!==this.quality){this.quality=quality;this.adaptiveScale=1;this.width=0;this.slowFrames=0;}
    const frameMs=this.lastTime?time-this.lastTime:0;
    if(engine.state==='running'&&frameMs>0&&frameMs<200){
      this.frameWindow.push(frameMs);if(this.frameWindow.length>60)this.frameWindow.shift();
      if(this.frameWindow.length>=30)this.fps=Math.round(1000/(this.frameWindow.reduce((n,v)=>n+v,0)/this.frameWindow.length));
      this.slowFrames=(this.slowFrames||0)+1;
      if(this.slowFrames>=120){const average=this.frameWindow.reduce((n,v)=>n+v,0)/this.frameWindow.length;this.slowFrames=0;
        if(average>18&&(this.adaptiveScale||1)>.75){this.adaptiveScale=Math.max(.75,(this.adaptiveScale||1)-.125);this.width=0;}
      }
    }
    const cap=detail?1.5:1,pixelBudget=detail?3_200_000:2_073_600;
    const ratio=Math.min(window.devicePixelRatio||1,cap,Math.sqrt(pixelBudget/(rect.width*rect.height)))*(this.adaptiveScale||1);
    if(this.width===rect.width&&this.height===rect.height&&Math.abs(this.renderScale-ratio)<.001)return;
    this.width=rect.width;this.height=rect.height;this.renderScale=ratio;this.renderer.setPixelRatio(ratio);this.renderer.setSize(rect.width,rect.height,false);
    this.camera.aspect=this.weaponCamera.aspect=rect.width/rect.height;this.camera.updateProjectionMatrix();this.weaponCamera.updateProjectionMatrix();
  }
  render(engine,time=0,reducedMotion=false){
    const rect=this.canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
    if(!['running','countdown'].includes(engine.state)&&time-this.lastRender<1000/30)return;
    this.lastRender=time;this.updateResolution(rect,engine,time);
    engine.aspect=this.camera.aspect;if(this.camera.fov!==engine.config.fov){this.camera.fov=engine.config.fov;this.camera.updateProjectionMatrix();}
    const look=engine.config.input==='locked'?engine.look:{yaw:0,pitch:0};this.camera.rotation.set(look.pitch,look.yaw,0,'YXZ');
    const preview=['idle','finished'].includes(engine.state);
    const list=preview?(engine.config.mode==='gridshot'?[{id:1,x:330,y:141,radius:27},{id:2,x:670,y:281,radius:27},{id:3,x:500,y:421,radius:27}]:[{id:1,x:500,y:250,radius:engine.config.mode==='microshot'?12:30}]):engine.targets;
    const ids=new Set(list.map(t=>t.id));for(const[id,mesh]of this.targets)if(!ids.has(id)){this.targetScene.remove(mesh);this.targets.delete(id);}
    for(const target of list){let mesh=this.targets.get(target.id);if(!mesh){mesh=new THREE.Mesh(this.targetGeometry,this.targetMaterial);mesh.castShadow=false;this.targetScene.add(mesh);this.targets.set(target.id,mesh);}const p=targetWorld(target);mesh.position.set(p.x,p.y,p.z);mesh.scale.setScalar(p.radius);mesh.material=engine.config.mode==='tracking'&&!preview&&engine.targetHit(target)?this.activeMaterial:this.targetMaterial;mesh.visible=engine.config.mode!=='reaction';}
    const dt=Math.min(.1,Math.max(0,(time-this.lastTime)/1000));this.lastTime=time;this.recoil=Math.max(0,this.recoil-dt*7);
    const breath=reducedMotion?0:Math.sin(time*.0016)*.0015;
    this.weapon.root.position.set(.12,-.14+breath+this.recoil*.008,-.34+this.recoil*.025);
    this.weaponAim.set(0,0,.5).unproject(this.weaponCamera);
    this.weaponAim.multiplyScalar(12/-this.weaponAim.z);this.weapon.aimAt?.(this.weaponAim);this.weapon.update(dt,this.recoil);
    this.renderer.setRenderTarget(null);this.renderer.render(this.scene,this.camera);
    this.renderer.autoClear=false;this.renderer.clearDepth();this.renderer.render(this.weaponScene,this.weaponCamera);
    // Targets are the interaction layer: draw them last so the viewmodel can never hide a ball.
    this.renderer.clearDepth();this.renderer.render(this.targetScene,this.camera);this.renderer.autoClear=true;
  }
  project(target){const p=targetWorld(target),v=new THREE.Vector3(p.x,p.y,p.z).project(this.camera),r=this.canvas.getBoundingClientRect();return{x:r.left+(v.x+1)/2*r.width,y:r.top+(1-v.y)/2*r.height};}
  dispose(loseContext=false){
    this.disposed=true;
    this.canvas.removeEventListener('webglcontextlost',this.onContextLost);
    const geometries=new Set(),materials=new Set(),textures=new Set();
    for(const scene of[this.scene,this.targetScene,this.weaponScene,...(this.assetSources||[]),...(this.weapon.sources||[])])scene.traverse(object=>{if(object.geometry)geometries.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:object.material?[object.material]:[]){materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value);}});
    for(const g of geometries)g.dispose();for(const t of textures){t.dispose();t.source?.data?.close?.();}for(const m of materials)m.dispose();this.environment.dispose();this.targetGeometry.dispose();this.targetMaterial.dispose();this.activeMaterial.dispose();this.renderer.dispose();if(loseContext)this.renderer.forceContextLoss();
  }
}
