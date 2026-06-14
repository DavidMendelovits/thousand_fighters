import Phaser from 'phaser';
import { SHEET_LABELS, sheetGroups } from '../../shared/animationRows.js';
import type { SpriteSheetId } from '../schema/types';
import {
  loadGymData,
  type GymData,
  type DraftOverrides,
  type OverrideBox,
  type DraftMove,
  type ProjectileEntity,
} from './loadGymData';
import { GymScene, GYM_CANVAS, type BoundsMode } from './GymScene';
import { translateBoxesForAnchorDelta } from './anchorMath';

/** Overlay colours (mirror gym.html tokens / design §9). */
const COLOR_HURT = 0x79a8ff;
const COLOR_HIT = 0xff6b6b;
const COLOR_GUARD = 0x9fe6b0;

/**
 * Which base-row frame each fighter state displays — mirrors STATE_BASE_FRAME in
 * cms/export/convertDraftToCharacterConfig.js so the gym shows the same sprite +
 * measured hurtbox the runtime derives per state. `attack` reuses the idle frame
 * (the body envelope) — convert pads it by 2 after scaling.
 */
const STATE_BASE_FRAME: Record<string, number> = {
  idle: 0, walk_forward: 1, walk_back: 1, crouch: 2, airborne: 3, hitstun: 4, blockstun: 1, juggle: 3,
};
const HURT_STATES: string[] = [...Object.keys(STATE_BASE_FRAME), 'attack'];

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

// Move navigator grouping, derived from the data-driven row registry
// (shared/animationRows.js). Groups + labels scale automatically as rows are
// added (T21); SHEET_LABELS is imported alongside sheetGroups().
const SHEET_GROUPS: { label: string; sheets: SpriteSheetId[] }[] = sheetGroups();

let scene: GymScene;
let data: GymData;
/** frameData edits (anchors, reorder) vs draft edits (overrides, hitbox numbers) dirty independently — they persist to two stores. */
let frameDirty = false;
let draftDirty = false;
let characterId = '';
/** Anchors as last loaded/saved, per sheet — the baseline for the Δanchor box recompute (A1). */
let originalAnchors: Record<string, { x: number; y: number }[]> = {};

/** Live, editable override layer (cloned from the draft; sent wholesale on save). */
let overrides: DraftOverrides = { hurtboxes: {}, hitboxes: {}, guardboxes: {} };
/** Authored hitbox-number edits, keyed `${moveId}::${hitboxId}` → patch fields. */
const numberEdits = new Map<string, Record<string, number | string>>();
let currentHurtState = 'idle';
let currentGuardState = 'idle';
/** Flat list of draft hitbox activations (one per move + hitbox id). */
type Activation = { moveId: string; hitboxId: string; animation: SpriteSheetId; label: string };
let activations: Activation[] = [];
let currentActivation: Activation | null = null;

/** Live, editable projectile entities (cloned from the draft; sent wholesale on save). T23. */
let projectiles: ProjectileEntity[] = [];
let currentProjectileId: string | null = null;
let projectilesDirty = false;

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
  cloneOverrides();
  cloneProjectiles();

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
    markFrameDirty();
  };
  scene.onAnchorCommit = (sheet, frame, before) => {
    pushAnchorUndo(sheet, frame, before, false);
  };
  scene.onFrameChange = () => {
    syncFilmstripActive();
    syncAnchorInputs();
    if (currentMode === 'hitbox') renderHitboxInspector(); // measured per-frame box follows the scrub
  };
  scene.onCollisionBoxChange = (box) => {
    if (currentMode === 'hurtbox') onHurtBoxDragged(box);
    else if (currentMode === 'hitbox') onHitBoxDragged(box);
    else if (currentMode === 'guard') onGuardBoxDragged(box);
  };

  buildNavigator();
  buildFilmstrip();
  wireBoundsMode();
  wireAnchorInputs();
  wireGizmo();
  buildHurtStates();
  buildGuardStates();
  buildHitActivations();
  wireCollisionInspector();
  buildProjectileEditor();
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
let currentMode: BoundsMode = 'anchor';

