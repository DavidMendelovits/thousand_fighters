import Phaser from 'phaser';
import type { SpriteSheetId } from '../schema/types';
import { loadGymData, type GymData } from './loadGymData';
import { GymScene, GYM_CANVAS, type BoundsMode } from './GymScene';
import { translateBoxesForAnchorDelta } from './anchorMath';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};

function showStatus(message: string, isError = false): void {
  const status = $('status');
  status.textContent = message;
  status.classList.toggle('error', isError);
  status.classList.add('on');
}
function hideStatus(): void {
  $('status').classList.remove('on');
}

// Move navigator grouping. Today the engine has exactly 5 sheets (A7); the
// navigator is built to scale but groups what exists.
const SHEET_GROUPS: { label: string; sheets: SpriteSheetId[] }[] = [
  { label: 'Base', sheets: ['base'] },
  { label: 'Normals', sheets: ['punch', 'kick'] },
  { label: 'Specials', sheets: ['special_1', 'special_2'] },
];
const SHEET_LABELS: Record<SpriteSheetId, string> = {
  base: 'Idle / base',
  punch: 'Punch',
  kick: 'Kick',
  special_1: 'Special 1',
  special_2: 'Special 2',
};

let scene: GymScene;
let data: GymData;
let dirty = false;
let characterId = '';
/** Anchors as last loaded/saved, per sheet — the baseline for the Δanchor box recompute (A1). */
let originalAnchors: Record<string, { x: number; y: number }[]> = {};

async function main(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const idParam = params.get('id');
  if (!idParam) {
    showStatus('No character id. Open as gym.html?id=<characterId>', true);
    return;
  }
  characterId = idParam;

  showStatus(`Loading ${characterId}…`);
  try {
    data = await loadGymData(characterId);
  } catch (error) {
    showStatus(
      `Failed to load "${characterId}": ${(error as Error).message}. Is the CMS admin server running (npm run cms:admin)?`,
      true,
    );
    return;
  }
  hideStatus();
  snapshotAnchors();

  $('char-name').textContent = data.config.displayName ?? characterId;
  document.title = `Gym · ${data.config.displayName ?? characterId}`;

  scene = new GymScene({
    characterId,
    scale: data.config.sprite?.scale ?? 1,
    frameUrls: data.frameUrls,
    frameData: data.frameData,
  });
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#141820',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: GYM_CANVAS.width, height: GYM_CANVAS.height },
    fps: { target: 60 },
    scene,
  });

  scene.onAnchorChange = (sheet, frame, anchor) => {
    if (sheet === currentSheet && frame === scene.getSnapshot().frame) {
      ($('anchor-x') as HTMLInputElement).value = String(anchor.x);
      ($('anchor-y') as HTMLInputElement).value = String(anchor.y);
    }
    markDirty();
  };
  scene.onAnchorCommit = (sheet, frame, before) => {
    pushAnchorUndo(sheet, frame, before, false);
  };
  scene.onFrameChange = () => {
    syncFilmstripActive();
    syncAnchorInputs();
  };

  buildNavigator();
  buildFilmstrip();
  wireBoundsMode();
  wireAnchorInputs();
  wireTransport();
  setPlayButton(false);
  wireKeyboard();
  wireSave();
  wireUndo();
  renderWarnings();
  selectSheet('base');
  startHud();
}

let currentSheet: SpriteSheetId = 'base';

