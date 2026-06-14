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
  blockstun: 'block',
};

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
 * Frame index within a state row: a one-shot advance that holds the last frame.
 * Rows are authored so the final frame is the settled/held pose (crouch held,
 * guard held, jump apex/descent), so plain clamp-and-hold reads correctly with
 * no per-row mode flags. `elapsed` is the (visual-delay-adjusted) state frame.
 */
export function stateRowFrame(elapsed: number, frameCount: number): number {
  if (frameCount <= 1) return 0;
  const advanced = Math.floor(Math.max(0, elapsed) / STATE_ROW_TICKS);
  return Math.min(advanced, frameCount - 1);
}