function buildNavigator(): void {
  const list = $('move-list');
  list.innerHTML = '';
  for (const group of SHEET_GROUPS) {
    // Only render rows the loaded fighter actually owns. The registry now lists
    // all 12 rows (T21), but a fighter owns a subset — show "what exists" so the
    // navigator isn't cluttered with frameless jump/crouch/grab/... rows and
    // empty Movement/Defense/Grapple groups. (Predicate was `>= 0` — always
    // true — which silently rendered every registry row once the registry grew
    // past the canonical 5.)
    const present = group.sheets.filter((s) => (data.frameData?.frames?.[s]?.length ?? data.frameUrls[s]?.length ?? 0) > 0);
    if (present.length === 0) continue;
    const groupEl = document.createElement('div');
    groupEl.className = 'nav-group';
    const label = document.createElement('div');
    label.className = 'nav-group-label';
    label.textContent = group.label;
    groupEl.appendChild(label);
    for (const sheet of present) {
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
  markFrameDirty();
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

const MODE_NOTES: Record<BoundsMode, string> = {
  anchor: 'Anchor: drag the feet pivot on the canvas, or type below.',
  visual: 'Visual bounds are the intrinsic frame size (read-only; no runtime consumer).',
  hurtbox: 'Per-state body hurtbox. Override the measured box to author one that survives re-extraction.',
  hitbox: 'Per-activation attack box + authored numbers. Override geometry for a static box (clears keyframes).',
  guard: 'Per-state guard box (T17). Override-only — no measured pass. When authored, blocking resolves by AABB overlap instead of the high/mid/low enum.',
};

function show(id: string, on: boolean): void {
  $(id).hidden = !on;
}

function wireBoundsMode(): void {
  const group = $('bounds-mode');
  group.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      group.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
      applyModeUI(btn.dataset.mode as BoundsMode);
    });
  });
}

/** Switch inspector panels + canvas state when the BOUNDS mode changes (the §6 asymmetry). */
function applyModeUI(mode: BoundsMode): void {
  currentMode = mode;
  scene.setMode(mode);
  show('anchor-panel', mode === 'anchor');
  show('gizmo-panel', mode === 'hurtbox' || mode === 'hitbox' || mode === 'guard');
  show('hurtbox-panel', mode === 'hurtbox');
  show('hitbox-panel', mode === 'hitbox');
  show('guardbox-panel', mode === 'guard');
  $('mode-note').textContent = MODE_NOTES[mode];

  if (mode === 'hurtbox') {
    selectHurtState(currentHurtState);
  } else if (mode === 'hitbox') {
    if (!currentActivation && activations.length) currentActivation = activations[0];
    selectActivation(currentActivation);
  } else if (mode === 'guard') {
    selectGuardState(currentGuardState);
  } else {
    scene.setCollisionBox(null, { editable: false, color: 0 });
  }
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
    const step = e.shiftKey ? 10 : 1;
    const arrow = (dx: number, dy: number): void => {
      e.preventDefault();
      if (currentMode === 'anchor') {
        if (meta) { pushAnchorUndo(snap.sheet, snap.frame, meta, true); scene.setAnchor(meta.x + dx, meta.y + dy); }
      } else {
        nudgeActiveBox(dx, dy);
      }
    };
    switch (e.key) {
      case ' ': e.preventDefault(); scene.togglePlay(); setPlayButton(scene.getSnapshot().playing); break;
      case '.': scene.setPlaying(false); setPlayButton(false); scene.step(1); break;
      case ',': scene.setPlaying(false); setPlayButton(false); scene.step(-1); break;
      case 'q': case 'Q': setGizmoMode('move'); break;
      case 'w': case 'W': setGizmoMode('scale'); break;
      case 'ArrowLeft': arrow(-step, 0); break;
      case 'ArrowRight': arrow(step, 0); break;
      case 'ArrowUp': arrow(0, -step); break;
      case 'ArrowDown': arrow(0, step); break;
      default:
        if (/^[1-6]$/.test(e.key)) { scene.setPlaying(false); setPlayButton(false); scene.setFrame(Number(e.key) - 1); }
    }
  });
}

/** Set the gizmo mode from a keyboard shortcut, keeping the toggle buttons in sync. */
function setGizmoMode(mode: 'move' | 'scale'): void {
  scene.setGizmo(mode);
  $('gizmo-mode').querySelectorAll<HTMLButtonElement>('[data-gizmo]').forEach((b) => {
    b.classList.toggle('active', b.dataset.gizmo === mode);
  });
}

