import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createOdditiesRoster } from '../src/characters/oddities';
import { HitResolver } from '../src/core/HitResolver';
import { interpolateHitboxGeometry } from '../src/core/hitboxGeometry';
import { MoveExecutor } from '../src/core/MoveExecutor';

const roster = createOdditiesRoster();
test('ten original, mechanically differentiated kits each have strike/kick/throw',()=>{
  assert.equal(roster.length,10);assert.equal(new Set(roster.map(f=>f.id)).size,10);
  for(const f of roster){for(const id of ['punch','kick','clinch'])assert.ok(f.moves.some(m=>m.id===id));
    for(const m of f.moves){assert.ok(m.phases.every(p=>p.frames>0));assert.equal(m.phases.reduce((s,p)=>s+p.frames,0),m.visualTimeline!.reduce((s,p)=>s+p.duration,0));}}
  const events=roster.find(f=>f.id==='meridian')!.moves.flatMap(m=>m.phases.flatMap(p=>p.events.map(e=>e.event.type)));
  for(const t of ['spawn_projectile_at_target','spawn_projectile_from_sky','spawn_projectile_behind_target'])assert.ok(events.includes(t as any));
});
test('all packaged sprite references exist and video-derived signatures have matching durations',()=>{
  const packed=JSON.parse(readFileSync(new URL('../public/oddities-roster.json',import.meta.url),'utf8'));
  let videoCount=0;
  for(const f of packed){for(const frames of Object.values(f.sprite.frames) as any[][])for(const frame of frames)assert.ok(existsSync(new URL(`../public/fighters/${f.id}/${frame.file}`,import.meta.url)),frame.file);
    for(const m of f.moves){assert.ok(f.sprite.frames[m.animation]);if(m.animation==='video_signature'){videoCount++;assert.equal(m.phases.reduce((s:number,p:any)=>s+p.frames,0),m.visualTimeline.reduce((s:number,p:any)=>s+p.duration,0));}}
  }assert.equal(videoCount,13);
});
const raw=(patch={})=>({left:false,right:false,down:false,...patch});
function fake(id:string,x:number,facing:1|-1=1):any{return {id,x,y:390,facing,state:'idle',grounded:true,health:1000,grabImmunity:0,hasHitThisMove:new Set(),scene:{hitPauseFrames:0},inputBuffer:{current:()=>raw()},getGuardboxWorld:()=>null,changeState(state:string){this.state=state;}};}
const hb={x:0,y:-80,width:30,height:30,damage:50,hitstun:20,blockstun:10,knockback:{x:7,y:0}};
test('projectile contact direction controls rear guard and knockback, not owner facing',()=>{
  const a=fake('a',100,1),d=fake('d',300,-1);d.inputBuffer.current=()=>raw({left:true});
  const source={x:350,y:320,facing:-1 as const};
  assert.equal(HitResolver.isBlocking(d,source,hb),true);
  HitResolver.resolve(a,d,hb,'rear',source);assert.equal(d.state,'blockstun');assert.equal(d.health,1000);assert.equal(d.vx,-2);
  d.inputBuffer.current=()=>raw();d.state='idle';HitResolver.resolve(a,d,hb,'rear2',source);assert.equal(d.vx,-7);assert.equal(d.health,950);
});
test('stun is a distinct input-lock state and armor deaths resolve',()=>{
  const a=fake('a',100),d=fake('d',300,-1);HitResolver.resolve(a,d,{...hb,stun:48},'stun');assert.equal(d.state,'stunned');assert.equal(d.hitstun,48);assert.equal(d.vx,0);
  const armored=fake('armor',300);armored.health=10;armored.armor={hits:1};HitResolver.resolve(a,armored,hb,'armor');assert.equal(armored.state,'dead');
});
test('capture anchors and safety exclusions are explicit',()=>{
  const a=fake('a',100),d=fake('d',300);a.state='attack';
  const spec={hitbox:{x:0,y:-100,width:50,height:100},holdOffsetX:44,holdDuration:30,anchor:'contact' as const};
  assert.equal(HitResolver.resolveGrab(a,d,spec,'cage',true),true);assert.equal(d.state,'grabbed');assert.equal(d.grabHold.requiresAttack,false);assert.equal(d.grabHold.anchor.x,300);assert.equal(d.grabHold.offsetX,0);
  for(const reason of ['immune','air','dead','invulnerable']){const victim=fake(reason,300);if(reason==='immune')victim.grabImmunity=20;if(reason==='air')victim.grounded=false;if(reason==='dead')victim.state='dead';if(reason==='invulnerable')victim.invulnerable={duration:5};assert.equal(HitResolver.resolveGrab(a,victim,{...spec,groundOnly:true},reason),false);}
});
test('extension collision is at the travelling tip and is mirrored at spawn',()=>{
  const m=roster.find(f=>f.id==='brine')!.moves[0];const event=m.phases[1].events[0].event as any;
  const start=interpolateHitboxGeometry({hitbox:event.grab.hitbox,keyframes:event.keyframes,age:0});
  const extended=interpolateHitboxGeometry({hitbox:event.grab.hitbox,keyframes:event.keyframes,age:14});
  assert.equal(start.x,30);assert.equal(extended.x,240);assert.equal(extended.width,28);
  const calls:any[]=[];const owner:any={x:500,y:390,facing:-1,scene:{fighters:[],projectiles:{spawnAt:(...v:any[])=>calls.push(v)}}};const target={x:250,y:390};owner.scene.fighters=[owner,target];
  MoveExecutor.handleEvent(owner,{type:'spawn_projectile_behind_target',projectile:{} as any,distance:100,offsetY:-72});assert.equal(calls[0][2],150);assert.equal(calls[0][4],1);
});
