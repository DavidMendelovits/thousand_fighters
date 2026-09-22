import './workspace.css';

export function mountWorkspace(pauseMotion:()=>void):void {
  const motion=document.querySelector<HTMLElement>('main')!;
  const nav=document.createElement('nav');nav.className='studio-nav';nav.setAttribute('aria-label','Studio workspace');
  nav.innerHTML='<div class="studio-tabs"><button data-workspace="characters">Character workbench</button><button data-workspace="motion">Clip library</button><button data-workspace="pipeline">Pipeline & tools</button></div><span id="cms-connection" role="status">CMS · CHECKING</span>';
  document.querySelector('.masthead')!.after(nav);
  const panel=document.createElement('section');panel.className='workspace-panel';
  panel.innerHTML='<div id="cms-panel"><p id="cms-error" class="workspace-notice" role="alert" hidden>CMS is unavailable. Check that the local CMS is running, then <button id="retry-cms" class="button">Reconnect CMS</button>.</p><iframe id="cms-frame" title="Character CMS workbench" hidden></iframe></div>';
  nav.after(panel);
  const frame=panel.querySelector<HTMLIFrameElement>('iframe')!;
  const error=panel.querySelector<HTMLElement>('#cms-error')!;
  const connection=nav.querySelector<HTMLElement>('#cms-connection')!;
  let active='characters',online=false;
  const requested=()=>new URLSearchParams(location.search).get('workspace')??(location.pathname.includes('workbench')?'characters':new URLSearchParams(location.search).has('clip')?'motion':'characters');
  function loadCms(){
    if(frame.hasAttribute('src')){frame.contentWindow?.postMessage({type:'studio-workspace',workspace:active},location.origin);return;}
    const selected=new URLSearchParams(location.search).get('character');
    const safe=selected&&/^[a-z][a-z0-9_-]{2,}$/.test(selected)?selected:null;
    frame.src=`/cms-admin${safe?`/roster/${safe}`:active==='pipeline'?'/pipeline':'/roster'}`;
    const move=new URLSearchParams(location.search).get('move');
    if(move)frame.src+=`?move=${encodeURIComponent(move)}`;
  }
  async function health(){
    connection.textContent='CMS · CONNECTING';
    try{const response=await fetch('/api/status',{signal:AbortSignal.timeout(5000)});const status=await response.json();online=response.ok&&status.service==='thousand-fighters-cms';}catch{online=false;}
    connection.textContent=online?'CMS · CONNECTED':'CMS · OFFLINE';connection.classList.toggle('online',online);error.hidden=online;frame.hidden=!online;
    if(online&&active!=='motion')loadCms();
  }
  function choose(id:string,push=true){
    active=['characters','motion','pipeline','combat'].includes(id)?id:'characters';
    motion.hidden=active!=='motion';panel.hidden=active==='motion';
    nav.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.workspace===(active==='combat'?'characters':active))));
    if(active!=='motion')pauseMotion();
    if(push){const url=new URL(location.href);url.searchParams.set('workspace',active);url.searchParams.delete('clip');history.pushState(null,'',url);}
    if(active==='motion')frame.contentWindow?.postMessage({type:'studio-workspace',workspace:'motion'},location.origin);
    else if(online)loadCms();else void health();
  }
  panel.querySelector<HTMLButtonElement>('#retry-cms')!.onclick=()=>void health();
  nav.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.onclick=()=>choose(b.dataset.workspace!));
  window.addEventListener('popstate',()=>choose(requested(),false));
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||event.source!==frame.contentWindow)return;
    if(event.data?.type==='studio-character'&&/^[a-z][a-z0-9_-]{2,}$/.test(event.data.characterId)){
      const url=new URL(location.href);url.searchParams.set('character',event.data.characterId);url.searchParams.delete('clip');history.replaceState(null,'',url);
      if(active==='combat'||active==='pipeline')frame.contentWindow?.postMessage({type:'studio-workspace',workspace:active},location.origin);
    }
  });
  choose(requested(),false);
}