/** Translate the active editable collision box by (dx, dy) frame-px (keyboard nudge). */
function nudgeActiveBox(dx: number, dy: number): void {
  if (currentMode === 'hurtbox') {
    const b = overrides.hurtboxes?.[currentHurtState];
    if (!b) return;
    onHurtBoxDragged({ x: b.x + dx, y: b.y + dy, width: b.width, height: b.height });
    scene.setCollisionBox(overrides.hurtboxes![currentHurtState], { editable: true, color: COLOR_HURT });
  } else if (currentMode === 'hitbox' && currentActivation) {
    const b = overrides.hitboxes?.[currentActivation.moveId]?.[currentActivation.hitboxId];
    if (!b) return;
    onHitBoxDragged({ x: b.x + dx, y: b.y + dy, width: b.width, height: b.height });
    scene.setCollisionBox(b, { editable: true, color: COLOR_HIT });
  } else if (currentMode === 'guard') {
    const b = overrides.guardboxes?.[currentGuardState];
    if (!b) return;
    onGuardBoxDragged({ x: b.x + dx, y: b.y + dy, width: b.width, height: b.height });
    scene.setCollisionBox(overrides.guardboxes![currentGuardState], { editable: true, color: COLOR_GUARD });
  }
}

function anyDirty(): boolean {
  return frameDirty || draftDirty;
}
function markFrameDirty(): void {
  frameDirty = true;
  refreshDirty();
}
function markDraftDirty(): void {
  draftDirty = true;
  refreshDirty();
}
function refreshDirty(): void {
  const d = anyDirty();
  $('dirty').classList.toggle('on', d);
  ($('save-btn') as HTMLButtonElement).disabled = !d;
  if (d) window.addEventListener('beforeunload', beforeUnload);
  else window.removeEventListener('beforeunload', beforeUnload);
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

/** Build the targeted hitbox-number patch list from the touched-edits map (T12). */
function buildHitboxNumberPatches(): Record<string, number | string>[] {
  const patches: Record<string, number | string>[] = [];
  for (const [key, fields] of numberEdits) {
    const [moveId, hitboxId] = key.split('::');
    patches.push({ moveId, hitboxId, ...fields });
  }
  return patches;
}

async function save(): Promise<void> {
  if (!anyDirty()) return;
  const btn = $('save-btn') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Saving…';

  // Assemble only the dirty halves. frameData carries the Δanchor box recompute (A1).
  const payload: Record<string, unknown> = { characterId };
  const sendingFrame = frameDirty && Boolean(data.frameData);
  const sendingDraft = draftDirty;
  if (sendingFrame) {
    applyAnchorRecompute();
    // Advance the recompute baseline WITH the box shift (not on save success), so a
    // retry after a frameData-half failure never re-applies Δanchor and double-shifts
    // the collision boxes (codex P1). The in-memory frameData is self-consistent
    // regardless of the save outcome; the file just persists it on a later success.
    snapshotAnchors();
    payload.frameData = data.frameData;
  }
  if (sendingDraft) {
    payload.overrides = overrides;
    payload.hitboxNumbers = buildHitboxNumberPatches();
    // Only send projectiles when actually edited — omit leaves them untouched.
    if (projectilesDirty) payload.projectiles = projectiles;
  }

  try {
    const res = await fetch('/api/tools/save_gym_edits', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    const result = (json.result ?? {}) as { frameData?: { status: string; error?: string }; draft?: { status: string; error?: string } };

    // Per-half: clear only the halves that actually persisted; keep the rest dirty.
    let frameOk = true;
    let draftOk = true;
    if (sendingFrame) {
      if (result.frameData?.status === 'saved') frameDirty = false;
      else frameOk = false;
    }
    if (sendingDraft) {
      if (result.draft?.status === 'saved') { draftDirty = false; numberEdits.clear(); projectilesDirty = false; }
      else draftOk = false;
    }
    refreshDirty();

    if (frameOk && draftOk) {
      btn.textContent = 'Saved';
      window.setTimeout(() => { if (!anyDirty()) btn.textContent = 'Save'; }, 1200);
    } else {
      const parts: string[] = [];
      if (!frameOk) parts.push(`frames: ${result.frameData?.error ?? 'failed'}`);
      if (!draftOk) parts.push(`draft: ${result.draft?.error ?? 'failed'}`);
      throw new Error(parts.join(' · '));
    }
  } catch (error) {
    btn.disabled = false;
    btn.textContent = 'Save';
    showStatus(`Save failed (unsaved edits kept): ${(error as Error).message}`, true);
    window.setTimeout(hideStatus, 3500);
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

// ===========================================================================
// Collision inspector (T11) — per-state hurtbox + per-activation hitbox editing
// ===========================================================================
//
// Both boxes are authored in frame-px, anchor-relative space (the override space,
// §3/T10): exactly what GymScene.drawBox renders and what convert × scales. The
// gym never writes scaled/world units, so what you draw is what ships.

/** Clone the draft's override layer into the live working copy. */
function cloneOverrides(): void {
  const src = data.draft?.overrides ?? {};
  overrides = {
    hurtboxes: { ...(src.hurtboxes ?? {}) },
    hitboxes: Object.fromEntries(
      Object.entries(src.hitboxes ?? {}).map(([moveId, ids]) => [moveId, { ...ids }]),
    ),
    guardboxes: { ...(src.guardboxes ?? {}) },
  };
}

// --- Projectile editor (T23) -------------------------------------------------

function cloneProjectiles(): void {
  // Deep clone so edits don't mutate the loaded draft until saved.
  projectiles = (data.draft?.projectiles ?? []).map((p) => structuredClone(p));
  currentProjectileId = projectiles[0]?.id ?? null;
  projectilesDirty = false;
}

/** Read a dotted path (e.g. "hitbox.knockback.x") off a projectile entity. */
function readProjectilePath(entity: ProjectileEntity, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined), entity);
}

/** Write a dotted path, creating intermediate objects as needed. */
function writeProjectilePath(entity: ProjectileEntity, path: string, value: number | string): void {
  const keys = path.split('.');
  let node = entity as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (!node[key] || typeof node[key] !== 'object') node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  node[keys[keys.length - 1]] = value;
}

function currentProjectile(): ProjectileEntity | null {
  return projectiles.find((p) => p.id === currentProjectileId) ?? null;
}

function buildProjectileEditor(): void {
  const select = $('proj-select') as HTMLSelectElement;
  select.innerHTML = '';
  for (const entity of projectiles) {
    const option = document.createElement('option');
    option.value = entity.id;
    option.textContent = entity.id;
    select.appendChild(option);
  }
  if (currentProjectileId) select.value = currentProjectileId;
  select.addEventListener('change', () => {
    currentProjectileId = select.value;
    renderProjectileFields();
  });

  // Wire every [data-proj] input/select to its dotted path.
  document.querySelectorAll<HTMLElement>('#proj-fields [data-proj]').forEach((el) => {
    el.addEventListener('change', () => {
      const entity = currentProjectile();
      if (!entity) return;
      const path = el.dataset.proj!;
      const input = el as HTMLInputElement | HTMLSelectElement;
      const value: number | string = input instanceof HTMLSelectElement
        ? input.value
        : Number(input.value);
      if (typeof value === 'number' && Number.isNaN(value)) return;
      writeProjectilePath(entity, path, value);
      projectilesDirty = true;
      markDraftDirty();
    });
  });

  renderProjectileFields();
}

function renderProjectileFields(): void {
  const entity = currentProjectile();
  const empty = $('proj-empty');
  const fields = $('proj-fields');
  if (!entity) {
    empty.hidden = false;
    fields.hidden = true;
    return;
  }
  empty.hidden = true;
  fields.hidden = false;
  document.querySelectorAll<HTMLElement>('#proj-fields [data-proj]').forEach((el) => {
    const value = readProjectilePath(entity, el.dataset.proj!);
    const input = el as HTMLInputElement | HTMLSelectElement;
    input.value = value === undefined || value === null ? '' : String(value);
  });
  const sprite = entity.animation ? `texture: ${entity.animation}` : 'no sprite generated yet';
  $('proj-note').textContent = `${sprite}. Boxes are in projectile-local px; convert maps them to the runtime ProjectileConfig.`;
}

function roundBox(b: OverrideBox): OverrideBox {
  return { x: Math.round(b.x), y: Math.round(b.y), width: Math.max(1, Math.round(b.width)), height: Math.max(1, Math.round(b.height)) };
}

function setBadge(id: string, overridden: boolean): void {
  const el = $(id);
  el.textContent = overridden ? 'OVERRIDDEN' : 'MEASURED';
  el.classList.toggle('overridden', overridden);
}

function setBoxInputs(prefix: string, box: OverrideBox | null, enabled: boolean): void {
  const fields: [string, keyof OverrideBox][] = [['x', 'x'], ['y', 'y'], ['w', 'width'], ['h', 'height']];
  for (const [suffix, key] of fields) {
    const el = $(`${prefix}-${suffix}`) as HTMLInputElement;
    el.value = box ? String(box[key]) : '';
    el.disabled = !enabled;
  }
}

function readBoxInputs(prefix: string): OverrideBox | null {
  const get = (s: string) => Number(($(`${prefix}-${s}`) as HTMLInputElement).value);
  const box = { x: get('x'), y: get('y'), width: get('w'), height: get('h') };
  if (![box.x, box.y, box.width, box.height].every(Number.isFinite)) return null;
  return roundBox(box);
}

function wireGizmo(): void {
  const group = $('gizmo-mode');
  group.querySelectorAll<HTMLButtonElement>('[data-gizmo]').forEach((btn) => {
    btn.addEventListener('click', () => {
      group.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
      scene.setGizmo(btn.dataset.gizmo as 'move' | 'scale');
    });
  });
}

// ---- Hurtbox (per FighterState) ----

/** Measured frame-px hurtbox for a state — mirrors convert's measured path (unscaled). */
function hurtMeasuredPx(state: string): OverrideBox | null {
  const base = data.frameData?.frames?.base;
  if (!base?.length) return null;
  const idx = STATE_BASE_FRAME[state] ?? 0;
  const frame = base[Math.min(idx, base.length - 1)];
  const box = frame?.hurtbox ?? base.find((f) => f?.hurtbox)?.hurtbox ?? null;
  if (!box) return null;
  if (state === 'attack') return { x: box.x - 2, y: box.y - 2, width: box.width + 4, height: box.height + 2 };
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

function buildHurtStates(): void {
  const sel = $('hurt-state') as HTMLSelectElement;
  sel.innerHTML = HURT_STATES.map((s) => `<option value="${s}">${s}</option>`).join('');
  sel.value = currentHurtState;
}

function selectHurtState(state: string): void {
  currentHurtState = state;
  ($('hurt-state') as HTMLSelectElement).value = state;
  // Drive the canvas off the base frame for this state so the silhouette matches (§ defaults).
  if (currentSheet !== 'base') selectSheet('base');
  scene.setPlaying(false);
  setPlayButton(false);
  scene.setFrame(STATE_BASE_FRAME[state] ?? 0);
  renderHurtboxInspector();
}

function renderHurtboxInspector(): void {
  const state = currentHurtState;
  const override = overrides.hurtboxes?.[state] ?? null;
  const measured = hurtMeasuredPx(state);
  const box = override ?? measured;
  const has = Boolean(override);
  setBoxInputs('hurt', box, has);
  setBadge('hurt-badge', has);
  show('hurt-override', !has);
  show('hurt-reset', has);
  $('hurt-note').textContent = has
    ? 'Authoring an override — drag the box or type. It wins over the measured pass and survives re-extraction.'
    : measured
      ? 'Measured from the base frame. Click Override to author one.'
      : 'No measured hurtbox for this state. Click Override to author one.';
  scene.setCollisionBox(box, { editable: has, color: COLOR_HURT });
}

function onHurtBoxDragged(box: OverrideBox): void {
  overrides.hurtboxes = overrides.hurtboxes ?? {};
  overrides.hurtboxes[currentHurtState] = roundBox(box);
  setBoxInputs('hurt', overrides.hurtboxes[currentHurtState], true);
  markDraftDirty();
}

// ---- Guard box (per FighterState, T17) ----
// Guard boxes are OVERRIDE-ONLY — there is no measured pass. The badge shows
// "NONE" (not "MEASURED") when no override exists, and "OVERRIDDEN" when present.

/** Badge variant for override-only fields: "NONE" vs "OVERRIDDEN". */
function setGuardBadge(overridden: boolean): void {
  const el = $('guard-badge');
  el.textContent = overridden ? 'OVERRIDDEN' : 'NONE';
  el.classList.toggle('overridden', overridden);
}

function buildGuardStates(): void {
  const sel = $('guard-state') as HTMLSelectElement;
  sel.innerHTML = HURT_STATES.map((s) => `<option value="${s}">${s}</option>`).join('');
  sel.value = currentGuardState;
}

function selectGuardState(state: string): void {
  currentGuardState = state;
  ($('guard-state') as HTMLSelectElement).value = state;
  // Drive the canvas off the base frame for this state so the silhouette matches.
  if (currentSheet !== 'base') selectSheet('base');
  scene.setPlaying(false);
  setPlayButton(false);
  scene.setFrame(STATE_BASE_FRAME[state] ?? 0);
  renderGuardboxInspector();
}

function renderGuardboxInspector(): void {
  const state = currentGuardState;
  const override = overrides.guardboxes?.[state] ?? null;
  const has = Boolean(override);
  setBoxInputs('guard', override, has);
  setGuardBadge(has);
  show('guard-override', !has);
  show('guard-reset', has);
  $('guard-note').textContent = has
    ? 'Authoring a guard box — drag or type. Blocking now requires the hitbox to overlap this region.'
    : 'No guard box for this state — blocking falls back to the high/mid/low level enum. Click Override to author one.';
  scene.setCollisionBox(override, { editable: has, color: COLOR_GUARD });
}

function onGuardBoxDragged(box: OverrideBox): void {
  overrides.guardboxes = overrides.guardboxes ?? {};
  overrides.guardboxes[currentGuardState] = roundBox(box);
  setBoxInputs('guard', overrides.guardboxes[currentGuardState], true);
  markDraftDirty();
}

// ---- Hitbox (per move + hitbox id activation) ----

function widestAttackBox(sheet: SpriteSheetId): OverrideBox | null {
  let best: OverrideBox | null = null;
  for (const f of data.frameData?.frames?.[sheet] ?? []) {
    const b = f?.attackBox;
    if (b && b.width > 0 && (!best || b.width > best.width)) best = { x: b.x, y: b.y, width: b.width, height: b.height };
  }
  return best;
}

/** Measured frame-px hitbox = the current frame's attackBox (scrubbable), else the sheet's widest. */
function hitMeasuredPx(): OverrideBox | null {
  const snap = scene.getSnapshot();
  const box = data.frameData?.frames?.[snap.sheet]?.[snap.frame]?.attackBox ?? null;
  if (box) return { x: box.x, y: box.y, width: box.width, height: box.height };
  return widestAttackBox(snap.sheet);
}

function buildHitActivations(): void {
  activations = [];
  const seen = new Set<string>();
  for (const move of (data.draft?.moves ?? []) as DraftMove[]) {
    const animation = (move.animation ?? 'punch') as SpriteSheetId;
    for (const phase of move.phases ?? []) {
      for (const entry of phase.events ?? []) {
        const ev = entry.event;
        if (!ev || (ev.type !== 'hitbox_active' && ev.type !== 'hitbox') || !ev.hitbox) continue;
        const hitboxId = ev.id ?? 'default';
        const key = `${move.id}::${hitboxId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const suffix = hitboxId !== 'default' ? ` · ${hitboxId}` : '';
        activations.push({ moveId: move.id, hitboxId, animation, label: `${move.displayName ?? move.id}${suffix}` });
      }
    }
  }
  const sel = $('hit-activation') as HTMLSelectElement;
  sel.innerHTML = activations.length
    ? activations.map((a, i) => `<option value="${i}">${escapeHtml(a.label)} (${a.animation})</option>`).join('')
    : '<option value="">No hitboxes in this draft</option>';
}

function selectActivation(act: Activation | null): void {
  currentActivation = act;
  if (act) {
    const idx = activations.indexOf(act);
    if (idx >= 0) ($('hit-activation') as HTMLSelectElement).value = String(idx);
    if (currentSheet !== act.animation) selectSheet(act.animation);
  }
  renderHitboxInspector();
}

function renderHitboxInspector(): void {
  const act = currentActivation;
  if (!act) {
    setBoxInputs('hit', null, false);
    setBadge('hit-badge', false);
    show('hit-override', false);
    show('hit-reset', false);
    $('hit-note').textContent = 'This draft has no hitbox activations to edit.';
    scene.setCollisionBox(null, { editable: false, color: COLOR_HIT });
    setNumberInputs(null);
    return;
  }
  const override = overrides.hitboxes?.[act.moveId]?.[act.hitboxId] ?? null;
  const box = override ?? hitMeasuredPx();
  const has = Boolean(override);
  setBoxInputs('hit', box, has);
  setBadge('hit-badge', has);
  show('hit-override', !has);
  show('hit-reset', has);
  $('hit-note').textContent = has
    ? 'Static override — drag the box or type. It clears the measured keyframe track (A4).'
    : 'Measured per-frame from the sprite — scrub the timeline to inspect. Click Override for a static box.';
  scene.setCollisionBox(box, { editable: has, color: COLOR_HIT });
  setNumberInputs(act);
}

function setHitOverride(box: OverrideBox): void {
  const act = currentActivation;
  if (!act) return;
  overrides.hitboxes = overrides.hitboxes ?? {};
  overrides.hitboxes[act.moveId] = overrides.hitboxes[act.moveId] ?? {};
  overrides.hitboxes[act.moveId][act.hitboxId] = roundBox(box);
}

function deleteHitOverride(): void {
  const act = currentActivation;
  if (!act || !overrides.hitboxes?.[act.moveId]) return;
  delete overrides.hitboxes[act.moveId][act.hitboxId];
  if (Object.keys(overrides.hitboxes[act.moveId]).length === 0) delete overrides.hitboxes[act.moveId];
}

function onHitBoxDragged(box: OverrideBox): void {
  if (!currentActivation) return;
  setHitOverride(box);
  setBoxInputs('hit', roundBox(box), true);
  markDraftDirty();
}

// ---- Hitbox authored numbers (live in the draft, patched in place on save) ----

function draftHitboxFields(act: Activation): Record<string, number | string> | null {
  const move = (data.draft?.moves ?? []).find((m) => m.id === act.moveId);
  for (const phase of move?.phases ?? []) {
    for (const entry of phase.events ?? []) {
      const ev = entry.event;
      if (!ev || (ev.type !== 'hitbox_active' && ev.type !== 'hitbox') || !ev.hitbox) continue;
      if ((ev.id ?? 'default') !== act.hitboxId) continue;
      const hb = ev.hitbox;
      const out: Record<string, number | string> = {};
      if (hb.damage !== undefined) out.damage = hb.damage;
      const hitstun = hb.hitstun ?? hb.stun;
      if (hitstun !== undefined) out.hitstun = hitstun;
      if (hb.blockstun !== undefined) out.blockstun = hb.blockstun;
      const kx = hb.knockbackX ?? hb.knockback?.x;
      if (kx !== undefined) out.knockbackX = kx;
      const ky = hb.knockbackY ?? hb.knockback?.y;
      if (ky !== undefined) out.knockbackY = ky;
      if (hb.level !== undefined) out.level = hb.level;
      return out;
    }
  }
  return null;
}

function readActivationNumbers(act: Activation): Record<string, number | string> {
  const base = draftHitboxFields(act) ?? {};
  const edits = numberEdits.get(`${act.moveId}::${act.hitboxId}`) ?? {};
  return { ...base, ...edits };
}

const NUMBER_FIELDS: [string, string][] = [
  ['hb-damage', 'damage'], ['hb-hitstun', 'hitstun'], ['hb-blockstun', 'blockstun'],
  ['hb-kbx', 'knockbackX'], ['hb-kby', 'knockbackY'],
];

function setNumberInputs(act: Activation | null): void {
  const nums = act ? readActivationNumbers(act) : null;
  for (const [id, field] of NUMBER_FIELDS) {
    const el = $(id) as HTMLInputElement;
    el.value = nums && nums[field] !== undefined ? String(nums[field]) : '';
    el.disabled = !act;
  }
  const lvl = $('hb-level') as HTMLSelectElement;
  const levelVal = (nums?.level as string) ?? 'mid';
  lvl.value = levelVal;
  lvl.disabled = !act;
  // T19: push the level to the scene so the hit-level band follows.
  scene.setHitLevel(act ? (levelVal as 'high' | 'mid' | 'low') : null);
}

function onNumberEdit(field: string, raw: string): void {
  const act = currentActivation;
  if (!act) return;
  const key = `${act.moveId}::${act.hitboxId}`;
  const cur = numberEdits.get(key) ?? {};
  if (field === 'level') {
    cur[field] = raw;
    // T19: keep the hit-level band in sync when the user changes the level field.
    scene.setHitLevel(raw as 'high' | 'mid' | 'low');
  } else {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    cur[field] = n;
  }
  numberEdits.set(key, cur);
  markDraftDirty();
}

// ---- wiring ----

function wireCollisionInspector(): void {
  // Hurtbox controls.
  ($('hurt-state') as HTMLSelectElement).addEventListener('change', (e) => selectHurtState((e.target as HTMLSelectElement).value));
  $('hurt-override').addEventListener('click', () => {
    overrides.hurtboxes = overrides.hurtboxes ?? {};
    overrides.hurtboxes[currentHurtState] = hurtMeasuredPx(currentHurtState) ?? { x: -25, y: -120, width: 50, height: 120 };
    markDraftDirty();
    renderHurtboxInspector();
  });
  $('hurt-reset').addEventListener('click', () => {
    if (overrides.hurtboxes) delete overrides.hurtboxes[currentHurtState];
    markDraftDirty();
    renderHurtboxInspector();
  });
  for (const suffix of ['x', 'y', 'w', 'h']) {
    $(`hurt-${suffix}`).addEventListener('change', () => {
      if (!overrides.hurtboxes?.[currentHurtState]) return;
      const box = readBoxInputs('hurt');
      if (!box) return;
      overrides.hurtboxes[currentHurtState] = box;
      scene.setCollisionBox(box, { editable: true, color: COLOR_HURT });
      markDraftDirty();
    });
  }

  // Guard box controls (T17).
  ($('guard-state') as HTMLSelectElement).addEventListener('change', (e) => selectGuardState((e.target as HTMLSelectElement).value));
  $('guard-override').addEventListener('click', () => {
    overrides.guardboxes = overrides.guardboxes ?? {};
    overrides.guardboxes[currentGuardState] = hurtMeasuredPx(currentGuardState) ?? { x: -25, y: -120, width: 50, height: 120 };
    markDraftDirty();
    renderGuardboxInspector();
  });
  $('guard-reset').addEventListener('click', () => {
    if (overrides.guardboxes) delete overrides.guardboxes[currentGuardState];
    markDraftDirty();
    renderGuardboxInspector();
  });
  for (const suffix of ['x', 'y', 'w', 'h']) {
    $(`guard-${suffix}`).addEventListener('change', () => {
      if (!overrides.guardboxes?.[currentGuardState]) return;
      const box = readBoxInputs('guard');
      if (!box) return;
      overrides.guardboxes[currentGuardState] = box;
      scene.setCollisionBox(box, { editable: true, color: COLOR_GUARD });
      markDraftDirty();
    });
  }

  // Hitbox controls.
  ($('hit-activation') as HTMLSelectElement).addEventListener('change', (e) => {
    const idx = Number((e.target as HTMLSelectElement).value);
    selectActivation(Number.isInteger(idx) ? activations[idx] ?? null : null);
  });
  $('hit-override').addEventListener('click', () => {
    setHitOverride(hitMeasuredPx() ?? { x: 20, y: -90, width: 40, height: 24 });
    markDraftDirty();
    renderHitboxInspector();
  });
  $('hit-reset').addEventListener('click', () => {
    deleteHitOverride();
    markDraftDirty();
    renderHitboxInspector();
  });
  for (const suffix of ['x', 'y', 'w', 'h']) {
    $(`hit-${suffix}`).addEventListener('change', () => {
      if (!currentActivation || !overrides.hitboxes?.[currentActivation.moveId]?.[currentActivation.hitboxId]) return;
      const box = readBoxInputs('hit');
      if (!box) return;
      setHitOverride(box);
      scene.setCollisionBox(box, { editable: true, color: COLOR_HIT });
      markDraftDirty();
    });
  }
  for (const [id, field] of NUMBER_FIELDS) {
    $(id).addEventListener('change', (e) => onNumberEdit(field, (e.target as HTMLInputElement).value));
  }
  $('hb-level').addEventListener('change', (e) => onNumberEdit('level', (e.target as HTMLSelectElement).value));
}

void main();
