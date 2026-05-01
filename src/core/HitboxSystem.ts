import type { Fighter } from './Fighter';
import { HitResolver } from './HitResolver';
import type { ProjectilePool } from './ProjectilePool';
import { boxesOverlap } from '../util/aabb';

export class HitboxSystem {
  static checkAll(fighters: [Fighter, Fighter], projectiles: ProjectilePool): void {
    this.checkFighterHitboxes(fighters[0], fighters[1]);
    this.checkFighterHitboxes(fighters[1], fighters[0]);
    this.checkProjectiles(fighters, projectiles);
  }

  private static checkFighterHitboxes(attacker: Fighter, defender: Fighter): void {
    const hurtbox = defender.getHurtboxWorld();
    if (!hurtbox) return;

    for (const active of attacker.getActiveHitboxesWorld()) {
      if (boxesOverlap(active.world, hurtbox)) {
        HitResolver.resolve(attacker, defender, active.hitbox, active.id);
      }
    }
  }

  private static checkProjectiles(fighters: [Fighter, Fighter], projectiles: ProjectilePool): void {
    for (const projectile of projectiles.active) {
      const defender = fighters.find((fighter) => fighter !== projectile.owner);
      if (!defender) continue;

      const hurtbox = defender.getHurtboxWorld();
      if (!hurtbox) continue;

      const projectileHitbox = projectiles.getHitboxWorld(projectile);
      if (!boxesOverlap(projectileHitbox, hurtbox)) continue;

      if (defender.invulnerable?.against.includes('projectile')) continue;
      if (!projectiles.markHit(projectile, defender.id)) continue;

      HitResolver.resolve(projectile.owner, defender, projectile.config.hitbox, `projectile:${projectile.uid}`);
    }
  }
}