function buildNavigator(): void {
  const list = $('move-list');
  list.innerHTML = '';
  for (const group of SHEET_GROUPS) {
    const present = group.sheets.filter((s) => (data.frameData?.frames?.[s]?.length ?? data.frameUrls[s]?.length ?? 0) >= 0);
    if (present.length === 0) continue;
    const groupEl = document.createElement('div');
    groupEl.className = 'nav-group';
    const label = document.createElement('div');
    label.className = 'nav-group-label';
    label.textContent = group.label;
    groupEl.appendChild(label);
    for (const sheet of group.sheets) {
      const count = data.frameData?.frames?.[sheet]?.length ?? data.frameUrls[sheet]?.length ?? 0;
      const row = document.createElement('div');
      row.className = 'nav-move';
      row.dataset.sheet = sheet;
      const status = anchorStatus(sheet);
      row.innerHTML = `<span class="dot ${status}"></span><span class="label">${SHEET_LABELS[sheet]}</span><span class="count">${count}</span>`;
      row.addEventListener('click', () => selectSheet(sheet));
      groupEl.appendChild(row);
    }
    list.appendChild(groupEl);
  }

  $('move-search').addEventListener('input', (e) => {
    const q = (e.target as HTMLInputElement).value.toLowerCase();
    list.querySelectorAll<HTMLElement>('.nav-move').forEach((row) => {
      const match = (row.querySelector('.label')?.textContent ?? '').toLowerCase().includes(q);
      row.style.display = match ? '' : 'none';
    });
  });
}

function anchorStatus(sheet: SpriteSheetId): 'ok' | 'partial' | '' {
  const frames = data.frameData?.frames?.[sheet];
  if (!frames || frames.length === 0) return '';
  const withAnchor = frames.filter((f) => f.anchor && (f.anchor.x !== 0 || f.anchor.y !== 0)).length;
  if (withAnchor === frames.length) return 'ok';
  if (withAnchor > 0) return 'partial';
  return '';
}

function selectSheet(sheet: SpriteSheetId): void {
  currentSheet = sheet;
  $('move-list').querySelectorAll<HTMLElement>('.nav-move').forEach((row) => {
    row.classList.toggle('active', row.dataset.sheet === sheet);
  });
  scene.setSheet(sheet);
  buildFilmstrip();
  syncAnchorInputs();
}

let dragFrom = -1;

