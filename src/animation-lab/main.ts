import { evaluateAnimationClip, parseAnimationClip, type AnimationClip } from '../../shared/animationClip';
import './style.css';
import {mountWorkspace} from './workspace';
import {createPreviewChannel} from '../studio/previewChannel';
const previewChannel=createPreviewChannel();

type GalleryEntry = { id: string; name: string; description: string; url: string; tags: string[] };
type ClipBounds = { minX: number; minY: number; maxX: number; maxY: number };
type LoadedClip = { clip: AnimationClip; url: string; images: Map<string, HTMLImageElement>; rootBounds: ClipBounds; poseBounds: ClipBounds; artBounds: ClipBounds; movingArtBounds: ClipBounds };
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header class="masthead">
    <a class="brand" href="/" aria-label="Thousand Fighters home"><span class="brand-mark" aria-hidden="true">TF</span><span>THOUSAND<br>FIGHTERS</span></a>
    <div class="workspace"><span class="status-dot"></span> MOTION WORKSPACE <span class="version">/ 01</span></div>
    <a class="game-link" href="/roster">Play the Oddities <span aria-hidden="true">↗</span></a>
  </header>
  <main>
    <section class="page-heading"><div><div class="eyebrow">FROM MOTION TO MOVESET</div><h1>Animation lab<span>.</span></h1><p>Inspect every pose. Keep the motion that matters.</p></div><button class="button open-button" id="open-clip"><span aria-hidden="true">↗</span> Open clip</button></section>
    <section class="gallery-section" aria-label="Clip library"><div class="section-label"><span>CLIP LIBRARY</span><span id="library-count">LOADING</span></div><div id="gallery" class="gallery"><p class="library-empty">Loading the clip library…</p></div></section>
    <div id="load-status" class="load-status" role="status" aria-live="polite"></div>
    <section class="studio" aria-label="Animation review studio">
      <div class="viewer">
        <div class="viewer-header"><div class="clip-heading"><span class="clip-index" id="clip-index">01</span><div><h2 id="clip-title">Choose a clip</h2><span id="clip-subtitle">Canvas playback · Frame-accurate inspection</span></div></div><span class="source-badge" id="source-badge">NO CLIP</span></div>
        <div class="stage-toolbar"><div class="segmented" role="group" aria-label="Stage background"><button class="selected" data-background="grid" aria-label="Checker background" title="Checker background"><span class="checker-icon"></span></button><button data-background="dark" aria-label="Dark background" title="Dark background"><span class="swatch dark-swatch"></span></button><button data-background="light" aria-label="Light background" title="Light background"><span class="swatch light-swatch"></span></button></div><span class="stage-tool-label">STAGE</span><div class="zoom-control"><label for="zoom">VIEW</label><select id="zoom" aria-label="Canvas zoom"><option value="fit">Fit</option><option value="1">1× native</option><option value="2">2×</option><option value="4">4×</option><option value="8">8×</option></select></div></div>
        <div class="stage" id="stage" data-background="grid"><canvas id="animation-canvas" aria-label="Animation preview"></canvas><div class="stage-empty" id="stage-empty"><span aria-hidden="true">＋</span><strong>Your next move starts here.</strong><p>Choose a library clip or open a compiled clip.json.</p></div><div class="stage-top-note" id="stage-top-note">PIXEL-PERFECT PREVIEW</div><div class="stage-footer"><span id="canvas-size">— × — PX</span><span id="stage-frame">FRAME — / —</span></div></div>
        <div class="transport"><div class="playback-buttons"><button id="previous-frame" class="icon-button" aria-label="Previous frame" title="Previous frame (←)">‹</button><button id="play" class="play-button" aria-label="Play" title="Play / pause (Space)">▶</button><button id="next-frame" class="icon-button" aria-label="Next frame" title="Next frame (→)">›</button></div><div class="timecode"><span id="tick-readout">000</span><span class="timecode-divider">/</span><span id="tick-total">000</span><small>TICKS</small></div><div class="speed-control"><label for="speed">SPEED</label><select id="speed" aria-label="Playback speed"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div><span class="playback-mode" id="playback-mode">—</span></div>
        <div class="timeline-section"><div class="timeline-caption"><span>POSE TIMELINE</span><span id="source-frame">SOURCE —</span></div><div class="timeline" id="timeline"><div class="frame-strips" id="frame-strips"></div><input id="scrubber" type="range" min="0" max="1" value="0" step="1" aria-label="Scrub animation tick"><div class="playhead" id="playhead"></div></div><div class="events-track" id="events-track" aria-label="Animation events"></div><div class="timeline-scale"><span>0</span><span id="timeline-middle">—</span><span id="timeline-end">—</span></div></div>
        <div class="viewer-bottom"><span id="event-readout">No clip loaded</span><span class="keyboard-tip">SPACE play / pause <span>← →</span> step</span></div>
      </div>
      <aside class="inspector" aria-label="Clip inspector">
        <div class="inspector-heading"><h2>Inspector</h2><span class="small-square"></span></div>
        <section class="inspector-section"><div class="inspector-label">COMPOSITION <span id="layer-count">00</span></div><div id="layers" class="layers"><p class="muted">Layers appear here.</p></div></section>
        <section class="inspector-section"><div class="inspector-label">MOTION GUIDES</div><label class="toggle-row"><span>Anchor & sockets</span><input id="show-anchors" type="checkbox" checked><span class="switch" aria-hidden="true"></span></label><label class="toggle-row"><span>Apply root motion</span><input id="root-motion" type="checkbox"><span class="switch" aria-hidden="true"></span></label><p class="inspector-note" id="root-note">Load a clip to inspect motion.</p></section>
        <section class="inspector-section"><div class="inspector-label">CREATIVE INTENT</div><div id="intent" class="intent-tags"><span class="muted">—</span></div><p class="inspector-note">Intent marks permitted visual changes. It does not approve a clip for combat.</p></section>
        <section class="inspector-section qa-section"><div class="inspector-label">QUALITY REVIEW <span id="qa-count">—</span></div><div id="qa-status" class="qa-status">AWAITING CLIP</div><div id="qa-warnings"></div><details id="qa-details"><summary>Technical checks <span id="checks-count">0</span></summary><ul id="qa-checks" class="qa-checks"></ul></details></section>
        <section class="inspector-section provenance-section"><div class="inspector-label">SOURCE & PROVENANCE</div><p id="provenance" class="provenance-text">Every clip keeps its source and compilation history.</p><div id="downloads" class="downloads"></div></section>
      </aside>
    </section>
    <footer class="page-footer"><span><span class="status-dot"></span> 60 Hz timeline · Nearest-neighbor rendering</span><span>Movement first. Every pixel accountable.</span></footer>
  </main>
  <dialog id="open-dialog"><form id="load-form"><div class="dialog-heading"><h2>Open a clip</h2><button type="button" id="close-dialog" class="icon-button" aria-label="Close dialog">×</button></div><p>Load a compiled clip.json and its sprite layers. External hosts must allow cross-origin access.</p><label for="clip-url">CLIP URL</label><input id="clip-url" name="clip-url" type="text" placeholder="/animation-lab/acrobatics/clip.json" autocomplete="off" spellcheck="false" required><button type="submit" class="button dialog-submit">Load clip <span aria-hidden="true">↗</span></button></form></dialog>
