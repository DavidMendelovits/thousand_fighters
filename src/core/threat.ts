/**
 * threat.ts
 *
 * Pure, Phaser-free proximity-guard logic (mirrors the moveSelection.ts
 * pattern). Holding back only roots you into the visible `block` stance while
 * the opponent is actually threatening; otherwise back = walk_back retreat.
 * Fighter.runState delegates here so `smoke_engine_feel.mjs` can unit-test it.
 */

import type { FighterState } from '../schema/types';

/** The subset of a projectile that threat detection reads. */
export type ThreatProjectile = { x: number; vx: number };

/** How close an attacking opponent has to be to force guard stance. */
export const ATTACK_THREAT_RANGE = 260;
/** How close an approaching projectile has to be to force guard stance. */
export const PROJECTILE_THREAT_RANGE = 340;

export function isThreatened(
  defenderX: number,
  opponentX: number,
  opponentState: FighterState,
  opponentProjectiles: ThreatProjectile[],
): boolean {
  if (opponentState === 'attack' && Math.abs(opponentX - defenderX) <= ATTACK_THREAT_RANGE) {
    return true;
  }
  for (const projectile of opponentProjectiles) {
    const distance = Math.abs(projectile.x - defenderX);
    if (distance > PROJECTILE_THREAT_RANGE) continue;
    const approaching =
      (projectile.x < defenderX && projectile.vx > 0) ||
      (projectile.x > defenderX && projectile.vx < 0) ||
      (projectile.vx === 0 && distance < 80);
    if (approaching) return true;
  }
  return false;
}
