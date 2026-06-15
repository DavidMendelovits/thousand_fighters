// Animation-row registry — the single runtime source of truth for the set of
// sprite-sheet rows a fighter can have. Replaces the hardcoded 5-member
// `SpriteSheetId` union (T20, supersedes T16).
//
// This is a plain ESM module (no TS syntax) so all three worlds can read ONE
// copy with zero build step: the Vite/TS engine (`src/`, types via the
// `.d.ts` sidecar), the Node CMS pipeline (`cms/`), and Node scripts
// (`scripts/`). `admin/app.js` is a browser file served behind a static server
// and cannot import this module over HTTP — it keeps its own literal ordering,
// guarded against this registry by scripts/smoke_animation_rows.mjs.
//
// The 5 canonical rows below are the default registry, so existing fighters are
// byte-for-byte unchanged. New rows (jump/crouch/dash/block/grab/throw) are
// added in T21 by appending to ANIMATION_ROWS.

/**
 * @typedef {'base'|'normal'|'special'|'movement'|'defense'|'grab'} AnimationRowRole
 * @typedef {Object} AnimationRow
 * @property {string} id            Sprite-sheet / row id (the sheet key).
 * @property {string} label         Display name (gym navigator, admin tabs).
 * @property {string} group         Navigator group label.
 * @property {number} frameCount    Default frame count for newly generated rows.
 * @property {AnimationRowRole} role
 * @property {boolean} moveAnimation  True when the row plays as a move-triggered
 *   animation (the engine's MOVE_SHEETS set); false for state-pose rows (base).
 */

/** @type {AnimationRow[]} */
export const ANIMATION_ROWS = [
  // Canonical 5 (the default registry — existing fighters are exactly these).
  { id: 'base', label: 'Idle / base', group: 'Base', frameCount: 6, role: 'base', moveAnimation: false },
  { id: 'punch', label: 'Punch', group: 'Normals', frameCount: 6, role: 'normal', moveAnimation: true },
  { id: 'kick', label: 'Kick', group: 'Normals', frameCount: 6, role: 'normal', moveAnimation: true },
  { id: 'special_1', label: 'Special 1', group: 'Specials', frameCount: 6, role: 'special', moveAnimation: true },
  { id: 'special_2', label: 'Special 2', group: 'Specials', frameCount: 6, role: 'special', moveAnimation: true },
  // T21 rows. jump/crouch/block are state-driven — the engine plays them via
  // the state→row map (src/core/animationRowPlayback.ts) when a fighter owns
  // the row, falling back to base otherwise. dash_forward/dash_back are
  // generatable + authorable but have no FighterState yet, so they do not play
  // in-engine (documented gap; needs a movement-system change). grab/throw are
  // move-triggered (moveAnimation:true → MOVE_SHEETS) — latent until a move
  // references them.
  { id: 'jump', label: 'Jump', group: 'Movement', frameCount: 6, role: 'movement', moveAnimation: false },
  { id: 'crouch', label: 'Crouch', group: 'Movement', frameCount: 6, role: 'movement', moveAnimation: false },
  { id: 'dash_forward', label: 'Dash Forward', group: 'Movement', frameCount: 6, role: 'movement', moveAnimation: false },
  { id: 'dash_back', label: 'Dash Back', group: 'Movement', frameCount: 6, role: 'movement', moveAnimation: false },
  { id: 'block', label: 'Block', group: 'Defense', frameCount: 6, role: 'defense', moveAnimation: false },
  { id: 'grab', label: 'Grab', group: 'Grapple', frameCount: 6, role: 'grab', moveAnimation: true },
  { id: 'throw', label: 'Throw', group: 'Grapple', frameCount: 6, role: 'grab', moveAnimation: true },
  // walk_forward/walk_back are state-driven like jump/crouch/block, but they
  // LOOP (a walk cycle) rather than play-once-and-hold. The engine plays them
  // via the state→row map when a fighter owns the row, falling back to the
  // base-frame walk shuffle otherwise — so existing fighters are unchanged.
  { id: 'walk_forward', label: 'Walk Forward', group: 'Movement', frameCount: 6, role: 'movement', moveAnimation: false },
  { id: 'walk_back', label: 'Walk Back', group: 'Movement', frameCount: 6, role: 'movement', moveAnimation: false },
];

/** Ordered list of every row id. */
export const SHEET_IDS = ANIMATION_ROWS.map((row) => row.id);

/** Row ids that play as move-triggered animations (the engine's MOVE_SHEETS). */
export const MOVE_SHEET_IDS = ANIMATION_ROWS.filter((row) => row.moveAnimation).map((row) => row.id);

/** Display label per row id. */
export const SHEET_LABELS = Object.fromEntries(ANIMATION_ROWS.map((row) => [row.id, row.label]));

/**
 * @param {string} id
 * @returns {AnimationRow | undefined}
 */
export function getRow(id) {
  return ANIMATION_ROWS.find((row) => row.id === id);
}

/**
 * Navigator grouping derived from row order: groups appear in first-seen order,
 * rows within a group keep registry order.
 * @returns {{ label: string, sheets: string[] }[]}
 */
export function sheetGroups() {
  /** @type {string[]} */
  const order = [];
  /** @type {Map<string, string[]>} */
  const byGroup = new Map();
  for (const row of ANIMATION_ROWS) {
    if (!byGroup.has(row.group)) {
      byGroup.set(row.group, []);
      order.push(row.group);
    }
    byGroup.get(row.group).push(row.id);
  }
  return order.map((label) => ({ label, sheets: byGroup.get(label) }));
}
