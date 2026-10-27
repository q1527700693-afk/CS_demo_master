import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';

/** Original Valve meshes; the original first-person pistol idle is baked offline. */
export async function createValveViewmodel(){
  const loader=new GLTFLoader(),url=name=>new URL(`../assets/valve/${name}.glb`,import.meta.url).href;
  const [gun,arms]=await Promise.all([loader.loadAsync(url('usp')),loader.loadAsync(url('arms'))]);
  const root=new THREE.Group();root.name='Valve USP-S / original first-person pistol idle';
  const pistol=gun.scene;pistol.rotation.y=Math.PI;arms.scene.rotation.y=Math.PI;root.add(pistol,arms.scene);
  root.traverse(o=>{if(o.isMesh){o.frustumCulled=false;for(const m of Array.isArray(o.material)?o.material:[o.material]){m.envMapIntensity=.45;if(m.normalMap)m.normalScale.set(.7,.7);}}});
  const slide=pistol.getObjectByName('slide'),slideRest=slide?.position.clone();
  // Valve's muzzle2 attachment from the original USP secondary skeleton.
  // Its local X follows the bore; the mesh's visual bounds include the silencer.
  const offset=pistol.getObjectByName('weapon_offset'),muzzle=new THREE.Object3D();muzzle.name='muzzle2';
  muzzle.position.set(.3267139,.000094111,.021199116);offset.add(muzzle);root.updateMatrixWorld(true);
  const boreOrigin=muzzle.getWorldPosition(new THREE.Vector3()),boreDirection=new THREE.Vector3(1,0,0).transformDirection(offset.matrixWorld);
  const aim=createBoreAim(root,boreOrigin,boreDirection);
  return{root,muzzle,boreOrigin,boreDirection,aimAt:aim,fire(){},update(dt,recoil){if(slide){slide.position.copy(slideRest);slide.position.x-=recoil*.024;}}};
}

/** Rotate the complete, rigid viewmodel so its bore intersects a camera-space point. */
export function createBoreAim(root,origin,direction){
  const muzzle=new THREE.Vector3(),desired=new THREE.Vector3(),roll=new THREE.Quaternion().setFromAxisAngle(direction,.035);
  return point=>{
    // The muzzle is offset from the model pivot. Solve around that offset rather
    // than simply pointing the root at the crosshair, which leaves parallax error.
    for(let i=0;i<6;i++){
      muzzle.copy(origin).applyQuaternion(root.quaternion).add(root.position);
      desired.copy(point).sub(muzzle).normalize();
      root.quaternion.setFromUnitVectors(direction,desired).multiply(roll);
    }
  };
}
