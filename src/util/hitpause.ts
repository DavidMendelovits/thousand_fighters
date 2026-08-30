export class HitPause {
  static trigger(scene: { hitPauseFrames: number }, frames: number): void {
    scene.hitPauseFrames = Math.max(scene.hitPauseFrames, frames);
  }
}

/** Hitstop a blocked hit earns — enough to feel contact, not enough to reward mashing into guard. */
export const BLOCK_HITSTOP_FRAMES = 2;

/** Hitstop for grabs connecting. */
export const GRAB_HITSTOP_FRAMES = 5;

/**
 * Heavier hits freeze longer. Pure so smoke_engine_feel.mjs can test it.
 * Damage ~4 (jab) → 4 frames, ~12 (heavy) → 6, 24+ (super) caps at 9.
 */
export function hitstopForDamage(damage: number): number {
  return Math.max(4, Math.min(9, 3 + Math.round(damage / 4)));
}
