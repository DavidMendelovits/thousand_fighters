import type { Box, GymFrame } from './loadGymData';

/**
 * A1 — when a frame's anchor moves, its anchor-relative collision boxes must
 * move with it so the body stays where it is.
 *
 * frameData stores `hurtbox`/`attackBox` as offsets from the anchor
 * (extract_row_frames.py: `x = left - anchor_x`). The convert pipeline derives
 * all runtime collision from those. If you re-pick the anchor (Δ = new − old)
 * without touching the boxes, every derived box shifts by Δ and collision
 * drifts. The body pixels didn't move, so the box's offset from the *new*
 * anchor is Δ smaller. Pure translation, exact — width/height never change.
 */
export function translateBoxesForAnchorDelta(frame: GymFrame, baselineAnchor: { x: number; y: number }): void {
  const dx = frame.anchor.x - baselineAnchor.x;
  const dy = frame.anchor.y - baselineAnchor.y;
  if (dx === 0 && dy === 0) return;
  shift(frame.hurtbox, dx, dy);
  shift(frame.attackBox, dx, dy);
}

function shift(box: Box | null | undefined, dx: number, dy: number): void {
  if (!box) return;
  box.x -= dx;
  box.y -= dy;
}
