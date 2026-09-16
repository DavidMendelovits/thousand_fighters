import type { CharacterConfig } from '../schema/types';
import './style.css';

const root = document.querySelector<HTMLDivElement>('#roster-app')!;
root.innerHTML = `<header><a class="wordmark" href="/">THOUSAND FIGHTERS<span>COMBAT COLLECTION / 01</span></a><nav><a href="/animation-lab.html">Animation lab ↗</a><a href="/?select=1">All fighters ↗</a></nav></header>
<main><section class="intro"><p class="eyebrow">TEN ORIGINAL FIGHTERS · PLAYABLE PROTOTYPE</p><h1>The Oddities<span>.</span></h1><p class="lede">Wrong-shaped heroes. Unfair-looking limbs. Very real hitboxes.</p><div class="legend"><span>↗ EXTEND</span><span>◎ CAPTURE</span><span>ϟ STUN</span><span>↠ LAUNCH</span></div></section>
<section class="matchup" aria-label="Match setup"><div class="slot-switch"><button id="slot1" aria-pressed="true">01 / YOUR FIGHTER</button><button id="slot2" aria-pressed="false">02 / OPPONENT</button></div><div class="matchline"><p id="versus"></p><label><input id="cpu" type="checkbox" checked> CPU opponent</label><a id="fight" class="primary" href="/">Enter the arena ↗</a></div></section>
<section id="cards" class="cards" aria-label="Ten-person roster"></section>
<section id="dossier" class="dossier" aria-live="polite"></section>
<section class="how"><div><p class="eyebrow">THE RULES BENEATH THE WEIRD</p><h2>Not every hit is a hit.</h2></div><div><h3>Grab & release</h3><p>Captures lock the victim to a hold or pull trajectory, then release with throw velocity. Hitting the grabber breaks the hold.</p><h3>Read the warning</h3><p>Ground, sky, and rear summons mark a location before becoming active. They do not track you after the cast.</p></div><div><h3>Fight back</h3><p>A / D move, W jumps, S crouches. F punches, G kicks, H performs the signature. S + H uses the second special. F + G grabs. Hold away to guard.</p><p class="muted">P2: arrows + J / K / L. Esc pauses. Art is a prototype: generated key poses, with video-derived signature clips where marked.</p></div></section>
<section id="replay" hidden><p class="eyebrow">ENGINE CAPTURE · NOT GENERATED VIDEO</p><h2>Brine vs. Madame Meridian</h2><p>Recorded from the actual Phaser fight scene. Input-driven choreography; collisions, captures, damage, and releases are resolved by the engine.</p><video controls preload="metadata" playsinline src="/replays/oddities-brine-v-meridian.mp4"></video></section></main><footer>60 HZ SIMULATION / ORIGINAL CAST / NO COOKIE CUTTERS</footer>`;

let fighters: CharacterConfig[] = [];
let selected = ['brine', 'meridian'];
let slot = 0;
let inspected = 'brine';
const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function render() {
  const fighter = fighters.find(f => f.id === inspected)!;
  $('#versus').textContent = `${fighters.find(f=>f.id===selected[0])!.displayName}  /  ${fighters.find(f=>f.id===selected[1])!.displayName}`;
  $('#slot1').setAttribute('aria-pressed', String(slot === 0));
  $('#slot2').setAttribute('aria-pressed', String(slot === 1));
  $<HTMLAnchorElement>('#fight').href = `/?p1=${selected[0]}&p2=${selected[1]}&cpu=${$<HTMLInputElement>('#cpu').checked ? 'on' : 'off'}`;
  $('#cards').innerHTML = fighters.map((f,i) => `<button class="card ${f.id===inspected?'active':''}" data-id="${esc(f.id)}" aria-label="Select ${esc(f.displayName)} for player ${slot+1}" style="--accent:${f.concept!.accent}"><span class="card-index">${String(i+1).padStart(2,'0')}</span><span class="assignment">${selected[0]===f.id?'P1 ':''}${selected[1]===f.id?'P2':''}</span><img src="/fighters/${f.id}/portrait.png" alt="${esc(f.displayName)} pixel-art fighter"><strong>${esc(f.displayName)}</strong><span class="role">${esc(f.concept!.role)}</span><span class="tag">${esc(f.concept!.tags[0])}</span></button>`).join('');
  $('#dossier').innerHTML = `<div class="identity" style="--accent:${fighter.concept!.accent}"><p class="eyebrow">FIELD NOTES / ${esc(fighter.concept!.role)}</p><h2>${esc(fighter.displayName)}</h2><p>${esc(fighter.concept!.biography)}</p><p class="counter"><b>Counterplay</b> ${esc(fighter.concept!.counterplay)}</p><a href="/fighters/${fighter.id}/moveset.json" download>Download moveset ↓</a></div><div class="moves">${fighter.moves.map(m=>`<article><kbd>${esc(m.inputLabel??'')}</kbd><div><h3>${esc(m.displayName)}</h3><p>${esc(m.description || 'A fast grounded normal to check an approaching opponent.')}</p><small>${m.phases.map(p=>`${p.frames}f ${p.name}`).join(' / ')}${m.animation==='video_signature'?' · VIDEO-DERIVED':''}</small></div></article>`).join('')}</div>`;
  $('#cards').querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.onclick=()=>{selected[slot]=b.dataset.id!;inspected=b.dataset.id!;render();});
}
$('#slot1').onclick=()=>{slot=0;inspected=selected[0];render();};
$('#slot2').onclick=()=>{slot=1;inspected=selected[1];render();};
$('#cpu').onchange=render;
try {
  const response=await fetch('/oddities-roster.json');
  if(!response.ok)throw new Error(`Roster unavailable (${response.status})`);
  fighters=await response.json();render();
  const video=await fetch('/replays/oddities-brine-v-meridian.mp4',{method:'HEAD'});
  if(video.ok && video.headers.get('content-type')?.includes('video')) $('#replay').hidden=false;
} catch(error) { $('#cards').textContent=String(error); }
