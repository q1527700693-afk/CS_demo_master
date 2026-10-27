// Imported only by the standalone entry; embedding never takes over the host SW.
if('serviceWorker' in navigator&&window.isSecureContext){
  navigator.serviceWorker.register(new URL('../sw.js',import.meta.url),{scope:new URL('../',import.meta.url).pathname}).then(async registration=>{
    await navigator.serviceWorker.ready;await registration.update().catch(()=>{});
    let aimRequested=false,aimCached=false;
    navigator.serviceWorker.addEventListener('message',event=>{if(event.data?.type==='aim-cached')aimCached=true;if(event.data?.type==='aim-cache-failed')aimRequested=false;});
    const timer=setInterval(async()=>{
      const trainer=document.querySelector('vector-trainer');if(!trainer?.config)return;
      const cache=await caches.open('vector-standalone-v7-transparent-wall-decals');
      const coreReady=!!await cache.match(new URL('./app.js',import.meta.url));
      const reaction=trainer.config.mode==='reaction';
      if(!reaction&&trainer.graphics?.assetsReady&&!aimRequested){const worker=registration.active;if(worker){aimRequested=true;worker.postMessage({type:'cache-aim'});}}
      const ready=coreReady&&(reaction||aimCached);
      if(window.vectorOfflineReady!==ready){window.vectorOfflineReady=ready;window.dispatchEvent(new Event('vector-offline-ready'));}
    },200);
    window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
  }).catch(()=>{});
}