`;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('animation-canvas');
const context = canvas.getContext('2d')!;
const stage = $('stage');
const scrubber = $<HTMLInputElement>('scrubber');
const playButton = $<HTMLButtonElement>('play');
const rootToggle = $<HTMLInputElement>('root-motion');
const anchorsToggle = $<HTMLInputElement>('show-anchors');
const zoomSelect = $<HTMLSelectElement>('zoom');
zoomSelect.insertAdjacentHTML('afterbegin','<option value="art">Fit artwork</option>');
zoomSelect.value='art';
const dialog = $<HTMLDialogElement>('open-dialog');
let loaded: LoadedClip | null = null;
let gallery: GalleryEntry[] = [];
let tick = 0;
let playing = false;
let speed = 1;
let lastTime: number | null = null;
let hiddenLayers = new Set<string>();
let loader: AbortController | null = null;
let viewWidth = 1;
let viewHeight = 1;
let lastReadoutTick = -1;

const escape = (value: unknown): string => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const pad = (value: number, digits = 3): string => String(value).padStart(digits, '0');
function assetUrl(path: string, base = window.location.href): string {
  const url = new URL(path, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP or HTTPS clip URL without credentials.');
  return url.href;
}

function setPlaying(value: boolean): void {
  playing = value && loaded !== null;
  lastTime = null;
  playButton.textContent = playing ? 'Ⅱ' : '▶';
  playButton.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  playButton.classList.toggle('playing', playing);
}

function setStatus(message: string, error = false): void {
  const status = $('load-status');
  status.textContent = message;
  status.classList.toggle('error', error);
  status.classList.toggle('visible', Boolean(message));
}

async function readJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Could not load ${new URL(url).pathname} (HTTP ${response.status}).`);
  const text = await response.text();
  if (text.length > 4_000_000) throw new Error('Clip manifest exceeds the 4 MB review limit.');
  try { return JSON.parse(text); } catch { throw new Error('Expected a JSON manifest. This URL returned another file or a missing-page response.'); }
}

