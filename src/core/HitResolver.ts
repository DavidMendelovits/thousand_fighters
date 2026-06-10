import type { Fighter } from './Fighter';
import type { FighterScene, GrabSpec, Hitbox } from '../schema/types';
import { HitPause } from '../util/hitpause';

export class HitResolver {
  static resolveGrab(attacker: Fighter, defender: Fighter, grab: GrabSpec, grabId: string): boolean {
    const hitKey = `${defender.id}:grab:${grabId}`;
    if (attacker.hasHitThisMove.has(hitKey)) return false;
    attacker.hasHitThisMove.add(hitKey);

    // Grabs whiff against invulnerable, already-held, downed, or dead opponents.
    if (defender.invulnerable) return false;
    if (defender.state === 'grabbed' || defender.state === 'knockdown' || defender.state === 'getup' || defender.state === 'dead') {
      return false;
    }

    defender.health = Math.max(0, defender.health - (grab.damage ?? 0));

    // Facing-relative offset of the victim at the moment of contact, so a
    // pull can start from where the tentacle actually caught them.
    const contactOffsetX = (defender.x - attacker.x) * attacker.facing;
    defender.grabbedBy = attacker;
    defender.grabHold = {
      offsetX: grab.holdOffsetX,
      offsetY: grab.holdOffsetY ?? 0,
      remaining: grab.holdDuration,
      pull: grab.pullFrames
        ? { fromX: contactOffsetX, frames: grab.pullFrames, elapsed: 0 }
        : null,
      release: {
        knockback: grab.releaseKnockback ?? { x: 2.5, y: 0 },
        hitstun: grab.releaseHitstun ?? 16,
        launches: grab.releaseLaunches ?? false,
        knockdown: grab.releaseKnockdown ?? false,
      },
    };
    defender.changeState('grabbed');

    if (defender.health <= 0) defender.changeState('dead');

    if (grab.grabSound) {
      const scene = attacker.scene as FighterScene;
      const key = `${attacker.config.id}:${grab.grabSound}`;
      const resolvedKey = scene.cache.audio.has(key) ? key : grab.grabSound;
      if (scene.cache.audio.has(resolvedKey)) {
        scene.sound.play(resolvedKey, { volume: 0.6 });
      }
    }

    HitPause.trigger(attacker.scene, 4);
    return true;
  }

  static resolve(attacker: Fighter, defender: Fighter, hitbox: Hitbox, hitboxId: string): boolean {
    const hitKey = `${defender.id}:${hitboxId}`;
    if (attacker.hasHitThisMove.has(hitKey)) return false;
    attacker.hasHitThisMove.add(hitKey);

    if (defender.invulnerable) {
      const level = hitbox.level ?? 'mid';
      if (defender.invulnerable.against.includes(level)) return false;
    }

    if (defender.armor && defender.armor.hits > 0) {
      defender.armor.hits -= 1;
      defender.health = Math.max(0, defender.health - hitbox.damage * 0.5);
      return true;
    }

    const blocking = !hitbox.unblockable && this.isBlocking(defender, attacker, hitbox);

    if (blocking) {
      defender.blockstun = hitbox.blockstun;
      defender.health = Math.max(0, defender.health - (hitbox.chipDamage ?? 0));
      defender.changeState('blockstun');
      defender.vx = Math.sign(defender.x - attacker.x) * 2;
    } else {
      const wasGrounded = defender.grounded;
      defender.hitstun = hitbox.hitstun;
      defender.health = Math.max(0, defender.health - hitbox.damage);
      defender.vx = hitbox.knockback.x * attacker.facing;
      defender.vy = hitbox.knockback.y;

      if (hitbox.launches || !wasGrounded) {
        defender.grounded = false;
        defender.changeState('juggle');
      } else if (hitbox.knockdown) {
        defender.changeState('knockdown');
      } else {
        defender.changeState('hitstun');
      }

      HitPause.trigger(attacker.scene, 4);
    }

    if (defender.health <= 0) defender.changeState('dead');

    if (hitbox.hitSound) {
      const scene = attacker.scene as FighterScene;
      if (!scene._soundsPlayedThisFrame) scene._soundsPlayedThisFrame = new Set();
      if (!scene._soundsPlayedThisFrame.has(hitbox.hitSound) && scene.cache.audio.has(hitbox.hitSound)) {
        scene.sound.play(hitbox.hitSound, { volume: 0.5 });
        scene._soundsPlayedThisFrame.add(hitbox.hitSound);
      }
    }

    return true;
  }

  static isBlocking(defender: Fighter, attacker: Fighter, hitbox: Hitbox): boolean {
    if (defender.state === 'attack' || defender.state === 'hitstun' || defender.state === 'juggle') return false;
    const awayFromAttacker = Math.sign(defender.x - attacker.x);
    const input = defender.inputBuffer.current();
    const holdingBack = (awayFromAttacker === 1 && input.right) || (awayFromAttacker === -1 && input.left);
    if (!holdingBack) return false;

    const crouching = defender.state === 'crouch';
    if (hitbox.level === 'low' && !crouching) return false;
    if (hitbox.level === 'high' && crouching) return false;

    return true;
  }
}
