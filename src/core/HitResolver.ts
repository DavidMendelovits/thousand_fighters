import type { Fighter } from './Fighter';
import type { Hitbox } from '../schema/types';
import { HitFx } from '../util/HitFx';
import { HitPause } from '../util/hitpause';

const COMBO_STATES = new Set(['hitstun', 'juggle', 'knockdown', 'getup']);

export class HitResolver {
  static resolve(attacker: Fighter, defender: Fighter, hitbox: Hitbox, hitboxId: string): boolean {
    const hitKey = `${defender.id}:${hitboxId}`;
    if (attacker.hasHitThisMove.has(hitKey)) return false;
    attacker.hasHitThisMove.add(hitKey);

    if (defender.invulnerable) {
      const level = hitbox.level ?? 'mid';
      if (defender.invulnerable.against.includes(level)) return false;
    }

    const contactX = (attacker.x + defender.x) / 2;
    const contactY = defender.y - 60;

    if (defender.armor && defender.armor.hits > 0) {
      defender.armor.hits -= 1;
      defender.health = Math.max(0, defender.health - hitbox.damage * 0.5);
      HitFx.spark(attacker.scene, contactX, contactY, 'block');
      HitFx.shake(attacker.scene, 80, 0.004);
      return true;
    }

    const blocking = !hitbox.unblockable && this.isBlocking(defender, attacker, hitbox);

    if (blocking) {
      defender.blockstun = hitbox.blockstun;
      defender.health = Math.max(0, defender.health - (hitbox.chipDamage ?? 0));
      defender.changeState('blockstun');
      defender.vx = Math.sign(defender.x - attacker.x) * 2;
      HitFx.spark(attacker.scene, contactX, contactY, 'block');
    } else {
      const wasGrounded = defender.grounded;
      const wasInComboState = COMBO_STATES.has(defender.state);
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

      defender.comboReceived = wasInComboState ? defender.comboReceived + 1 : 1;

      const ko = defender.health <= 0;
      const heavy = !ko && (hitbox.damage >= 12 || hitbox.launches === true || hitbox.knockdown === true);
      const sparkKind = ko ? 'ko' : heavy ? 'heavy' : 'hit';
      HitFx.spark(attacker.scene, contactX, contactY, sparkKind);
      HitFx.shake(attacker.scene, ko ? 320 : heavy ? 200 : 100, ko ? 0.018 : heavy ? 0.011 : 0.005);
      if (ko) HitFx.flashWhite(attacker.scene, 110);

      if (defender.comboReceived >= 2) {
        HitFx.comboPopup(attacker.scene, defender.x, defender.y - 130, defender.comboReceived, attacker.playerNum);
      }

      HitPause.trigger(attacker.scene, ko ? 8 : heavy ? 6 : 4);
    }

    if (defender.health <= 0) defender.changeState('dead');
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
