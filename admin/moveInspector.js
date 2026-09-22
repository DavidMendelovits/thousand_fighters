// Pure authoring model, shared by the real form and its regression tests.
import {retimeMotion} from './motionTiming.js';
export const REACTION_FIELDS = ['damage','hitstun','blockstun','stun','hitstop'];
export const GEOMETRY_FIELDS = ['x','y','width','height'];
export const GRIP_FIELDS = ['socketX','socketY','lift','swing','holdStartFrame','holdEndFrame','layerSplitY'];
function patchGeometry(box,patch){
  for(const key of GEOMETRY_FIELDS){const v=patch[key];if(v===undefined)continue;
    if(!Number.isFinite(v)||Math.abs(v)>600||(['width','height'].includes(key)&&v<=0))throw new Error('Collision coordinates must be within ±600; dimensions must be positive.');box[key]=v;
  }
}
export function moveGrabs(move,projectiles=[]) {
  return (move.phases??[]).flatMap(p=>(p.events??[]).flatMap(({event:e})=>{const grab=e?.grab??e?.projectile?.grab??projectiles.find(p=>p.id===e?.projectileId)?.grab;return grab?[grab]:[];}));
}
export function moveContacts(move, projectiles=[]) {
  return (move.phases??[]).flatMap((phase,phaseIndex)=>(phase.events??[]).flatMap((entry,eventIndex)=>{
    const e=entry.event??{};
    const entity=projectiles.find(p=>p.id===e.projectileId);
    const hitbox=e.hitbox??e.projectile?.hitbox??entity?.hitbox;
    return hitbox?[{phaseIndex,eventIndex,hitbox,projectile:Boolean(e.projectile||entity),entityId:entity?.id}]:[];
  }));
}
export function frameAdvantage(move,projectiles=[]) {
  const contact=moveContacts(move,projectiles)[0];
  if(!contact)return null;
  const start=move.phases.slice(0,contact.phaseIndex).reduce((n,p)=>n+p.frames,0);
  const entry=move.phases[contact.phaseIndex].events[contact.eventIndex];
  const tick=start+(entry.onFrame??entry.frame??0);
  const remaining=move.phases.reduce((n,p)=>n+p.frames,0)-tick-1;
  return {hit:(contact.hitbox.stun??contact.hitbox.hitstun??0)-remaining,block:(contact.hitbox.blockstun??0)-remaining,projectile:contact.projectile,remaining};
}
export function patchMove(draft,moveId,patch) {
  const result=structuredClone(draft),move=result.moves.find(m=>m.id===moveId);
  if(!move)throw new Error('Move no longer exists. Reload the fighter.');
  const oldTotal=move.phases.reduce((n,p)=>n+p.frames,0);
  const oldPhases=move.phases.map(p=>p.frames);
  if(patch.phases)move.phases.forEach((phase,i)=>{
    const ticks=patch.phases[i];
    if(!Number.isInteger(ticks)||ticks<1||ticks>600)throw new Error('Phase durations must be 1–600 whole ticks.');
    if(phase.events.some(e=>(e.onFrame??e.frame??0)>=ticks))throw new Error(`${phase.name}: duration would cut off a scheduled event. Move the event in advanced definitions first.`);
    phase.frames=ticks;
  });
  const total=move.phases.reduce((n,p)=>n+p.frames,0);
  if(move.visualTimeline?.length&&total!==oldTotal){
    if(total<move.visualTimeline.length)throw new Error('Duration is too short for the visual timeline.');
    // Map pose boundaries through the edited phases. A contact pose already
    // aligned to active frames stays aligned; global scaling shifts contacts.
    const weights=move.visualTimeline.map(f=>f.duration),sum=weights.reduce((n,v)=>n+v,0);
    if(weights.some(v=>!Number.isFinite(v)||v<=0))throw new Error('Visual timeline durations must be positive.');
    const remap=t=>{let before=0,after=0;for(let i=0;i<oldPhases.length;i++){if(t<=before+oldPhases[i])return after+(t-before)/oldPhases[i]*move.phases[i].frames;before+=oldPhases[i];after+=move.phases[i].frames;}return total;};
    let cursor=0,previous=0;
    move.visualTimeline.forEach((f,i)=>{cursor+=weights[i];const remaining=weights.length-i-1;const boundary=i===weights.length-1?total:Math.max(previous+1,Math.min(total-remaining,Math.round(remap(cursor/sum*oldTotal))));f.duration=boundary-previous;previous=boundary;});
  }
  if(patch.contact){
    const contact=moveContacts(move,result.projectiles)[patch.contact.index];
    if(!contact)throw new Error('Select a damage contact first.');
    const hb=contact.hitbox;
    patchGeometry(hb,patch.contact);
    if(!contact.projectile && (GEOMETRY_FIELDS.some(k=>patch.contact[k]!==undefined)||patch.contact.keyframes!==undefined))move.phases[contact.phaseIndex].events[contact.eventIndex].event.geometrySource='authored';
    if(patch.contact.keyframes!==undefined){
      const track=patch.contact.keyframes;
      if(contact.projectile)throw new Error('Motion tracks are for melee contacts.');
      if(!Array.isArray(track))throw new Error('Motion track must be a JSON array.');
      let previous=-1;
      for(const k of track){if(!Number.isInteger(k.atFrame)||k.atFrame<=previous||k.atFrame>=move.phases[contact.phaseIndex].frames)throw new Error('Track ticks must increase and fit within the active phase.');patchGeometry({},k);previous=k.atFrame;}
      move.phases[contact.phaseIndex].events[contact.eventIndex].event.keyframes=track;
    }
    for(const key of REACTION_FIELDS){const v=patch.contact[key];if(v===null){if(['damage','hitstun'].includes(key))throw new Error(`${key} is required.`);delete hb[key];continue;}if(v===undefined)continue;
      if(!Number.isInteger(v)||v<0||(key!=='damage'&&v>180))throw new Error(`${key}: use non-negative whole numbers (timers at most 180 ticks).`);hb[key]=v;
    }
    for(const axis of ['x','y']){const v=patch.contact[`knockback${axis.toUpperCase()}`];if(v===undefined)continue;if(!Number.isFinite(v)||Math.abs(v)>40)throw new Error('Knockback must be between -40 and 40.');
      if(hb.knockback)hb.knockback[axis]=v;else hb[`knockback${axis.toUpperCase()}`]=v;
    }
  }
  if(patch.grab){
    const g=moveGrabs(move,result.projectiles)[patch.grab.index];if(!g)throw new Error('Grab no longer exists.');
    if(patch.grab.actorGrip){
      if(!g.actorGrip)throw new Error('This grab does not control a summon.');
      for(const key of GRIP_FIELDS){const v=patch.grab.actorGrip[key];if(v===undefined)continue;
        if(v===null){delete g.actorGrip[key];continue;}
        if(!Number.isFinite(v)||Math.abs(v)>200)throw new Error('Grip coordinates must be within ±200.');
        if(key.includes('Frame')&&(!Number.isInteger(v)||v<0||v>=(draft.sprite?.frames?.[move.animation]?.length??draft.sprite?.frameCounts?.[move.animation]??1)))throw new Error('Grip frame must exist in the animation.');
        g.actorGrip[key]=v;
      }
      if((g.actorGrip.holdEndFrame??Infinity)<(g.actorGrip.holdStartFrame??0))throw new Error('Grip end frame must follow its start frame.');
    }
    for(const k of ['damage','holdDuration','pullFrames','releaseHitstun']){const v=patch.grab[k];if(v===undefined)continue;if(!Number.isInteger(v)||v<0||(k!=='damage'&&v>180)||(k==='holdDuration'&&v===0))throw new Error('Grab timers must be whole ticks from 0 to 180; hold must be at least 1.');g[k]=v;}
    if((g.pullFrames??0)>g.holdDuration)throw new Error('Pull time cannot exceed grab hold time.');
  }
  if(patch.motion){
    const count=draft.sprite?.frames?.[move.animation]?.length??draft.sprite?.frameCounts?.[move.animation]??0;
    const {contactFrame,recoveryFrame}=patch.motion;
    if(!Number.isInteger(contactFrame)||!Number.isInteger(recoveryFrame)||contactFrame<1||contactFrame>=count-1||recoveryFrame<=contactFrame||recoveryFrame>=count)throw new Error('Contact must follow the first pose; recovery must follow contact and both must exist in this row.');
    if(move.phases.length!==3||move.phases.some((p,i)=>p.name!==['startup','active','recovery'][i]))throw new Error('Pose retiming requires startup, active and recovery phases.');
    move.visualTimeline=retimeMotion(move,count,contactFrame,recoveryFrame);
    if(result.motionRows?.[move.animation])Object.assign(result.motionRows[move.animation],{contactFrame,recoveryFrame,status:'needs-visual-review'});
  }
  if(patch.meter!==undefined){if(!Number.isFinite(patch.meter)||patch.meter<0||patch.meter>100)throw new Error('Meter cost must be 0–100.');move.cost={...move.cost,meter:patch.meter};}
  if(patch.extension!==undefined){
    if(patch.extension===null)delete move.extension;
    else{
      const {kind,color,accent,thickness}=patch.extension;
      if(!['tentacle','elastic','ribbon','root','mic-cable','paint-ribbon'].includes(kind))throw new Error('Choose a supported extension material.');
      if(![color,accent].every(v=>Number.isInteger(v)&&v>=0&&v<=0xffffff))throw new Error('Extension colors must be RGB hex values.');
      if(!Number.isFinite(thickness)||thickness<1||thickness>48)throw new Error('Extension thickness must be 1–48 pixels.');
      move.extension={kind,color,accent,thickness};
    }
  }
  if(patch.cancelInto){if(patch.cancelInto.some(id=>id===move.id||!result.moves.some(m=>m.id===id)))throw new Error('Cancel targets must be other existing moves.');if(!['hit','contact','always'].includes(patch.cancelOn??'hit'))throw new Error('Invalid cancel condition.');move.cancelInto=patch.cancelInto;move.cancelOn=patch.cancelOn??'hit';move.phases.forEach(p=>{if(p.name!=='startup')p.cancellable=Boolean(patch.cancelInto.length);});}
  if(patch.effect!==undefined){
    for(const p of move.phases)p.events=p.events.filter(e=>!(e.event.type==='spawn_effect'&&e.event.effect.id===`${moveId}_authored_fx`));
    if(patch.effect){
      const e=patch.effect;
      if(!['spark','ink','thread','electric','shards','spores','pressure','bind'].includes(e.kind)||!Number.isInteger(e.durationTicks)||e.durationTicks<1||e.durationTicks>180||!Number.isFinite(e.radius)||e.radius<1||e.radius>250||![e.x,e.y].every(v=>Number.isFinite(v)&&Math.abs(v)<=500))throw new Error('Effect requires a valid kind, 1–180 ticks, 1–250 radius and socket within ±500.');
      if(![e.color,e.accent].every(v=>Number.isInteger(v)&&v>=0&&v<=0xffffff))throw new Error('Effect colors must be RGB hex values.');
      const phase=move.phases.find(p=>p.name==='active')??move.phases[0];
      phase.events.push({onFrame:0,event:{type:'spawn_effect',effect:{id:`${moveId}_authored_fx`,kind:e.kind,color:e.color,accent:e.accent,durationTicks:e.durationTicks,radius:e.radius},offsetX:e.x,offsetY:e.y,attached:Boolean(e.attached)}});
    }
  }
  return result;
}