function buildFilmstrip(): void {
  const strip = $('filmstrip');
  strip.innerHTML = '';
  const urls = data.frameUrls[currentSheet] ?? [];
  const frames = data.frameData?.frames?.[currentSheet] ?? [];
  const count = Math.max(urls.length, frames.length);
  for (let i = 0; i < count; i += 1) {
    const tile = document.createElement('div');
    tile.className = 'frame-tile';
    tile.dataset.index = String(i);
    tile.draggable = true;
    const meta = frames[i];
    const noAnchor = !meta || (meta.anchor.x === 0 && meta.anchor.y === 0);
    if (noAnchor) tile.classList.add('needs-anchor');
    const warns = meta?.file ? data.frameWarnings[meta.file] : undefined;
    if (warns?.length) {
      tile.classList.add('has-warning');
      tile.title = warns.join('\n');
    } else {
      tile.title = 'Drag to reorder · click to select';
    }
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    if (urls[i]) thumb.style.backgroundImage = `url("${urls[i]}")`;
    // Size the tile to the frame's real aspect ratio (frames vary in width).
    const aspectW = meta && meta.height > 0 ? Math.round(92 * (meta.width / meta.height)) : 64;
    thumb.style.width = `${Math.max(40, Math.min(240, aspectW))}px`;
    const cap = document.createElement('div');
    cap.className = 'cap';
    cap.textContent = `${i + 1}`;
    tile.append(thumb, cap);
    tile.addEventListener('click', () => {
      scene.setPlaying(false);
      setPlayButton(false);
      scene.setFrame(i);
    });
    // Drag-to-reorder.
    tile.addEventListener('dragstart', (e) => {
      dragFrom = i;
      e.dataTransfer?.setData('text/plain', String(i));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    tile.addEventListener('dragover', (e) => {
      e.preventDefault();
      tile.classList.add('dragover');
    });
    tile.addEventListener('dragleave', () => tile.classList.remove('dragover'));
    tile.addEventListener('drop', (e) => {
      e.preventDefault();
      tile.classList.remove('dragover');
      if (dragFrom >= 0) reorderFrame(dragFrom, i);
      dragFrom = -1;
    });
    strip.appendChild(tile);
  }
  syncFilmstripActive();
}

/**
 * Reorder a frame within the current sheet. Mutates the data arrays (frameData,
 * frameUrls) and the recompute baseline in parallel so they stay aligned, then
 * re-renders. Persisted on Save in this new order.
 *
 * Note (Codex #11): reorder changes which sprite shows at each gameplay tick
 * (visualTimeline) and is reconciled at convert time; re-extraction resets order.
 */
function reorderFrame(from: number, to: number): void {
  const frames = data.frameData?.frames?.[currentSheet];
  if (!frames || from === to || from < 0 || to < 0 || from >= frames.length || to >= frames.length) return;
  pushUndoReorder(currentSheet, from, to);
  rawReorder(from, to);
}

function pushUndoReorder(sheet: SpriteSheetId, from: number, to: number): void {
  undoStack.push({ kind: 'reorder', sheet, from, to });
  refreshUndoButton();
}

/** Move a frame within the current sheet without recording undo (used by undo too). */
function rawReorder(from: number, to: number): void {
  const frames = data.frameData?.frames?.[currentSheet];
  const urls = data.frameUrls[currentSheet];
  if (!frames || from === to || from < 0 || to < 0 || from >= frames.length || to >= frames.length) return;
  const [mf] = frames.splice(from, 1);
  frames.splice(to, 0, mf);
  if (urls && from < urls.length && to < urls.length) {
    const [mu] = urls.splice(from, 1);
    urls.splice(to, 0, mu);
  }
  const base = originalAnchors[currentSheet];
  if (base && from < base.length && to < base.length) {
    const [mb] = base.splice(from, 1);
    base.splice(to, 0, mb);
  }
  scene.rerenderAt(to);
  markDirty();
  buildFilmstrip();
}

function syncFilmstripActive(): void {
  const frame = scene.getSnapshot().frame;
  $('filmstrip').querySelectorAll<HTMLElement>('.frame-tile').forEach((tile) => {
    tile.classList.toggle('active', Number(tile.dataset.index) === frame);
  });
  const snap = scene.getSnapshot();
  $('frame-readout').textContent = `${snap.frame + 1} / ${snap.frameCount}`;
}

function wireBoundsMode(): void {
  const group = $('bounds-mode');
  group.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      group.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
      const mode = btn.dataset.mode as BoundsMode;
      scene.setMode(mode);
      const editable = mode === 'anchor';
      ($('anchor-x') as HTMLInputElement).disabled = !editable;
      ($('anchor-y') as HTMLInputElement).disabled = !editable;
      $('mode-note').textContent = editable
        ? 'Anchor: drag the feet pivot on the canvas, or type below.'
        : `${mode[0].toUpperCase()}${mode.slice(1)} is read-only in Phase 1 (collision editing lands in Phase 2).`;
    });
  });
}

function wireAnchorInputs(): void {
  const apply = () => {
    const x = Number(($('anchor-x') as HTMLInputElement).value);
    const y = Number(($('anchor-y') as HTMLInputElement).value);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const snap = scene.getSnapshot();
    if (snap.anchor) pushAnchorUndo(snap.sheet, snap.frame, snap.anchor, false);
    scene.setAnchor(x, y);
  };
  $('anchor-x').addEventListener('change', apply);
  $('anchor-y').addEventListener('change', apply);
}

function syncAnchorInputs(): void {
  const snap = scene.getSnapshot();
  ($('anchor-x') as HTMLInputElement).value = snap.anchor ? String(snap.anchor.x) : '';
  ($('anchor-y') as HTMLInputElement).value = snap.anchor ? String(snap.anchor.y) : '';
  $('anchor-meta').textContent = snap.frameDims
    ? `frame ${snap.frameDims.width}×${snap.frameDims.height}px · anchor is the planted-feet pivot`
    : 'No frame metadata for this sheet.';
  // Surface this frame's extractor warnings in the inspector (reliable, unlike a
  // native title tooltip on a draggable tile).
  const frame = data.frameData?.frames?.[currentSheet]?.[snap.frame];
  const warns = frame?.file ? data.frameWarnings[frame.file] : undefined;
  $('frame-warnings').textContent = warns?.length ? `⚠ ${warns.join(' · ')}` : '';
}

