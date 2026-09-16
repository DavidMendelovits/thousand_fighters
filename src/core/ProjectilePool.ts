import Phaser from 'phaser';
import type { Fighter } from './Fighter';
import type { ProjectileConfig,CombatStats } from '../schema/types';
import { boxToWorld, type AABB } from '../util/aabb';

export type ProjectileInstance = {
  uid: number;
  owner: Fighter;
  config: ProjectileConfig;
  attackStats: CombatStats;
  ownerMoveSerial: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  lifetime: number;
  delayRemaining: number;
  age: number;
  piercesRemaining: number;
  hasHit: Set<string>;
  body: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
  cue?: Phaser.GameObjects.Graphics;
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
    if (config.visual && body instanceof Phaser.GameObjects.Image) body.setDisplaySize(config.width, config.height);
    const cue = config.visual ? this.scene.add.graphics().setDepth(12) : undefined;
    this.active.push({
      uid: this.nextUid,
      owner,
      config,
      attackStats:{...owner.stats},
      ownerMoveSerial:owner.moveSerial,
      x,
      y,
      vx: config.velocity
        ? (config.velocity.x ?? 0) * (config.velocity.relativeToFacing === false ? 1 : facing)
        : config.speed * facing,
      vy: config.velocity?.y ?? 0,
      facing,
      lifetime: config.lifetime,
      delayRemaining: config.delayFrames ?? 0,
      age: 0,
      cue,
      piercesRemaining: config.pierces ?? 1,
      hasHit: new Set(),
      body,
    });
    this.nextUid += 1;
  }

  update(): void {
    for (const projectile of this.active) {
      projectile.age += 1;
      if (projectile.delayRemaining > 0) {
        projectile.delayRemaining -= 1;
        projectile.body.setVisible(false);
        const cue = projectile.cue;
        if (cue) {
          cue.clear().lineStyle(2, projectile.config.visual!.accent, 0.85);
          const radius = 12 + (projectile.age % 12);
          cue.strokeEllipse(projectile.x, Math.min(386, projectile.y), radius * 2, 14);
          // A floor marker makes overhead casts readable before impact.
          cue.lineStyle(1, projectile.config.visual!.color, 0.55);
          cue.strokeEllipse(projectile.x, 389, 40, 8);
        }
        continue;
      }
      projectile.cue?.clear();
      projectile.body.setVisible(true);
      projectile.lifetime -= 1;
      projectile.vy += projectile.config.gravity ?? 0;
      projectile.x += projectile.vx;
      projectile.y += projectile.vy;
      projectile.body.setPosition(projectile.x, projectile.y);
      if (projectile.body instanceof Phaser.GameObjects.Image) {
        if (projectile.config.visual) {
          projectile.body.setDisplaySize(projectile.config.width, projectile.config.height);
          projectile.body.setFlipX(projectile.facing === -1);
          projectile.body.setAngle(projectile.config.visual.kind === 'scrap' ? projectile.age * 13 : 0);
        } else projectile.body.setScale(projectile.facing, 1);
      }
    }

    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      const projectile = this.active[i];
      if (projectile.lifetime <= 0 || projectile.piercesRemaining <= 0 || projectile.x < -80 || projectile.x > 880 || projectile.y < -180 || projectile.y > 510) {
        projectile.body.destroy();
        projectile.cue?.destroy();
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

  clear(): void {
    for (const projectile of this.active) { projectile.body.destroy(); projectile.cue?.destroy(); }
    this.active.length = 0;
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
    oldest.cue?.destroy();
    this.active.splice(this.active.indexOf(oldest), 1);
    return true;
  }
}
