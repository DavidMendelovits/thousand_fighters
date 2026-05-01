import type { Fighter } from './Fighter';
import type { Move, MoveEvent } from '../schema/types';

export class MoveExecutor {
  static start(fighter: Fighter, move: Move): void {
    fighter.currentMove = move;
    fighter.movePhaseIndex = 0;
    fighter.movePhaseFrame = 0;
    fighter.activeHitboxes.clear();
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
        fighter.activeHitboxes.set(event.id ?? 'default', event.hitbox);
        break;
      case 'hitbox_end':
        fighter.activeHitboxes.delete(event.id ?? 'default');
        break;
      case 'spawn_projectile':
        fighter.scene.projectiles.spawn(event.projectile, fighter, event.offsetX, event.offsetY);
        break;
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
        fighter.hurtboxOverride = event.hurtbox;
        fighter.hurtboxDisabled = event.hurtbox === null;
        break;
      case 'play_animation':
        fighter.animationKey = event.name;
        break;
      case 'screen_shake':
        fighter.scene.cameras.main.shake(event.duration * (1000 / 60), event.intensity);
        break;
      case 'play_sound':
      case 'spawn_vfx':
        break;
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
    fighter.hurtboxOverride = null;
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