function wireTransport(): void {
  $('prev-btn').addEventListener('click', () => { scene.setPlaying(false); setPlayButton(false); scene.step(-1); });
  $('next-btn').addEventListener('click', () => { scene.setPlaying(false); setPlayButton(false); scene.step(1); });
  $('play-btn').addEventListener('click', () => { scene.togglePlay(); setPlayButton(scene.getSnapshot().playing); });
  $('onion').addEventListener('change', (e) => scene.setOnion((e.target as HTMLInputElement).checked));
  const transport = $('transport');
  transport.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((btn) => {
    btn.addEventListener('click', () => {
      transport.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('active', b === btn));
      scene.setSpeed(Number(btn.dataset.speed));
    });
  });
}

function setPlayButton(playing: boolean): void {
  $('play-btn').textContent = playing ? '❚❚' : '▶';
  $('play-btn').classList.toggle('active', playing);
}

function wireKeyboard(): void {
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const snap = scene.getSnapshot();
    const meta = snap.anchor;
    switch (e.key) {
      case ' ': e.preventDefault(); scene.togglePlay(); setPlayButton(scene.getSnapshot().playing); break;
      case '.': scene.setPlaying(false); setPlayButton(false); scene.step(1); break;
      case ',': scene.setPlaying(false); setPlayButton(false); scene.step(-1); break;
      case 'ArrowLeft': if (meta) { e.preventDefault(); pushAnchorUndo(snap.sheet, snap.frame, meta, true); scene.setAnchor(meta.x - (e.shiftKey ? 10 : 1), meta.y); } break;
      case 'ArrowRight': if (meta) { e.preventDefault(); pushAnchorUndo(snap.sheet, snap.frame, meta, true); scene.setAnchor(meta.x + (e.shiftKey ? 10 : 1), meta.y); } break;
      case 'ArrowUp': if (meta) { e.preventDefault(); pushAnchorUndo(snap.sheet, snap.frame, meta, true); scene.setAnchor(meta.x, meta.y - (e.shiftKey ? 10 : 1)); } break;
      case 'ArrowDown': if (meta) { e.preventDefault(); pushAnchorUndo(snap.sheet, snap.frame, meta, true); scene.setAnchor(meta.x, meta.y + (e.shiftKey ? 10 : 1)); } break;
      default:
        if (/^[1-6]$/.test(e.key)) { scene.setPlaying(false); setPlayButton(false); scene.setFrame(Number(e.key) - 1); }
    }
  });
}

function markDirty(): void {
  if (dirty) return;
  dirty = true;
  $('dirty').classList.add('on');
  ($('save-btn') as HTMLButtonElement).disabled = false;
  window.addEventListener('beforeunload', beforeUnload);
}
function clearDirty(): void {
  dirty = false;
  $('dirty').classList.remove('on');
  ($('save-btn') as HTMLButtonElement).disabled = true;
  window.removeEventListener('beforeunload', beforeUnload);
}
function beforeUnload(e: BeforeUnloadEvent): void {
  e.preventDefault();
  e.returnValue = '';
}

// ---- undo (gesture-level) ----

type UndoEntry =
  | { kind: 'anchor'; sheet: SpriteSheetId; frame: number; anchor: { x: number; y: number } }
  | { kind: 'reorder'; sheet: SpriteSheetId; from: number; to: number };

const undoStack: UndoEntry[] = [];

/** Record an anchor's prior value for undo. `coalesce` merges consecutive edits
 *  to the same frame (so a run of arrow-nudges undoes in one step). */
function pushAnchorUndo(sheet: SpriteSheetId, frame: number, prior: { x: number; y: number }, coalesce: boolean): void {
  const top = undoStack[undoStack.length - 1];
  if (coalesce && top?.kind === 'anchor' && top.sheet === sheet && top.frame === frame) return;
  undoStack.push({ kind: 'anchor', sheet, frame, anchor: { ...prior } });
  refreshUndoButton();
}

