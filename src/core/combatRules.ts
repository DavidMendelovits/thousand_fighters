import type {CombatStats, PowerUpSpec, Hurtbox} from '../schema/types';

export const NEUTRAL_STATS: CombatStats = {attack:1,defense:1,projectileAttack:1,projectileDefense:1,speed:1,knockback:1,weight:1,size:1};
const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
export function effectiveStats(base:Partial<CombatStats>={},powers:PowerUpSpec[]=[]):CombatStats {
  const result={...NEUTRAL_STATS};
  for(const key of Object.keys(result) as Array<keyof CombatStats>){
    let value=Number.isFinite(base[key]) ? base[key]! : 1;
    for(const p of powers)if(Number.isFinite(p.modifiers[key]))value*=p.modifiers[key]!;
    result[key]=clamp(value,key==='size'?.65:.25,key==='size'?1.8:3);
  }
  return result;
}
export function scaledBox<T extends Hurtbox>(box:T,size:number):T {return {...box,x:box.x*size,y:box.y*size,width:box.width*size,height:box.height*size};}
export function damageValue(base:number,attacker:CombatStats,defender:CombatStats,projectile=false,hits=0):number {
  const attack=projectile?attacker.projectileAttack:attacker.attack;
  const defense=projectile?defender.projectileDefense:defender.defense;
  return Math.max(base>0?1:0,Math.round(base*attack/defense*Math.max(.3,1-hits*.12)));
}
export function knockbackScale(attacker:CombatStats,defender:CombatStats,hits=0):number {return clamp(attacker.knockback/defender.weight*(1+Math.min(hits,8)*.06),.25,3);}

/** Combo ownership is on the victim; dropping hitstun ends a true combo. */
export class ComboCounter {
  owner:string|null=null; hits=0; damage=0; juggle=0; displayTicks=0;
  active=false;
  reset(){this.owner=null;this.hits=0;this.damage=0;this.juggle=0;this.active=false;this.displayTicks=0;}
  tick(locked:boolean){if(!locked)this.active=false;this.displayTicks=Math.max(0,this.displayTicks-1);}
  priorHits(owner:string){return this.active&&this.owner===owner?this.hits:0;}
  register(owner:string,damage:number,airborne:boolean){
    if(!this.active||this.owner!==owner){this.hits=0;this.damage=0;this.juggle=0;}
    this.owner=owner;this.active=true;this.hits++;this.damage+=damage;this.juggle+=Number(airborne);this.displayTicks=100;
  }
}
