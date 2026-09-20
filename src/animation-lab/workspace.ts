import type {CharacterConfig} from '../schema/types';
import {effectiveStats} from '../core/combatRules';
import './workspace.css';

const esc=(s:unknown)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function mountWorkspace(pauseMotion:()=>void):void {
  const motion=document.querySelector<HTMLElement>('main')!;
  const nav=document.createElement('nav');nav.className='studio-nav';nav.setAttribute('aria-label','Studio workspace');
  nav.innerHTML=`<div class="studio-tabs">${[['motion','Motion review'],['characters','Characters & assets'],['combat','Combat & forms'],['pipeline','Pipeline & tools']].map(([id,label])=>`<button data-workspace="${id}" aria-pressed="false">${label}</button>`).join('')}</div><span id="cms-connection">CMS · CHECKING</span>`;
  document.querySelector('.masthead')!.after(nav);
  const panel=document.createElement('section');panel.className='workspace-panel';panel.hidden=true;
  panel.innerHTML=`<div id="cms-panel" hidden><div class="workspace-heading"><div><p class="eyebrow">AUTHOR / GENERATE / SHIP</p><h1>Character studio<span>.</span></h1><p>Drafts, frame editing, generation, QA, publishing and activity — one workbench.</p></div><button id="retry-cms" class="button">Reconnect CMS</button></div><p id="cms-error" class="workspace-notice" hidden>CMS is offline. Run <code>npm run cms:admin</code>, then reconnect. Motion review and published combat data remain available.</p><iframe id="cms-frame" title="Character CMS workbench" hidden></iframe></div><div id="combat-panel" hidden><div class="workspace-heading"><div><p class="eyebrow">SYSTEMS / ROUTES / IDENTITY</p><h1>Combat lab<span>.</span></h1><p>Inspect the exact published rules. Forms are complete character subsets, never costume overrides.</p></div><label class="fighter-picker">FIGHTER<select id="combat-fighter" aria-label="Combat fighter"></select></label></div><div id="combat-detail">Loading published fighters…</div></div>`;
  nav.after(panel);
  const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
  let active='motion',loaded=false,online=false;let roster:CharacterConfig[]=[];
  const frame=$<HTMLIFrameElement>('cms-frame');
  async function health(){
    try{const r=await fetch('/api/status',{signal:AbortSignal.timeout(5000)});const h=await r.json();online=r.ok&&h.service==='thousand-fighters-cms';}catch{online=false;}
    $('cms-connection').textContent=online?'CMS · CONNECTED':'CMS · OFFLINE';$('cms-connection').classList.toggle('online',online);
    $('cms-error').hidden=online;frame.hidden=!online;
    if(online&&(active==='characters'||active==='pipeline'))loadCms();
  }
  function loadCms(){
    if(frame.dataset.route){frame.contentWindow?.postMessage({type:'studio-workspace',workspace:active},location.origin);return;}
    const selected=new URLSearchParams(location.search).get('character');
    const safe=selected&&/^[a-z][a-z0-9_]{2,}$/.test(selected)?selected:null;
    const path=active==='pipeline'?'/pipeline':safe?`/roster/${safe}`:'/roster';
    const next=`/cms-admin${path}`;
    if(frame.dataset.route!==next){frame.src=next;frame.dataset.route=next;}
  }
  function choose(id:string,push=true){
    if(!['motion','characters','combat','pipeline'].includes(id))id='motion';
    if(active==='combat'&&id!=='combat'){const preview=$<HTMLIFrameElement>('combat-preview');if(preview){preview.removeAttribute('src');preview.hidden=true;}}
    active=id;motion.hidden=id!=='motion';panel.hidden=id==='motion';$('cms-panel').hidden=!['characters','pipeline'].includes(id);$('combat-panel').hidden=id!=='combat';
    nav.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.workspace===id)));
    if(id!=='motion')pauseMotion();
    if(push){const url=new URL(location.href);url.searchParams.set('workspace',id);history.pushState(null,'',url);}
    if(id==='characters'||id==='pipeline'){if(online)loadCms();else void health();}
    if(id==='combat'&&!loaded)void loadCombat();
  }
  async function loadCombat(){
    try{const r=await fetch('/oddities-roster.json');if(!r.ok)throw new Error('Published roster unavailable');roster=await r.json();loaded=true;
      $('combat-fighter').innerHTML=roster.map(f=>`<option value="${esc(f.id)}">${esc(f.displayName)}</option>`).join('');
      $<HTMLSelectElement>('combat-fighter').value='brine';renderCombat();
    }catch(e){$('combat-detail').textContent=String(e);}
  }
  function renderCombat(){
    const f=roster.find(f=>f.id===$<HTMLSelectElement>('combat-fighter').value)!;
    const stats=effectiveStats(f.stats);const forms=f.forms??[];
    const effects=f.moves.flatMap(m=>m.phases.flatMap(p=>p.events.flatMap(({event})=>'projectile' in event&&event.projectile.impact?[event.projectile]:[])));
    $('combat-detail').innerHTML=`<div class="combat-overview"><div class="combat-portrait"><img src="/fighters/${esc(f.id)}/portrait.png" alt="${esc(f.displayName)}"><div><p class="eyebrow">${esc(f.concept?.role??'Fighter')}</p><h2>${esc(f.displayName)}</h2><p>${esc(f.concept?.biography??'')}</p></div></div><div class="combat-stats">${Object.entries(stats).map(([key,value])=>`<div><span>${esc(key.replace(/([A-Z])/g,' $1'))}</span><strong>${value.toFixed(2)}<small>×</small></strong></div>`).join('')}</div></div>
    <div class="combat-grid"><section><p class="eyebrow">BRANCHING HIT-CONFIRM ROUTES</p><h2>Make the next hit count.</h2>${(f.comboRoutes??[]).map(r=>`<article class="combo-route"><h3>${esc(r.name)}</h3><div>${r.moves.map(id=>`<span>${esc(f.moves.find(m=>m.id===id)?.displayName??id)}</span>`).join('<b aria-hidden="true">→</b>')}</div><p>${esc(r.purpose)}</p></article>`).join('')}<p class="workspace-note">Routes cancel on a confirmed hit, not on whiff or block. Damage scales toward 30%; air juggles and total combo length are capped. These are route recipes, not guaranteed hits at every distance.</p></section>
    <section><p class="eyebrow">PERSISTENT CHARACTER SUBSETS</p><h2>New form. Whole moveset.</h2>${forms.length?forms.map(form=>`<article class="form-card"><img src="/forms/${esc(form.id)}/portrait.png" alt="${esc(form.name)}"><div><h3>${esc(form.name)}</h3><p>${form.durationTicks===null?'Until KO':`${form.durationTicks/60} seconds`} · ${form.cost} meter · Q to transform</p><p>${form.config.moves.length} moves · independent sprite pack · not selectable</p><a href="/forms/${esc(form.id)}/config.json" download>Form config ↓</a><details><summary>Inspect form moves and poses</summary><p>${form.config.moves.map(m=>esc(m.displayName)).join(' / ')}</p><img class="form-sheet" src="/forms/${esc(form.id)}/poses.png" alt="Eight distinct transformation poses"></details></div></article>`).join(''):'<p class="workspace-note">No authored form for this fighter yet. The runtime supports complete hidden subsets with timed or until-KO lifetimes.</p>'}<h3>Power-up</h3>${(f.powerUps??[]).map(p=>`<p>${esc(p.name)} · E · ${p.cost} meter · ${p.durationTicks===null?'until KO':p.durationTicks/60+'s'}</p><p class="workspace-note">${Object.entries(p.modifiers).map(([s,v])=>`${esc(s)} ×${v}`).join(' · ')}. Reapplication refreshes; it does not stack.</p>`).join('')}</section></div>
    <section class="impact-library"><p class="eyebrow">PROJECTILE COMPANION EFFECTS</p><h2>Every contact has a signature.</h2><div>${effects.map(p=>`<article style="--impact:#${p.impact!.color.toString(16).padStart(6,'0')}"><span class="impact-symbol">✳</span><h3>${esc(p.id)}</h3><p>${esc(p.impact!.kind)} · ${p.impact!.durationTicks} ticks</p><small>${esc(p.impact!.id)}</small></article>`).join('')}</div></section>
    <section class="combat-play"><div><h2>Put the rules in motion.</h2><p>Shift: dash · W then ↓ + Shift: wavedash · E: power-up · Q: transform (Brine / Taffy). F/G/H attack, ↓ + G launches. P2: N dash, O power, U transform.</p><p class="workspace-note">Power and form changes are separate from the move state. Getting hit, landing, or finishing an attack never restores base art.</p><button id="launch-combat" class="button">Launch live arena ↓</button> <a class="button" href="/?p1=${esc(f.id)}&p2=meridian&cpu=on" target="_blank" rel="noreferrer">Open full arena ↗</a></div><iframe id="combat-preview" title="Live combat preview" hidden></iframe></section>`;
    $('launch-combat').onclick=()=>{const preview=$<HTMLIFrameElement>('combat-preview');preview.src=`/?p1=${f.id}&p2=meridian&cpu=on`;preview.hidden=false;preview.scrollIntoView({behavior:'smooth'});};
  }
  $('combat-fighter').onchange=renderCombat;
  $('retry-cms').onclick=()=>void health();
  nav.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.onclick=()=>choose(b.dataset.workspace!));
  window.addEventListener('popstate',()=>choose(new URLSearchParams(location.search).get('workspace')??'motion',false));
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||event.source!==frame.contentWindow||event.data?.type!=='studio-character'||!/^[a-z][a-z0-9_]{2,}$/.test(event.data.characterId))return;
    const url=new URL(location.href);url.searchParams.set('character',event.data.characterId);history.replaceState(null,'',url);
  });
  choose(new URLSearchParams(location.search).get('workspace')??'motion',false);void health();
}