function restoreAnchor(sheet: SpriteSheetId, frame: number, anchor: { x: number; y: number }): void {
  if (sheet !== currentSheet) selectSheet(sheet);
  scene.setPlaying(false);
  setPlayButton(false);
  scene.setFrame(frame);
  scene.setAnchor(anchor.x, anchor.y);
}

function undo(): void {
  const entry = undoStack.pop();
  if (!entry) return;
  if (entry.kind === 'anchor') {
    restoreAnchor(entry.sheet, entry.frame, entry.anchor);
  } else {
    if (entry.sheet !== currentSheet) selectSheet(entry.sheet);
    rawReorder(entry.to, entry.from); // inverse move
  }
  refreshUndoButton();
}

function refreshUndoButton(): void {
  ($('undo-btn') as HTMLButtonElement).disabled = undoStack.length === 0;
}

function wireUndo(): void {
  $('undo-btn').addEventListener('click', undo);
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    }
  });
}

// ---- persistence (T4) ----

/** Snapshot current anchors as the recompute baseline (after load and each save). */
function snapshotAnchors(): void {
  originalAnchors = {};
  const frames = data.frameData?.frames ?? {};
  for (const [sheet, arr] of Object.entries(frames)) {
    originalAnchors[sheet] = (arr ?? []).map((f) => ({ x: f.anchor.x, y: f.anchor.y }));
  }
}

/**
 * A1 — anchor edits must translate the anchor-relative collision boxes.
 * frameData hurtbox/attackBox are stored relative to the anchor; moving the
 * anchor by Δ leaves the body pixels where they are, so each box's offset from
 * the new anchor is Δ less. Pure translation, exact.
 */
function applyAnchorRecompute(): void {
  const frames = data.frameData?.frames ?? {};
  for (const [sheet, arr] of Object.entries(frames)) {
    const baseline = originalAnchors[sheet] ?? [];
    (arr ?? []).forEach((f, i) => {
      const base = baseline[i];
      if (!base) return;
      if (f.anchor.x !== base.x || f.anchor.y !== base.y) {
        translateBoxesForAnchorDelta(f, base);
      }
      // Stamp any frame that already carries (or just got) a non-default anchor as
      // hand-tuned, so re-extraction preserves it instead of clobbering (A6/T5).
      if (f.anchorEdited || f.anchor.x !== base.x || f.anchor.y !== base.y) {
        f.anchorEdited = true;
      }
    });
  }
}

function wireSave(): void {
  $('save-btn').addEventListener('click', () => void save());
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void save();
    }
  });
}

async function save(): Promise<void> {
  if (!dirty || !data.frameData) return;
  const btn = $('save-btn') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    applyAnchorRecompute();
    const res = await fetch('/api/tools/save_gym_edits', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ characterId, frameData: data.frameData }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
    snapshotAnchors();
    clearDirty();
    btn.textContent = 'Saved';
    window.setTimeout(() => { if (!dirty) btn.textContent = 'Save'; }, 1200);
  } catch (error) {
    btn.disabled = false;
    btn.textContent = 'Save';
    showStatus(`Save failed: ${(error as Error).message}`, true);
    window.setTimeout(hideStatus, 2500);
  }
}

function renderWarnings(): void {
  $('warnings').innerHTML = data.warnings.length
    ? data.warnings.map((w) => `• ${escapeHtml(w)}`).join('<br />')
    : 'No issues — pack looks complete.';
}

function startHud(): void {
  const hud = $('hud');
  const tick = () => {
    const s = scene.getSnapshot();
    if (s.ready) {
      hud.innerHTML = rows([
        ['sheet', s.sheet],
        ['frame', `${s.frame + 1} / ${s.frameCount}`],
        ['anchor', s.anchor ? `${s.anchor.x}, ${s.anchor.y}` : '—'],
        ['frame px', s.frameDims ? `${s.frameDims.width}×${s.frameDims.height}` : '—'],
      ]);
      syncFilmstripActive();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function rows(entries: [string, string][]): string {
  return entries.map(([k, v]) => `<label>${escapeHtml(k)}</label><span style="text-align:right">${escapeHtml(v)}</span>`).join('');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

void main();
