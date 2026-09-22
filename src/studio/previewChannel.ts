type Command = {type:string; [key:string]:unknown};
// Navigation token + child-owned origin allowlist -> hello -> ready -> commands.
// A query parameter selects an allowed parent; it cannot grant new trust.
export function createPreviewChannel(){
  const params=new URLSearchParams(location.search);
  const allowed=new Set([location.origin,...String(import.meta.env.VITE_STUDIO_PARENT_ORIGINS??'').split(',').map(s=>s.trim()).filter(Boolean)]);
  if(import.meta.env.DEV)allowed.add(`${location.protocol}//${location.hostname}:8787`);
  const requested=params.get('studioParent')??location.origin;
  const token=params.get('studioSession');
  const enabled=window.parent!==window&&Boolean(token)&&allowed.has(requested);
  let handshake=false,ready=false;
  const listeners=new Set<(data:Command)=>void>();
  const post=(data:Command)=>{if(enabled&&handshake)window.parent.postMessage({...data,studioSession:token},requested);};
  const message=(event:MessageEvent)=>{
    if(!enabled||event.source!==window.parent||event.origin!==requested||event.data?.studioSession!==token)return;
    if(event.data.type==='studio-preview-hello'){
      handshake=true;post({type:'studio-preview-ack'});if(ready)post({type:'studio-preview-ready'});return;
    }
    if(!handshake||!ready||typeof event.data.type!=='string')return;
    for(const listener of listeners)try{listener(event.data);}catch(error){post({type:'studio-preview-error',message:error instanceof Error?error.message:String(error)});}
  };
  window.addEventListener('message',message);
  const pagehide=(event:PageTransitionEvent)=>{
    if(event.persisted)return;
    window.removeEventListener('message',message);window.removeEventListener('pagehide',pagehide);listeners.clear();
  };
  window.addEventListener('pagehide',pagehide);
  return {post,ready(){ready=true;post({type:'studio-preview-ready'});},onCommand(listener:(data:Command)=>void){listeners.add(listener);return ()=>listeners.delete(listener);}};
}
