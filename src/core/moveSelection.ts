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
  contactThisMove?: boolean;
  hitThisMove?: boolean;
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
  let bestFrame = Infinity;
  for (const move of moves) {
    const trigger = move.trigger;
    if(!forCancel && trigger.cancelOnly)continue;
    if (!forCancel && !trigger.allowedStates.includes(ctx.state==='dash'?'idle':ctx.state)) continue;
    if (forCancel) {
      const current=ctx.currentMove;
      if(!current || !current.phases.some(p=>p.cancellable))continue;
      if(!current.cancelInto?.includes(move.id) && !trigger.cancelFrom?.includes(current.id))continue;
      const condition=trigger.cancelOn??current.cancelOn;
      if(condition==='hit' && !ctx.hitThisMove)continue;
      if(condition==='contact' && !ctx.contactThisMove)continue;
    }
    if (forCancel && trigger.cancelFrom && ctx.currentMove && !trigger.cancelFrom.includes(ctx.currentMove.id)) continue;
    if (!ctx.grounded && move.airOk !== true) continue;
    if (ctx.grounded && move.groundOk === false) continue;
    const matched=buffer.matchCommand(trigger.sequence,trigger.window??15,trigger.activationFrames??6,trigger.directions);
    if (matched===null) continue;
    // Prefer the longest sequence; keep array order for tie-breaks (strictly-greater).
    const score=trigger.sequence.length+(trigger.directions?1:0)+(forCancel&&trigger.cancelOnly?100:0);
    const bestScore=best?best.trigger.sequence.length+(best.trigger.directions?1:0)+(forCancel&&best.trigger.cancelOnly?100:0):-1;
    if (best === null || score>bestScore || (score===bestScore&&trigger.cancelOnly&&matched<bestFrame)) {
      best = move;
      bestFrame=matched;
    }
  }
  return best;
}