function loadImage(url: string, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const cleanup = (): void => { signal.removeEventListener('abort', abort); image.onload = null; image.onerror = null; };
    const abort = (): void => { cleanup(); image.src = ''; reject(new DOMException('Cancelled', 'AbortError')); };
    image.onload = () => {
      cleanup();
      if (image.width * image.height > 100_000_000) { reject(new Error('Sprite sheet exceeds the 100 megapixel review limit.')); return; }
      resolve(image);
    };
    image.onerror = () => { cleanup(); reject(new Error(`Could not load sprite sheet ${new URL(url).pathname}. Check the file and CORS settings.`)); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    image.src = url;
  });
}

/** Stable camera bounds across ALL poses: ignore transparent padding without
 * cropping/repositioning the source art or pumping the zoom frame to frame. */
function artworkBounds(clip:AnimationClip,images:Map<string,HTMLImageElement>,withRoot:boolean):ClipBounds {
  const bounds={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
  const scratch=document.createElement('canvas');scratch.width=clip.canvas.width;scratch.height=clip.canvas.height;
  const ctx=scratch.getContext('2d',{willReadFrequently:true})!;
  for(const layer of clip.layers){
    const seen=new Map<string,ClipBounds>();
    for(const frame of layer.frames){
      const key=`${frame.x}:${frame.y}`;
      let local=seen.get(key);
      if(!local){
        ctx.clearRect(0,0,scratch.width,scratch.height);
        ctx.drawImage(images.get(layer.id)!,frame.x,frame.y,frame.width,frame.height,0,0,frame.width,frame.height);
        const pixels=ctx.getImageData(0,0,frame.width,frame.height).data;
        local={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
        for(let y=0;y<frame.height;y++)for(let x=0;x<frame.width;x++)if(pixels[(y*frame.width+x)*4+3]>0){local.minX=Math.min(local.minX,x);local.minY=Math.min(local.minY,y);local.maxX=Math.max(local.maxX,x+1);local.maxY=Math.max(local.maxY,y+1);}
        seen.set(key,local);
      }
      const x=(frame.offset?.x??0)+(withRoot?frame.rootMotion.x:0),y=(frame.offset?.y??0)+(withRoot?frame.rootMotion.y:0);
      bounds.minX=Math.min(bounds.minX,local.minX+x);bounds.minY=Math.min(bounds.minY,local.minY+y);
      bounds.maxX=Math.max(bounds.maxX,local.maxX+x);bounds.maxY=Math.max(bounds.maxY,local.maxY+y);
    }
  }
  return Number.isFinite(bounds.minX)?bounds:{minX:0,minY:0,maxX:clip.canvas.width,maxY:clip.canvas.height};
}

async function openClip(path: string): Promise<void> {
  loader?.abort();
  const controller = new AbortController();
  loader = controller;
  setPlaying(false);
  setStatus('Loading clip and sprite layers…');
  try {
    const url = assetUrl(path);
    const clip = parseAnimationClip(await readJson(url, controller.signal));
    const images = new Map<string, HTMLImageElement>();
    await Promise.all(clip.layers.map(async layer => {
      const image = await loadImage(assetUrl(layer.sheet, url), controller.signal);
      for (const frame of layer.frames) {
        if (frame.x + frame.width > image.width || frame.y + frame.height > image.height) throw new Error(`Layer “${layer.id}” has a frame outside its sprite sheet.`);
      }
      images.set(layer.id, image);
    }));
    if (controller.signal.aborted) return;
    const rootBounds = { minX: 0, minY: 0, maxX: clip.canvas.width, maxY: clip.canvas.height };
    const poseBounds = {...rootBounds};
    for (const layer of clip.layers) for (const frame of layer.frames) {
      const x = frame.offset?.x ?? 0, y = frame.offset?.y ?? 0;
      poseBounds.minX = Math.min(poseBounds.minX,x);poseBounds.minY = Math.min(poseBounds.minY,y);
      poseBounds.maxX = Math.max(poseBounds.maxX,x+clip.canvas.width);poseBounds.maxY = Math.max(poseBounds.maxY,y+clip.canvas.height);
      rootBounds.minX = Math.min(rootBounds.minX, x+frame.rootMotion.x);
      rootBounds.minY = Math.min(rootBounds.minY, y+frame.rootMotion.y);
      rootBounds.maxX = Math.max(rootBounds.maxX, x+frame.rootMotion.x + clip.canvas.width);
      rootBounds.maxY = Math.max(rootBounds.maxY, y+frame.rootMotion.y + clip.canvas.height);
    }
    const artBounds=artworkBounds(clip,images,false);
    const movingArtBounds=clip.rootMode==='extract'?artworkBounds(clip,images,true):artBounds;
    loaded = { clip, url, images, rootBounds, poseBounds, artBounds, movingArtBounds };
    tick = 0;
    hiddenLayers = new Set();
    rootToggle.checked = false;
    lastReadoutTick = -1;
    renderClipInfo();
    const address = new URL(window.location.href);
    address.searchParams.set('clip', new URL(url).origin === location.origin ? new URL(url).pathname + new URL(url).search : url);
    history.replaceState(null, '', address);
    setStatus('');
    previewChannel.ready();
    setPlaying(!document.querySelector('main')?.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    draw();
  } catch (error) {
    if (controller.signal.aborted) return;
    setStatus((error as Error).message, true);
    // Failed replacement leaves the previously loaded clip reviewable.
  }
}

function renderGallery(): void {
  $('library-count').textContent = `${pad(gallery.length, 2)} CLIPS`;
  $('gallery').innerHTML = gallery.length ? gallery.map((entry, index) => `
    <button class="clip-card" data-clip-index="${index}" aria-pressed="false">
      <div class="clip-card-number">${pad(index + 1, 2)}<span aria-hidden="true">↗</span></div>
      <div class="clip-card-title">${escape(entry.name)}</div><p>${escape(entry.description)}</p>
      <div class="clip-card-tags">${entry.tags.map(tag => `<span>${escape(tag)}</span>`).join('')}</div>
    </button>`).join('') : '<p class="library-empty">The demo library is not available yet. Open a compiled clip.json to begin.</p>';
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-clip-index]')) {
    button.addEventListener('click', () => void openClip(gallery[Number(button.dataset.clipIndex)].url));
  }
}

function renderClipInfo(): void {
  if (!loaded) return;
  const { clip, url } = loaded;
  const index = gallery.findIndex(entry => assetUrl(entry.url) === url);
  $('clip-index').textContent = index >= 0 ? pad(index + 1, 2) : '↗';
  $('clip-title').textContent = clip.displayName;
  $('clip-subtitle').textContent = `${clip.kind.replaceAll('_', ' ')} / ${clip.layers[0].frames.length} poses / ${(clip.totalTicks / clip.tickRate).toFixed(2)}s`;
  const fixture = clip.provenance.method === 'procedural-fixture';
  $('source-badge').textContent = fixture ? 'PROCEDURAL DEMO' : clip.provenance.method === 'generated-video' ? 'GENERATED VIDEO' : clip.provenance.method.replaceAll('-', ' ').toUpperCase();
  $('source-badge').classList.toggle('generated', !fixture);
  $('stage-empty').hidden = true;
  $('canvas-size').textContent = `${clip.canvas.width} × ${clip.canvas.height} PX`;
  $('stage-top-note').textContent = fixture ? 'PROCEDURAL FIXTURE · NOT AI-GENERATED' : `${clip.provenance.method.replaceAll('-', ' ').toUpperCase()} · ${clip.qa.status === 'approved' ? 'APPROVED ROW' : 'REVIEW REQUIRED'}`;
  $('tick-total').textContent = pad(clip.totalTicks);
  $('playback-mode').textContent = `${clip.playback === 'loop' ? '↻' : '→'} ${clip.playback.toUpperCase()}`;
  $('layer-count').textContent = pad(clip.layers.length, 2);
  $('layers').innerHTML = [...clip.layers].sort((a, b) => b.z - a.z).map((layer, index) => `
    <label class="layer-row"><input type="checkbox" data-layer="${escape(layer.id)}" checked><span class="layer-icon layer-color-${index % 3}" aria-hidden="true">▱</span><span class="layer-text"><strong>${escape(layer.id)}</strong><small>${escape(layer.role)} <span>· ${layer.blend === 'add' ? 'additive' : 'normal'}</span></small></span><span class="layer-z">${layer.z}</span></label>`).join('');
  $('layers').querySelectorAll<HTMLInputElement>('input').forEach(input => input.addEventListener('change', () => {
    if (input.checked) hiddenLayers.delete(input.dataset.layer!); else hiddenLayers.add(input.dataset.layer!);
    draw();
  }));
  rootToggle.disabled = clip.rootMode !== 'extract';
  $('root-note').textContent = clip.rootMode === 'extract' ? 'Extracted displacement is available. Enable to follow the original travel path.' : clip.rootMode === 'baked' ? 'Motion is baked into the frames. Additional displacement is disabled.' : 'In-place clip. The anchor stays fixed for engine-controlled movement.';
  const flags = [
    { label: 'Body morphing', enabled: clip.intent.topologyChanges },
    { label: 'Scale changes', enabled: clip.intent.scaleChanges },
    { label: 'Palette shifts', enabled: clip.intent.paletteChanges },
  ];
  $('intent').innerHTML = flags.map(flag => `<span class="intent-tag ${flag.enabled ? 'enabled' : ''}"><span aria-hidden="true">${flag.enabled ? '✓' : '−'}</span> ${flag.label}</span>`).join('');
  const warnings = clip.qa.warnings;
  $('qa-status').textContent = clip.qa.status === 'rejected' ? '✕  REJECTED' : clip.qa.status === 'approved' ? '✓  APPROVED ROW' : '◷  NEEDS HUMAN REVIEW';
  $('qa-status').classList.toggle('rejected', clip.qa.status === 'rejected');
  $('qa-count').textContent = `${warnings.length} ${warnings.length === 1 ? 'NOTE' : 'NOTES'}`;
  $('qa-warnings').innerHTML = warnings.length ? `<ul class="warning-list">${warnings.map(warning => `<li>${escape(warning)}</li>`).join('')}</ul>` : '<p class="inspector-note">No automated warnings. Visual review is still required.</p>';
  $('checks-count').textContent = String(clip.qa.checks.length);
  $('qa-checks').innerHTML = clip.qa.checks.map(check => `<li class="check-${escape(check.status)}"><strong><span>${check.status === 'pass' ? '✓' : check.status === 'fail' ? '×' : '!'}</span>${escape(check.label)}</strong><p>${escape(check.detail)}</p></li>`).join('');
  $('provenance').textContent = fixture ? `Procedural fixture. ${clip.provenance.description ?? 'Built to exercise the clip compiler and renderer; not a generated-art quality benchmark.'}` : `${clip.provenance.method}. ${clip.provenance.description ?? 'Inspect the manifest for source and compilation details.'}`;
  $('downloads').innerHTML = `<a class="manifest-download" href="${escape(url)}" download="${escape(clip.id)}.clip.json" target="_blank" rel="noopener">Download clip.json <span aria-hidden="true">↓</span></a>`
    + (clip.provenance.compiler === 'animation-clip-v1' ? `<a href="${escape(assetUrl('runtime-fragment.json', url))}" download target="_blank" rel="noopener">Runtime fragment <span aria-hidden="true">↓</span></a>` : '')
    + clip.layers.map(layer => `<a href="${escape(assetUrl(layer.sheet, url))}" download target="_blank" rel="noopener">${escape(layer.id)} sheet <span aria-hidden="true">↗</span></a>`).join('');
  const frames = clip.layers[0].frames;
  let startTick = 0;
  $('frame-strips').innerHTML = frames.map((frame, frameIndex) => {
    const start = startTick; startTick += frame.durationTicks;
    return `<span class="frame-strip" data-frame="${frameIndex}" style="flex:${frame.durationTicks}" title="Pose ${frameIndex + 1} · tick ${start} · ${frame.durationTicks} ticks">${frames.length <= 24 ? pad(frameIndex + 1, 2) : ''}</span>`;
  }).join('');
  scrubber.max = String(clip.totalTicks - 1);
  scrubber.value = '0';
  $('timeline-middle').textContent = `${Math.floor(clip.totalTicks / 2)} T`;
  $('timeline-end').textContent = `${clip.totalTicks} T`;
  $('events-track').innerHTML = clip.events.map((event, i) => `<button class="event-marker event-${/hit|impact|release|spawn/.test(event.type) ? 'impact' : 'motion'}" data-event="${i}" style="left:${event.tick / clip.totalTicks * 100}%" aria-label="${escape(event.label)} at tick ${event.tick}" title="${escape(event.label)} · ${event.tick}t"><span aria-hidden="true">◆</span><span class="event-label">${escape(event.label)}</span></button>`).join('');
  $('events-track').querySelectorAll<HTMLButtonElement>('button').forEach(button => button.addEventListener('click', () => seek(clip.events[Number(button.dataset.event)].tick)));
  document.querySelectorAll<HTMLButtonElement>('[data-clip-index]').forEach(button => {
    const selected = Number(button.dataset.clipIndex) === index;
    button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected));
    if (selected) {
      const library = $('gallery');
      const relativeLeft = button.getBoundingClientRect().left - library.getBoundingClientRect().left + library.scrollLeft;
      library.scrollLeft = relativeLeft - (library.clientWidth - button.clientWidth) / 2;
    }
  });
}

