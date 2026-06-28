/**
 * moveSelection.ts
 *
 * Pure, Phaser-free move-selection logic extracted for testability (mirrors the
 * pattern in animationRowPlayback.ts). Fighter.findTriggeredMove delegates here.
 *
 * Key invariant: when multiple moves match the current input window, prefer the
 * one with the LONGEST trigger.sequence (motion specials beat bare buttons even
 * when the bare button appears earlier in the move list). Array order breaks ties
 * so the first match wins among equal-length sequences.
 */

import type { Move } from '../schema/types';
import { InputBuffer } from './InputBuffer';

/** The subset of Fighter state that move selection reads. */
export interface MoveSelectionContext {
  state: import('../schema/types').FighterState;
  grounded: boolean;
  currentMove: Move | null;
}

/**
 * From a list of moves, find the best match given the current input buffer,
 * fighter state, and whether we're looking for a cancel (forCancel=true) or a
 * fresh activation (forCancel=false).
 *
 * Returns the matching Move with the longest trigger.sequence, or null.
 */
export function selectTriggeredMove(
  moves: Move[],
  buffer: InputBuffer,
  ctx: MoveSelectionContext,
  forCancel: boolean,
): Move | null {
  let best: Move | null = null;
  for (const move of moves) {
    const trigger = move.trigger;
    if (!trigger.allowedStates.includes(ctx.state)) continue;
    if (forCancel && trigger.cancelFrom && ctx.currentMove && !trigger.cancelFrom.includes(ctx.currentMove.id)) continue;
    if (!ctx.grounded && move.airOk !== true) continue;
    if (ctx.grounded && move.groundOk === false) continue;
    if (!buffer.matchSequence(trigger.sequence, trigger.window ?? 15)) continue;
    // Prefer the longest sequence; keep array order for tie-breaks (strictly-greater).
    if (best === null || trigger.sequence.length > best.trigger.sequence.length) {
      best = move;
    }
  }
  return best;
}
