import type { Fighter } from './Fighter';
import type { Move, MoveEvent } from '../schema/types';

export class MoveExecutor {
  static start(fighter: Fighter, move: Move): void {
    fighter.currentMove = move;
    fighter.movePhaseIndex = 0;
    fighter.movePhaseFrame = 0;
    fighter.activeHitboxes.clear();
    fighter.activeGrabs.clear();
    fighter.hasHitThisMove.clear();
    fighter.changeState('attack');
    fighter.animationKey = move.animation;
  }

  static tick(fighter: Fighter): void {
    if (!fighter.currentMove) return;
    const move = fighter.currentMove;
    const phase = move.phases[fighter.movePhaseIndex];
    if (!phase) {
      this.end(fighter);
      return;
    }

    for (const { onFrame, event } of phase.events) {
      if (onFrame === fighter.movePhaseFrame) {
        this.handleEvent(fighter, event);
      }
    }

    fighter.ageActiveHitboxes();
    fighter.movePhaseFrame += 1;

    if (fighter.movePhaseFrame >= phase.frames) {
      fighter.movePhaseIndex += 1;
      fighter.movePhaseFrame = 0;

      if (fighter.movePhaseIndex >= move.phases.length) {
        this.end(fighter);
      }
    }
  }

  static handleEvent(fighter: Fighter, event: MoveEvent): void {
    switch (event.type) {
      case 'hitbox_active':
        fighter.setActiveHitbox(event.id ?? 'default', event.hitbox, event.actor, event.keyframes);
        break;
      case 'hitbox_end':
        fighter.clearActiveHitbox(event.id ?? 'default');
        break;
      case 'grab_check':
        fighter.setActiveGrab(event.id ?? 'grab', event.grab, event.actor);
        break;
      case 'grab_end':
        fighter.clearActiveGrab(event.id ?? 'grab');
        break;
      case 'spawn_projectile':
        fighter.scene.projectiles.spawn(event.projectile, fighter, event.offsetX, event.offsetY);
        break;
      case 'spawn_projectile_at_target': {
        const target = (fighter.scene as { fighters?: [Fighter, Fighter] }).fighters?.find((candidate) => candidate !== fighter);
        if (target) {
          fighter.scene.projectiles.spawnAt(event.projectile, fighter, target.x + event.offsetX, target.y + event.offsetY, fighter.facing);
        }
        break;
      }
      case 'spawn_projectile_from_sky': {
        const target = (fighter.scene as { fighters?: [Fighter, Fighter] }).fighters?.find((candidate) => candidate !== fighter);
        if (target) {
          fighter.scene.projectiles.spawnAt(event.projectile, fighter, target.x + event.targetOffsetX, target.y + event.spawnOffsetY, fighter.facing);
        }
        break;
      }
      case 'set_velocity':
        if (event.vx !== undefined) fighter.vx = event.relativeToFacing ? event.vx * fighter.facing : event.vx;
        if (event.vy !== undefined) fighter.vy = event.vy;
        break;
      case 'teleport':
        fighter.x += event.offsetX * fighter.facing;
        fighter.y += event.offsetY;
        break;
      case 'invulnerable':
        fighter.invulnerable = {
          duration: event.duration,
          against: event.against ?? ['high', 'mid', 'low', 'projectile'],
        };
        break;
      case 'armor':
        fighter.armor = { hits: event.hits, duration: event.duration };
        break;
      case 'modify_hurtbox':
        fighter.setActorHurtbox(event.actor, event.hurtbox);
        break;
      case 'set_actor_offset':
        fighter.setActorOffset(event.actor, event.offsetX, event.offsetY ?? 0, event.duration ?? null);
        break;
      case 'reset_actor_offset':
        fighter.resetActorOffset(event.actor);
        break;
      case 'set_follow_delay':
        fighter.setFollowDelay(event.actor, event.frames, event.duration ?? null);
        break;
      case 'swap_lead':
        fighter.swapLead();
        break;
      case 'enter_fusion':
        fighter.enterFusion(event.duration);
        break;
      case 'exit_fusion':
        fighter.exitFusion();
        break;
      case 'play_animation':
        fighter.animationKey = event.name;
        break;
      case 'screen_shake':
        fighter.scene.cameras.main.shake(event.duration * (1000 / 60), event.intensity);
        break;
      case 'spawn_vfx': {
        if (!fighter.scene.textures.exists(event.name)) break;
        const vfx = fighter.scene.add
          .image(fighter.x + event.offsetX * fighter.facing, fighter.y + event.offsetY, event.name)
          .setOrigin(0.5)
          .setDepth(40)
          .setAlpha(0.95);
        fighter.scene.tweens.add({
          targets: vfx,
          scale: { from: 0.85, to: 1.55 },
          alpha: { from: 0.95, to: 0 },
          duration: 260,
          onComplete: () => vfx.destroy(),
        });
        break;
      }
      case 'play_sound': {
        const key = `${fighter.config.id}:${event.name}`;
        const resolvedKey = fighter.scene.cache.audio.has(key) ? key : event.name;
        if (fighter.scene.cache.audio.has(resolvedKey)) {
          fighter.scene.sound.play(resolvedKey, { volume: 0.6 });
        }
        break;
      }
      default: {
        const exhaustive: never = event;
        return exhaustive;
      }
    }
  }

  static end(fighter: Fighter): void {
    const endState = fighter.currentMove?.endState;
    fighter.currentMove = null;
    fighter.activeHitboxes.clear();
    fighter.activeGrabs.clear();
    fighter.hurtboxOverride = null;
    fighter.clearActorMoveOverrides();
    fighter.changeState(endState ?? (fighter.grounded ? 'idle' : 'airborne'));
  }

  static tryCancel(fighter: Fighter, newMove: Move): boolean {
    if (!fighter.currentMove) return false;
    const phase = fighter.currentMove.phases[fighter.movePhaseIndex];
    if (!phase?.cancellable) return false;

    const cancels = fighter.currentMove.cancelInto ?? [];
    const triggerCancel = newMove.trigger.cancelFrom?.includes(fighter.currentMove.id) ?? false;
    if (!cancels.includes(newMove.id) && !triggerCancel) return false;

    this.start(fighter, newMove);
    return true;
  }
}