function seek(next: number): void {
  if (!loaded) return;
  setPlaying(false);
  tick = Math.max(0, Math.min(loaded.clip.totalTicks - 1, next));
  draw();
}

function stepFrame(direction: -1 | 1): void {
  if (!loaded) return;
  const evaluation = evaluateAnimationClip(loaded.clip, tick);
  const frames = loaded.clip.layers[0].frames;
  const next = Math.max(0, Math.min(frames.length - 1, evaluation.frameIndex + direction));
  seek(frames.slice(0, next).reduce((sum, frame) => sum + frame.durationTicks, 0));
}

function togglePlay(): void {
  if (!loaded) return;
  if (!playing && tick >= loaded.clip.totalTicks - 1) tick = 0;
  setPlaying(!playing);
}

function draw(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, viewWidth, viewHeight);
  if (!loaded) return;
  const { clip, images } = loaded;
  const evaluation = evaluateAnimationClip(clip, tick);
  const rootEnabled = rootToggle.checked && clip.rootMode === 'extract';
  // Fit the complete trajectory, not just the stationary canvas: extracted
  // travel must remain inspectable on narrow screens without clipping.
  const requestedZoom = zoomSelect.value;
  const { minX, minY, maxX, maxY } = requestedZoom==='art'?(rootEnabled?loaded.movingArtBounds:loaded.artBounds):(rootEnabled ? loaded.rootBounds : loaded.poseBounds);
  const fit = Math.min((viewWidth - 64) / (maxX - minX), (viewHeight - 80) / (maxY - minY));
  const scale = requestedZoom === 'fit'||requestedZoom==='art' ? (fit >= 1 ? Math.max(1, Math.floor(fit)) : Math.max(0.01, fit)) : Number(requestedZoom);
  const left = Math.round((viewWidth - (maxX + minX) * scale) / 2);
  const top = Math.round((viewHeight - (maxY + minY) * scale) / 2);
  const light = stage.dataset.background === 'light';
  context.imageSmoothingEnabled = false;
  context.globalCompositeOperation = 'source-over';

  if (anchorsToggle.checked) {
    const anchorX = Math.round(left + clip.anchor.x * scale);
    const anchorY = Math.round(top + clip.anchor.y * scale);
    context.strokeStyle = light ? '#00000025' : '#ffffff18';
    context.lineWidth = 1;
    context.setLineDash([3, 5]);
    context.beginPath(); context.moveTo(24, anchorY + 0.5); context.lineTo(viewWidth - 24, anchorY + 0.5); context.stroke();
    context.beginPath(); context.moveTo(anchorX + 0.5, 35); context.lineTo(anchorX + 0.5, viewHeight - 35); context.stroke();
    context.setLineDash([]);
    if (rootEnabled) {
      context.strokeStyle = '#a7a0eb80'; context.beginPath();
      clip.layers[0].frames.forEach((frame, index) => {
        const x = anchorX + frame.rootMotion.x * scale; const y = anchorY + frame.rootMotion.y * scale;
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      });
      context.stroke();
    }
  }

  for (const { layer, frame } of evaluation.layers) {
    if (hiddenLayers.has(layer.id)) continue;
    const x = Math.round(left + ((frame.offset?.x ?? 0) + (rootEnabled ? frame.rootMotion.x : 0)) * scale);
    const y = Math.round(top + ((frame.offset?.y ?? 0) + (rootEnabled ? frame.rootMotion.y : 0)) * scale);
    context.globalCompositeOperation = layer.blend === 'add' ? 'lighter' : 'source-over';
    context.drawImage(images.get(layer.id)!, frame.x, frame.y, frame.width, frame.height, x, y, frame.width * scale, frame.height * scale);
    context.globalCompositeOperation = 'source-over';
    if (anchorsToggle.checked) {
      for (const [name, socket] of Object.entries(frame.sockets)) {
        const sx = x + socket.x * scale; const sy = y + socket.y * scale;
        context.fillStyle = '#f0c589'; context.fillRect(Math.round(sx) - 2, Math.round(sy) - 2, 4, 4);
        context.font = '10px ui-monospace, monospace'; context.fillText(name, sx + 7, sy - 5);
      }
    }
  }
  if (anchorsToggle.checked) {
    const root = evaluation.layers[0].frame.rootMotion;
    const ax = Math.round(left + (clip.anchor.x + (rootEnabled ? root.x : 0)) * scale);
    const ay = Math.round(top + (clip.anchor.y + (rootEnabled ? root.y : 0)) * scale);
    context.strokeStyle = light ? '#61561c' : '#e6e59a'; context.lineWidth = 1;
    context.beginPath(); context.moveTo(ax - 7, ay); context.lineTo(ax + 7, ay); context.moveTo(ax, ay - 7); context.lineTo(ax, ay + 7); context.stroke();
    context.fillStyle = context.strokeStyle; context.font = '10px ui-monospace, monospace'; context.fillText('ANCHOR', ax + 11, ay + 4);
  }

  if (lastReadoutTick !== evaluation.tick) {
    lastReadoutTick = evaluation.tick;
    $('tick-readout').textContent = pad(evaluation.tick);
    $('stage-frame').textContent = `FRAME ${pad(evaluation.frameIndex + 1, 2)} / ${pad(clip.layers[0].frames.length, 2)}`;
    $('source-frame').textContent = `SRC ${pad(evaluation.layers[0].frame.sourceFrame)} · ${clip.provenance.sourceTimingKnown === false ? 'TIME UNKNOWN' : Math.round(evaluation.layers[0].frame.sourceTimeMs) + ' MS'} · ${evaluation.layers[0].frame.durationTicks}T HOLD`;
    scrubber.value = String(evaluation.tick);
    $('playhead').style.left = `${evaluation.tick / clip.totalTicks * 100}%`;
    $('frame-strips').querySelectorAll<HTMLElement>('.frame-strip').forEach(strip => strip.classList.toggle('current', Number(strip.dataset.frame) === evaluation.frameIndex));
    const recentEvent = [...clip.events].filter(event => event.tick <= evaluation.tick).sort((a, b) => b.tick - a.tick)[0];
    $('event-readout').textContent = recentEvent ? `${recentEvent.label} · ${recentEvent.tick}t` : 'No event at this pose';
    $('event-readout').classList.toggle('event-active', evaluation.events.length > 0);
  }
}

