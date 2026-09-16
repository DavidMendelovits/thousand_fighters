import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {effectiveStats,damageValue,knockbackScale,ComboCounter,scaledBox} from '../src/core/combatRules';
import {projectileImpact} from '../shared/projectileImpact.js';
import {InputBuffer} from '../src/core/InputBuffer';
import {selectTriggeredMove} from '../src/core/moveSelection';
import {validateCombatRules} from '../cms/export/validateCombatRules.js';
import {HitResolver} from '../src/core/HitResolver';
import {convertDraftToCharacterConfig} from '../cms/export/convertDraftToCharacterConfig.js';
const roster=JSON.parse(readFileSync('public/oddities-roster.json','utf8'));
test('CMS export preserves form events, hit-confirm costs and projectile companion behavior',()=>{
  const base=roster.find(f=>f.id==='brine');
  const move={...base.moves.find(m=>m.id==='ink_bell'),cancelOn:'hit',cost:{meter:7}};
  move.phases=structuredClone(move.phases);move.phases[0].events.push({onFrame:2,event:{type:'transform',formId:'brine_abyssal'}});
  const draft={id:'brine',forms:base.forms,moves:[move]};
  const config=convertDraftToCharacterConfig({draft,frameData:null,manifest:null});
  assert.equal(config.moves[0].cancelOn,'hit');assert.equal(config.moves[0].cost.meter,7);
  assert.equal(config.moves[0].phases[0].events[1].event.formId,'brine_abyssal');
  const p=config.moves[0].phases[1].events[0].event.projectile;
  assert.equal(p.hitbox.stun,8);assert.equal(p.impact.kind,'ink');assert.equal(p.animation,'odd_ink_bell');
});
test('CMS rejects malformed or selectable forms and invalid power stats',()=>{
  const base=roster.find(f=>f.id==='brine');assert.doesNotThrow(()=>validateCombatRules(base));
  const broken=structuredClone(base);broken.forms[0].config.selectable=true;assert.throws(()=>validateCombatRules(broken));
  assert.throws(()=>validateCombatRules({combatStats:{attack:-2}}));
  assert.throws(()=>validateCombatRules({forms:[{id:'x',cost:5,durationTicks:0}]}));
});
test('a previous projectile grants meter but never confirms an unrelated current move',()=>{
  const a:any={id:'a',moveSerial:2,hasHitThisMove:new Set(),scene:{hitPauseFrames:0},stats:effectiveStats(),meter:0};
  const d:any={id:'d',x:200,y:390,facing:-1,state:'idle',grounded:true,health:1000,stats:effectiveStats(),combo:new ComboCounter(),inputBuffer:{current:()=>({})},getGuardboxWorld:()=>null,changeState(s){this.state=s;}};
  HitResolver.resolve(a,d,{x:0,y:0,width:30,height:30,damage:50,hitstun:10,blockstun:5,knockback:{x:5,y:0}},'old',{x:180,y:310,facing:1,projectile:true,ownerMoveSerial:1,stats:effectiveStats({projectileAttack:2})});
  assert.equal(d.health,900);assert.equal(d.combo.hits,1);assert.ok(a.meter>0);assert.notEqual(a.hitThisMove,true);
});
test('independent melee/projectile channels, bounded modifiers, size and weight',()=>{
  const attacker=effectiveStats({attack:2,projectileAttack:1.5});const defender=effectiveStats({defense:2,projectileDefense:.75,weight:2});
  assert.equal(damageValue(100,attacker,defender),100);assert.equal(damageValue(100,attacker,defender,true),200);
  assert.equal(knockbackScale(attacker,defender),.5);assert.equal(damageValue(100,attacker,defender,false,20),30);
  assert.equal(effectiveStats({size:99,speed:Infinity}).size,1.8);assert.equal(effectiveStats({speed:Infinity}).speed,1);
  assert.deepEqual(scaledBox({x:-10,y:-20,width:20,height:40},1.5),{x:-15,y:-30,width:30,height:60});
});
test('true combo resets when victim is actionable; stale display is not damage scaling',()=>{
  const c=new ComboCounter();c.register('p1',30,false);c.register('p1',20,true);assert.equal(c.hits,2);assert.equal(c.damage,50);assert.equal(c.juggle,1);
  c.tick(false);assert.equal(c.priorHits('p1'),0);c.register('p1',40,false);assert.equal(c.hits,1);assert.equal(c.damage,40);
  c.register('p2',10,false);assert.equal(c.hits,1);
});
test('each roster kit has legal, distinct combo branches and impact companions',()=>{
  const branches=new Set();for(const f of roster){assert.equal(f.comboRoutes.length,3);branches.add(f.comboRoutes[0].moves.join(','));
    for(const r of f.comboRoutes)for(let i=0;i<r.moves.length-1;i++){const move=f.moves.find(m=>m.id===r.moves[i]);assert.ok(move.cancelInto.includes(r.moves[i+1]));assert.equal(move.cancelOn,'hit');}
    for(const m of f.moves)for(const p of m.phases)for(const {event:e} of p.events)if(e.projectile){assert.ok(e.projectile.impact.id);assert.ok(e.projectile.impact.durationTicks>0);}
  }assert.ok(branches.size>=9);
});
test('form packs are independent, hidden, owned, and every animation resolves to their own folder',()=>{
  let n=0;for(const base of roster)for(const form of base.forms??[]){n++;const f=form.config;assert.equal(f.parentId,base.id);assert.equal(f.selectable,false);assert.notEqual(f.id,base.id);assert.ok(f.moves.some(m=>m.id==='form_breaker'));
    for(const move of f.moves)assert.ok(f.sprite.frames[move.animation],`${f.id}/${move.id}`);
    for(const frames of Object.values(f.sprite.frames) as any[][])for(const frame of frames)assert.ok(existsSync(`public${f.sprite.basePath}/${frame.file}`));
    assert.ok(!roster.some(r=>r.id===f.id));
  }assert.equal(n,2);
});
test('impact behavior follows projectile identity, including grabs and stun',()=>{
  assert.equal(projectileImpact({id:'ink_bell'}).kind,'ink');assert.equal(projectileImpact({id:'needle'}).kind,'thread');assert.equal(projectileImpact({id:'pressure_wave'}).kind,'pressure');assert.equal(projectileImpact({id:'x'},'electric stun').kind,'electric');
});
test('a consumed input cannot replay; hit-confirm routes reject whiff and block',()=>{
  const buffer=new InputBuffer();const raw:any={left:false,right:false,up:false,down:false,lp:false,mp:false,hp:false,lk:true,mk:false,hk:false,lpPrev:false,mpPrev:false,hpPrev:false,lkPrev:false,mkPrev:false,hkPrev:false};buffer.record(raw,1);
  const brine=roster.find(f=>f.id==='brine'),punch=brine.moves.find(m=>m.id==='punch');const ctx:any={state:'attack',grounded:true,currentMove:punch,hitThisMove:false,contactThisMove:true};
  assert.equal(selectTriggeredMove(brine.moves,buffer,ctx,true),null);ctx.hitThisMove=true;assert.equal(selectTriggeredMove(brine.moves,buffer,ctx,true)?.id,'kick');buffer.consumeButtons();assert.equal(selectTriggeredMove(brine.moves,buffer,ctx,true),null);
});
