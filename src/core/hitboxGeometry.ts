import type { Hitbox, HitboxKeyframe } from '../schema/types';

export type KeyframedHitbox = {
  hitbox: Hitbox;
  keyframes?: HitboxKeyframe[];
  // Frames since activation, drives keyframe interpolation.
  age: number;
};

/**
 * Effective hitbox geometry for the current activation age: linear
 * interpolation across keyframes, anchored by an implicit keyframe at
 * atFrame 0 carrying the base geometry. Clamps to the last keyframe.
 */
export function interpolateHitboxGeometry(active: KeyframedHitbox): { x: number; y: number; width: number; height: number } {
  const base = active.hitbox;
  if (!active.keyframes?.length) return base;

  const resolved = active.keyframes
    .map((keyframe) => ({
      atFrame: keyframe.atFrame,
      x: keyframe.x ?? base.x,
      y: keyframe.y ?? base.y,
      width: keyframe.width ?? base.width,
      height: keyframe.height ?? base.height,
    }))
    .sort((a, b) => a.atFrame - b.atFrame);
  if (resolved[0].atFrame > 0) {
    resolved.unshift({ atFrame: 0, x: base.x, y: base.y, width: base.width, height: base.height });
  }

  const age = active.age;
  if (age <= resolved[0].atFrame) return resolved[0];
  const last = resolved[resolved.length - 1];
  if (age >= last.atFrame) return last;

  for (let i = 1; i < resolved.length; i += 1) {
    const next = resolved[i];
    if (age > next.atFrame) continue;
    const prev = resolved[i - 1];
    const span = next.atFrame - prev.atFrame;
    const t = span > 0 ? (age - prev.atFrame) / span : 1;
    return {
      x: prev.x + (next.x - prev.x) * t,
      y: prev.y + (next.y - prev.y) * t,
      width: prev.width + (next.width - prev.width) * t,
      height: prev.height + (next.height - prev.height) * t,
    };
  }
  return last;
}