new ResizeObserver(() => {
  const bounds = stage.getBoundingClientRect();
  viewWidth = bounds.width; viewHeight = bounds.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(viewWidth * dpr); canvas.height = Math.round(viewHeight * dpr);
  draw();
}).observe(stage);

function animate(time: number): void {
  if (playing && loaded) {
    if (lastTime !== null) {
      tick += Math.min(100, Math.max(0, time - lastTime)) / 1000 * loaded.clip.tickRate * speed;
      if (loaded.clip.playback === 'loop') tick %= loaded.clip.totalTicks;
      else if (tick >= loaded.clip.totalTicks) { tick = loaded.clip.totalTicks - 1; setPlaying(false); }
    }
    lastTime = time;
    draw();
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
document.addEventListener('visibilitychange', () => { lastTime = null; });

playButton.addEventListener('click', togglePlay);
$('previous-frame').addEventListener('click', () => stepFrame(-1));
$('next-frame').addEventListener('click', () => stepFrame(1));
scrubber.addEventListener('input', () => seek(Number(scrubber.value)));
$<HTMLSelectElement>('speed').addEventListener('change', event => { speed = Number((event.target as HTMLSelectElement).value); });
anchorsToggle.addEventListener('change', draw);
rootToggle.addEventListener('change', draw);
zoomSelect.addEventListener('change', draw);
document.querySelectorAll<HTMLButtonElement>('[data-background]').forEach(button => button.addEventListener('click', () => {
  stage.dataset.background = button.dataset.background;
  document.querySelectorAll('[data-background]').forEach(other => { if (other instanceof HTMLButtonElement) other.classList.toggle('selected', other === button); });
  draw();
}));
document.addEventListener('keydown', event => {
  if (dialog.open || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement || event.target instanceof HTMLAnchorElement) return;
  if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
  if (event.code === 'ArrowLeft') { event.preventDefault(); stepFrame(-1); }
  if (event.code === 'ArrowRight') { event.preventDefault(); stepFrame(1); }
});
$('open-clip').addEventListener('click', () => { $<HTMLInputElement>('clip-url').value = loaded?.url ?? ''; dialog.showModal(); });
$('close-dialog').addEventListener('click', () => dialog.close());
$('load-form').addEventListener('submit', event => { event.preventDefault(); const url = $<HTMLInputElement>('clip-url').value.trim(); if (!url) return; dialog.close(); void openClip(url); });

async function start(): Promise<void> {
  try {
    const response = await fetch('/animation-lab/index.json');
    if (response.ok) {
      const index = await response.json() as { clips?: GalleryEntry[] };
      if (Array.isArray(index.clips)) gallery = index.clips.filter(entry => {
        if (!entry || typeof entry.id !== 'string' || typeof entry.name !== 'string' || typeof entry.url !== 'string' || typeof entry.description !== 'string' || !Array.isArray(entry.tags) || !entry.tags.every(tag => typeof tag === 'string')) return false;
        try { assetUrl(entry.url); return true; } catch { return false; }
      });
    }
  } catch { /* The URL loader remains available without a library index. */ }
  renderGallery();
  const requested = new URLSearchParams(location.search).get('clip');
  const params=new URLSearchParams(location.search);
  if(params.get('embed')!=='1' && (location.pathname.includes('workbench') || (!requested&&params.get('workspace')!=='motion') || (params.get('workspace') && params.get('workspace')!=='motion')))return;
  if (requested) await openClip(requested);
  else if (gallery.length) await openClip(gallery[0].url);
}
void start();
if (new URLSearchParams(location.search).get('embed') === '1') document.body.classList.add('motion-embedded');
else mountWorkspace(()=>setPlaying(false));
let pausedByWorkbench=false, resumeWorkbenchMotion=false;
previewChannel.onCommand(data=>{
  if(data.type!=='studio-preview-visibility'||typeof data.visible!=='boolean')return;
  if(!data.visible){
    if(!pausedByWorkbench)resumeWorkbenchMotion=playing;
    pausedByWorkbench=true;setPlaying(false);
  }else if(pausedByWorkbench){pausedByWorkbench=false;setPlaying(resumeWorkbenchMotion);}
});
