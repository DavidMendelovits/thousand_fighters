import type {CharacterConfig,CombatStats,Move} from '../schema/types';
import {projectileImpact} from '../../shared/projectileImpact.js';

const profiles:Record<string,Partial<CombatStats>>={
  brine:{projectileAttack:.9,speed:1},meridian:{attack:.85,projectileAttack:1.1},
  taffy:{attack:1.05,defense:.9,speed:1.15,weight:.85},vesper:{projectileAttack:1.12,projectileDefense:1.15,weight:.85},
  vellum:{projectileAttack:1.08,defense:.95,speed:1.05},kiln:{attack:1.2,defense:1.2,speed:.85,weight:1.35,knockback:1.2},
  mycel:{projectileDefense:1.1,projectileAttack:1.05},rook:{attack:1.08,projectileDefense:1.15,speed:1.05},
  veil:{speed:1.2,defense:.85,weight:.8},bellwether:{defense:1.15,weight:1.3,knockback:1.25,speed:.9}
};
const branches:Record<string,[string,string,string]>={
  brine:['ink_bell','tidal_reach','Dockside Drag'],meridian:['thread_needle','sky_needle','Unpick the Sky'],taffy:['sugar_straight','candy_wrap','Pull & Pop'],vesper:['vesper_sting','vesper_cage','Closed Circuit'],vellum:['errata','binding_clause','Footnote to Oblivion'],kiln:['kiln_slam','furnace_spit','Kiln Pressure'],mycel:['root_baton','root_ovation','Underground Encore'],rook:['scrap_fan','magnet_mouth','Scrap Collection'],veil:['hem_slash','sleeve_snare','Last Dance'],bellwether:['pressure_front','dead_toll','Deep End']
};
export function upgradeOddity(config:CharacterConfig):void {
  config.stats=profiles[config.id]??{};
  config.powerUps=[{id:`${config.id}_surge`,name:config.id==='kiln'?'Overfire':'Second Wind',cost:25,durationTicks:360,color:0xf2c76d,modifiers:{attack:1.15,defense:1.1,projectileAttack:1.15,projectileDefense:1.1,speed:1.12,knockback:1.1}}];
  const launcher:Move={id:'rising_break',displayName:'Rising Break',description:'Hit-confirmed launcher; opens an air route at the cost of long recovery.',animation:'kick',inputLabel:'↓ + G · Launcher',trigger:{allowedStates:['idle','walk_forward','block','crouch','landing'],sequence:['down','lk'],window:7},visualTimeline:[{frame:0,duration:9},{frame:1,duration:5},{frame:2,duration:28}],phases:[{name:'startup',frames:9,events:[{onFrame:0,event:{type:'set_velocity',vx:2,relativeToFacing:true}}]},{name:'active',frames:5,events:[{onFrame:0,event:{type:'hitbox_active',hitbox:{x:20,y:-125,width:100,height:80,damage:62,hitstun:32,blockstun:12,knockback:{x:2,y:-8},launches:true}}}]},{name:'recovery',frames:28,events:[{onFrame:0,event:{type:'hitbox_end'}},{onFrame:0,event:{type:'set_velocity',vx:0}}]}]};
  config.moves.unshift(launcher);
  // A confirmed sweep leaves enough stun and proximity for a ranged ender.
  // Heavy displacement belongs to the ender, not the linking normal.
  for(const p of config.moves.find(m=>m.id==='kick')!.phases)for(const {event} of p.events)if(event.type==='hitbox_active'){
    event.hitbox.hitstun=32;event.hitbox.knockback.x=1;
  }
  const [ender,alternate,name]=branches[config.id];
  config.comboRoutes=[{name,purpose:'Hit-confirm route; end in the character-specific ranged or heavy special.',moves:['punch','kick',ender]},{name:`${name} / lift`,purpose:'Launcher branch. Spacing and airborne height determine the follow-up.',moves:['punch','rising_break',alternate]},{name:'Low opener',purpose:'Alternate grounded permutation with a distinct starter.',moves:['kick',ender]}];
  for(const route of config.comboRoutes)for(let i=0;i<route.moves.length-1;i++){
    const from=config.moves.find(m=>m.id===route.moves[i])!;
    from.cancelInto=[...new Set([...(from.cancelInto??[]),route.moves[i+1]])];from.cancelOn='hit';
    for(const phase of from.phases)if(phase.name!=='startup')phase.cancellable=true;
  }
  for(const move of config.moves)for(const phase of move.phases)for(const {event} of phase.events)if('projectile' in event)event.projectile.impact=projectileImpact(event.projectile);
}

/** Full independent form config. No move-time sprite overrides or parent fallbacks. */
export function createOddityForm(base:CharacterConfig,formId:string,sprite:CharacterConfig['sprite']):CharacterConfig {
  const form=structuredClone(base);delete form.forms;
  form.id=formId;form.parentId=base.id;form.selectable=false;form.sprite=sprite;
  form.displayName=base.id==='brine'?'Brine / Abyssal Admiral':'Taffy / Sugarstorm';
  form.stats={...base.stats,attack:1.25,projectileAttack:1.2,size:base.id==='brine'?1.3:1.12,weight:base.id==='brine'?1.4:1,defense:1.15,speed:base.id==='brine'?.92:1.25};
  form.moves=form.moves.filter(m=>m.id!=='clinch');
  for(const move of form.moves){
    if(move.animation==='video_signature'){move.animation=base.id==='brine'?'grab':'punch';move.visualTimeline=move.phases.map((p,i)=>({frame:i,duration:p.frames}));}
    if(move.id==='tidal_reach'){move.displayName='Abyssal Dredge';move.extension={kind:'tentacle',color:0x274868,accent:0x96f5ef,thickness:15};}
    if(move.id==='sugar_straight'){move.displayName='Caramel Catapult';move.extension={kind:'elastic',color:0xda932b,accent:0xffe789,thickness:16};}
  }
  const pulse=structuredClone(base.moves.find(m=>m.phases.some(p=>p.events.some(e=>'projectile' in e.event)))??base.moves.find(m=>m.id==='rising_break')!);
  pulse.id='form_breaker';pulse.displayName=base.id==='brine'?'Undertow Crown':'Sugar Glass Break';pulse.inputLabel='F + G · Form breaker';pulse.trigger.sequence=['grab'];pulse.animation='special_1';pulse.cancelInto=[];
  pulse.visualTimeline=pulse.phases.map((p,i)=>({frame:Math.min(i,2),duration:p.frames}));
  for(const p of pulse.phases)for(const {event} of p.events){
    if('projectile' in event){event.projectile.id=`${formId}_burst`;event.projectile.animation=`${formId}_burst`;event.projectile.visual={kind:'wave',color:0x79e7e5,accent:0xffe6aa};event.projectile.hitbox={...event.projectile.hitbox,stun:undefined,damage:85,knockback:{x:10,y:-5},launches:true};delete event.projectile.grab;event.projectile.impact=projectileImpact(event.projectile);}
    if(event.type==='hitbox_active'){event.hitbox={...event.hitbox,damage:90,knockback:{x:10,y:-5}};}
  }
  form.moves.unshift(pulse);
  return form;
}
