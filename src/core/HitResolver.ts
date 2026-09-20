import type { Fighter } from './Fighter';
import type { FighterScene, GrabSpec, Hitbox, CombatStats, ImpactSpec } from '../schema/types';
import {effectiveStats,damageValue,knockbackScale} from './combatRules';
import { HitPause } from '../util/hitpause';
import { boxesOverlap, boxToWorld, type AABB } from '../util/aabb';

export class HitResolver {
  static resolveGrab(attacker: Fighter, defender: Fighter, grab: GrabSpec, grabId: string, projectile = false, stats?:CombatStats, ownerMoveSerial?:number, sourceFacing?:1|-1): boolean {
    const hitKey = `${defender.id}:grab:${grabId}`;
    if (attacker.hasHitThisMove.has(hitKey)) return false;
    attacker.hasHitThisMove.add(hitKey);

    // Grabs whiff against invulnerable, already-held, downed, or dead opponents.
    if (defender.invulnerable || defender.grabImmunity > 0 || (grab.groundOnly && !defender.grounded)) return false;
    if (defender.state === 'grabbed' || defender.state === 'knockdown' || defender.state === 'getup' || defender.state === 'dead') {
      return false;
    }

    const damage=damageValue(grab.damage??0,stats??attacker.stats??effectiveStats(),defender.stats??effectiveStats(),projectile,defender.combo?.priorHits(attacker.id)??0);
    defender.health = Math.max(0, defender.health - damage);
    this.confirm(attacker,defender,damage,false,!defender.grounded,ownerMoveSerial===undefined||ownerMoveSerial===attacker.moveSerial);

    // Facing-relative offset of the victim at the moment of contact, so a
    // pull can start from where the tentacle actually caught them.
    const contactOffsetX = (defender.x - attacker.x) * attacker.facing;
    defender.grabbedBy = attacker;
    defender.grabHold = {
      offsetX: grab.holdOffsetX,
      offsetY: grab.holdOffsetY ?? 0,
      remaining: grab.holdDuration,
      requiresAttack: !projectile,
      ...(grab.actorGrip ? {actorGrip:{...grab.actorGrip,duration:grab.holdDuration,fromX:defender.x,fromY:defender.y,torsoY:((defender.config.hurtboxes.idle?.y??-100)+(defender.config.hurtboxes.idle?.height??100)*.5)*defender.stats.size,facing:sourceFacing??attacker.facing}} : {}),
      anchor: grab.anchor === 'contact' ? { x: defender.x, y: defender.y, facing: sourceFacing??attacker.facing } : undefined,
      pull: grab.pullFrames
        ? { fromX: contactOffsetX, frames: grab.pullFrames, elapsed: 0 }
        : null,
      release: {
        ...(sourceFacing?{facing:sourceFacing}:{}),
        knockback: grab.releaseKnockback ?? { x: 2.5, y: 0 },
        hitstun: grab.releaseHitstun ?? 16,
        launches: grab.releaseLaunches ?? false,
        knockdown: grab.releaseKnockdown ?? false,
      },
    };
    if (grab.anchor === 'contact') {
      defender.grabHold.offsetX = 0;
      defender.grabHold.offsetY = 0;
      defender.grabHold.pull = null;
    }
    defender.vx = 0;
    defender.vy = 0;
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

  static resolve(attacker: Fighter, defender: Fighter, hitbox: Hitbox, hitboxId: string,
    source: { x: number; y: number; facing: 1 | -1; world?: AABB; projectile?:boolean; stats?:CombatStats; impact?:ImpactSpec; ownerMoveSerial?:number } = attacker): boolean {
    if (['dead','grabbed','knockdown','getup'].includes(defender.state)) return false;
    const hitKey = `${defender.id}:${hitboxId}`;
    if (attacker.hasHitThisMove.has(hitKey)) return false;
    attacker.hasHitThisMove.add(hitKey);

    if (defender.invulnerable) {
      const level = hitbox.level ?? 'mid';
      if (defender.invulnerable.against.includes(level)) return false;
    }

    const attackStats=source.stats??attacker.stats??effectiveStats();
    const defendStats=defender.stats??effectiveStats();
    const hits=defender.combo?.priorHits(attacker.id)??0;
    const damage=damageValue(hitbox.damage,attackStats,defendStats,source.projectile??false,hits);
    const force=knockbackScale(attackStats,defendStats,hits);
    const sameMove=source.ownerMoveSerial===undefined||source.ownerMoveSerial===attacker.moveSerial;
    if (defender.armor && defender.armor.hits > 0) {
      defender.armor.hits -= 1;
      defender.health = Math.max(0, defender.health - Math.round(damage * 0.5));
      if(sameMove)attacker.contactThisMove=true;
      this.impact(attacker.scene,defender,source.impact??hitbox.impact,true);
      if (defender.health <= 0) defender.changeState('dead');
      return true;
    }

    const blocking = !hitbox.unblockable && this.isBlocking(defender, source, hitbox);

    if (blocking) {
      if(sameMove)attacker.contactThisMove=true;
      defender.blockstun = hitbox.blockstun;
      defender.health = Math.max(0, defender.health - damageValue(hitbox.chipDamage??0,attackStats,defendStats,source.projectile??false));
      defender.changeState('blockstun');
      defender.vx = source.facing * 2;
    } else {
      const wasGrounded = defender.grounded;
      // Explicit stun is the complete lock duration, not a lower bound on
      // recoil. A six-tick interrupt must not inherit a 20-tick hit reaction.
      defender.hitstun = hitbox.stun ?? hitbox.hitstun;
      defender.health = Math.max(0, defender.health - damage);
      defender.vx = hitbox.knockback.x * source.facing * force;
      defender.vy = hitbox.knockback.y * Math.sqrt(force);
      this.confirm(attacker,defender,damage,false,!wasGrounded,sameMove);

      if (hits>=7 || (defender.combo?.juggle??0)>=4) {
        defender.hitstun=12;defender.vy=Math.max(3,defender.vy);defender.changeState('knockdown');
      } else if (hitbox.launches || !wasGrounded) {
        defender.grounded = false;
        defender.changeState('juggle');
      } else if (hitbox.knockdown) {
        defender.changeState('knockdown');
      } else if (hitbox.stun) {
        defender.vx = 0;
        defender.vy = 0;
        defender.changeState('stunned');
      } else {
        defender.changeState('hitstun');
      }

      HitPause.trigger(attacker.scene,hitbox.hitstop??Math.min(4,Math.max(1,Math.round(damage/35))));
    }
    this.impact(attacker.scene,defender,source.impact??hitbox.impact,blocking);

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

  static isBlocking(defender: Fighter, attacker: { x: number; y: number; facing: 1 | -1; world?: AABB }, hitbox: Hitbox): boolean {
    if(defender.controlledSummon)return false;
    if (['attack','dash','air_dodge','wavedash', 'hitstun', 'stunned', 'juggle', 'grabbed', 'knockdown', 'getup', 'dead'].includes(defender.state)) return false;
    const awayFromAttacker = Math.sign(defender.x - attacker.x);
    const input = defender.inputBuffer.current();
    const holdingBack = (awayFromAttacker === 1 && input.right) || (awayFromAttacker === -1 && input.left);
    if (!holdingBack) return false;

    // Guard-box path (T17): if the defender has a gym-authored guardbox for its
    // current state, block only when the incoming hitbox world AABB overlaps the
    // guard world AABB. No guardbox → fall through to the legacy level/crouch logic.
    const guardWorld = defender.getGuardboxWorld();
    if (guardWorld !== null) {
      const hitboxWorld = attacker.world ?? boxToWorld(hitbox, attacker.x, attacker.y, attacker.facing);
      return guardCovers(hitboxWorld, guardWorld);
    }

    const crouching = defender.state === 'crouch';
    if (hitbox.level === 'low' && !crouching) return false;
    if (hitbox.level === 'high' && crouching) return false;

    return true;
  }
  static impact(scene:FighterScene,defender:Fighter,spec:ImpactSpec|undefined,blocked=false):void {
    scene._combatImpacts??=[];
    scene._combatImpacts.push({x:defender.x,y:defender.y-65*(defender.stats?.size??1),spec:spec??{id:'strike',kind:'spark',color:0xffbd66,accent:0xffffff,durationTicks:14,radius:28},blocked,age:0});
    if(scene._combatImpacts.length>48)scene._combatImpacts.shift();
  }
  private static confirm(attacker:Fighter,defender:Fighter,damage:number,blocked:boolean,airborne:boolean,sameMove=true):void {
    if(sameMove){attacker.contactThisMove=true;attacker.hitThisMove=!blocked;}
    defender.combo?.register(attacker.id,damage,airborne);
    attacker.meter=Math.min(100,(attacker.meter??0)+Math.max(2,damage*.08));
    defender.meter=Math.min(100,(defender.meter??0)+damage*.035);
  }
}

/**
 * True when the incoming hitbox world AABB overlaps the defender's guard AABB.
 * Exported as a pure helper so `smoke_engine_guard.mjs` can unit-test it
 * without touching the game engine.
 */
export function guardCovers(hitboxWorld: AABB, guardWorld: AABB): boolean {
  return boxesOverlap(hitboxWorld, guardWorld);
}
