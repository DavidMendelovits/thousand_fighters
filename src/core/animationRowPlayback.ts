import type { FighterState } from '../schema/types';

/**
 * Engine playback for state-driven animation rows (T21).
 *
 * Non-move fighter states render off the `base` sheet by default. When a
 * fighter OWNS a dedicated row for a state (jump/crouch/block), the engine
 * plays that row instead. This module is the pure, Phaser-free core of that
 * decision so it can be unit-tested directly (scripts/smoke_engine_rows.mjs),
 * the way the guard-box logic is.
 *
 * The hard safety invariant: a fighter that does NOT own the row falls back to
 * `base`, byte-for-byte unchanged. Existing fighters have none of these rows,
 * so their render path is untouched — that fallback is what protects every
 * shipped fighter, and it is the thing the smoke test pins.
 *
 * Out of scope here:
 * - grab/throw are move-triggered (MOVE_SHEETS), not state-driven — they never
 *   appear in this map.
 * - dash_forward/dash_back have no FighterState, so they cannot play; they are
 *   authorable rows only (documented gap).
 */

/** FighterState → the row id the engine plays when the fighter owns that row. */
export const STATE_ROW_MAP: Partial<Record<FighterState, string>> = {
  jump_startup: 'jump',
  airborne: 'jump',
  crouch: 'crouch',
  crouch_transition: 'crouch',
  block: 'block',
  blockstun: 'block',
  walk_forward: 'walk_forward',
  walk_back: 'walk_back',
};

/**
 * Rows that LOOP rather than play-once-and-hold. Walk cycles repeat for as long
 * as the fighter holds the direction; jump/crouch/block settle on a held pose.
 * `stateRowFrame` reads this to pick modulo vs. clamp-and-hold.
 */
const LOOPING_STATE_ROWS = new Set<string>(['walk_forward', 'walk_back']);

/** True when the row's state playback should loop (walk) vs. hold its last frame. */
export function isLoopingStateRow(rowId: string): boolean {
  return LOOPING_STATE_ROWS.has(rowId);
}

/**
 * The sheet to render for a state-driven (non-move) frame. Returns the mapped
 * row only when `hasRowFrames(row)` is true; otherwise `'base'`.
 */
export function resolveStateSheet(
  state: FighterState,
  hasRowFrames: (rowId: string) => boolean,
): string {
  const row = STATE_ROW_MAP[state];
  if (row && hasRowFrames(row)) return row;
  return 'base';
}

/** Ticks each frame of a state row holds before advancing. */
export const STATE_ROW_TICKS = 6;

/**
 * Frame index within a state row. Hold rows (jump/crouch/block) advance once and
 * clamp on the last frame — they are authored so the final frame is the settled
 * pose (crouch held, guard held, jump descent). Loop rows (walk) wrap with
 * modulo so the cycle repeats while the state persists. `elapsed` is the
 * (visual-delay-adjusted) state frame; `loop` defaults to false (hold).
 */
export function stateRowFrame(elapsed: number, frameCount: number, loop = false): number {
  if (frameCount <= 1) return 0;
  const advanced = Math.floor(Math.max(0, elapsed) / STATE_ROW_TICKS);
  return loop ? advanced % frameCount : Math.min(advanced, frameCount - 1);
}
