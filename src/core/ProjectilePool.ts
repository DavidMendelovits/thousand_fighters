import Phaser from 'phaser';
import type { Fighter } from './Fighter';
import type { ProjectileConfig } from '../schema/types';
import { boxToWorld, type AABB } from '../util/aabb';

export type ProjectileInstance = {
  uid: number;
  owner: Fighter;
  config: ProjectileConfig;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  lifetime: number;
  piercesRemaining: number;
  hasHit: Set<string>;
  body: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
};

export class ProjectilePool {
  private nextUid = 1;
  readonly active: ProjectileInstance[] = [];

  constructor(private readonly scene: Phaser.Scene) {}

  spawn(config: ProjectileConfig, owner: Fighter, offsetX: number, offsetY: number): void {
    const x = owner.x + offsetX * owner.facing;
    const y = owner.y + offsetY;
    this.spawnAt(config, owner, x, y, owner.facing);
  }

  spawnAt(config: ProjectileConfig, owner: Fighter, x: number, y: number, facing: 1 | -1 = owner.facing): void {
    if (!this.canSpawn(config, owner)) return;

    const body = this.scene.textures.exists(config.animation)
      ? this.scene.add.image(x, y, config.animation).setOrigin(0.5).setScale(facing, 1)
      : this.scene.add.rectangle(x, y, config.width, config.height, owner.playerNum === 1 ? 0xff914d : 0x75d5ff).setOrigin(0.5);
    this.active.push({
      uid: this.nextUid,
      owner,
      config,
      x,
      y,
      vx: config.velocity
        ? (config.velocity.x ?? 0) * (config.velocity.relativeToFacing === false ? 1 : facing)
        : config.speed * facing,
      vy: config.velocity?.y ?? 0,
      facing,
      lifetime: config.lifetime,
      piercesRemaining: config.pierces ?? 1,
      hasHit: new Set(),
      body,
    });
    this.nextUid += 1;
  }

  update(): void {
    for (const projectile of this.active) {
      projectile.lifetime -= 1;
      projectile.vy += projectile.config.gravity ?? 0;
      projectile.x += projectile.vx;
      projectile.y += projectile.vy;
      projectile.body.setPosition(projectile.x, projectile.y);
      if (projectile.body instanceof Phaser.GameObjects.Image) {
        projectile.body.setScale(projectile.facing, 1);
      }
    }

    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      const projectile = this.active[i];
      if (projectile.lifetime <= 0 || projectile.piercesRemaining <= 0 || projectile.x < -80 || projectile.x > 880) {
        projectile.body.destroy();
        this.active.splice(i, 1);
      }
    }
  }

  markHit(projectile: ProjectileInstance, defenderId: string): boolean {
    if (projectile.hasHit.has(defenderId)) return false;
    projectile.hasHit.add(defenderId);
    projectile.piercesRemaining -= 1;
    return true;
  }

  getHitboxWorld(projectile: ProjectileInstance): AABB {
    return boxToWorld(projectile.config.hitbox, projectile.x, projectile.y, projectile.facing);
  }

  private canSpawn(config: ProjectileConfig, owner: Fighter): boolean {
    const maxActive = config.spawnPolicy?.maxActivePerOwner;
    if (maxActive === undefined) return true;

    const matchingProjectiles = this.active.filter((projectile) => projectile.owner === owner && projectile.config.id === config.id);
    if (matchingProjectiles.length < maxActive) return true;

    const behavior = config.spawnPolicy?.ifAlreadyActive ?? 'block_spawn';
    if (behavior === 'allow') return true;
    if (behavior === 'block_spawn') return false;

    const oldest = matchingProjectiles[0];
    oldest.body.destroy();
    this.active.splice(this.active.indexOf(oldest), 1);
    return true;
  }
}
