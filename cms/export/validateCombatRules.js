const stats = new Set(['attack','defense','projectileAttack','projectileDefense','speed','weight','knockback','size']);
function modifiers(values = {}) {
  if(!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Combat stats must be an object');
  for(const [key,value] of Object.entries(values)) if(!stats.has(key)||!Number.isFinite(value)||value<=0) throw new Error(`Invalid combat stat: ${key}`);
}
function lifetime(rule) {
  if(rule.durationTicks!==null && (!Number.isInteger(rule.durationTicks)||rule.durationTicks<1)) throw new Error('durationTicks must be a positive integer or null (until KO)');
  if(!Number.isFinite(rule.cost)||rule.cost<0||rule.cost>100) throw new Error('Meter cost must be between 0 and 100');
}
/** Reject invalid hidden forms before a CMS save/export can strand the runtime. */
export function validateCombatRules(draft, parentId=draft.id) {
  const actors=new Map();
  const ownedRows=new Map();
  for(const actor of draft.actors??[]){
    if(!actor?.id||actors.has(actor.id))throw new Error('Actors require unique ids');
    actors.set(actor.id,actor);
    if(actor.idleAnimation!==undefined){
      if(!actor.summon||actor.id==='lead'||!/^[a-z][a-z0-9_]*$/.test(actor.id)||!/^[a-z][a-z0-9_]*$/.test(actor.idleAnimation))throw new Error('Generated summons require a dedicated idle animation and a non-lead id');
      if((draft.moves??[]).some(m=>!m.controlledActor&&m.animation===actor.idleAnimation))throw new Error('Summon idle cannot share a body move animation');
      if(ownedRows.has(actor.idleAnimation))throw new Error('Summons require distinct idle animation rows');
      ownedRows.set(actor.idleAnimation,actor.id);
    }
  }
  // A pack row cannot simultaneously depict a body and an isolated summon.
  if(ownedRows.size)for(const move of draft.moves??[]){
    const owner=move.controlledActor??'lead';
    if(ownedRows.has(move.animation)&&ownedRows.get(move.animation)!==owner)throw new Error('Animation rows cannot be shared across body and summon actors');
    ownedRows.set(move.animation,owner);
  }
  for(const move of draft.moves??[]) {
    if(move.controlledActor && !draft.actors?.some(a=>a.id===move.controlledActor&&a.summon))throw new Error('Controlled moves require a configured summon actor');
    const trigger=move.trigger??{};
    if(trigger.directions!==undefined&&(!Array.isArray(trigger.directions)||!trigger.directions.length||trigger.directions.some(d=>!['neutral','forward','back','up','down','up-forward','up-back','down-forward','down-back'].includes(d))))throw new Error('Invalid command directions');
    if(trigger.activationFrames!==undefined&&(!Number.isInteger(trigger.activationFrames)||trigger.activationFrames<1||trigger.activationFrames>60))throw new Error('Invalid command activation window');
    if(trigger.cancelOnly!==undefined&&typeof trigger.cancelOnly!=='boolean')throw new Error('cancelOnly must be boolean');
    if(trigger.cancelOnly&&(!trigger.cancelFrom?.length||trigger.cancelFrom.some(id=>!draft.moves.some(m=>m.id===id))))throw new Error('String continuation requires valid predecessors');
    if(trigger.cancelOn!==undefined&&!['hit','contact','always'].includes(trigger.cancelOn))throw new Error('Invalid edge cancel condition');
    if(move.cancelOn!==undefined&&!['hit','contact','always'].includes(move.cancelOn)) throw new Error('Invalid cancel condition');
    for(const phase of move.phases??[])for(const {event} of phase.events??[]) {
      if(event?.actor && event.actor!=='lead' && !actors.has(event.actor))throw new Error('Move event requires a configured actor (unknown actor reference)');
      if(move.controlledActor&&['hitbox_active','grab_check'].includes(event?.type)&&event.actor!==move.controlledActor)throw new Error('Controlled move contact must target its summon actor');
      if(event?.type==='recall_summon'&&!move.controlledActor)throw new Error('Recall requires a controlled summon move');
      if(event?.type==='summon_control'){
        if(!draft.actors?.some(a=>a.id===event.actor&&a.summon))throw new Error('Summon requires a configured actor');
        if(!Number.isInteger(event.duration)||event.duration<1||event.duration>600||!Number.isFinite(event.speed)||event.speed<=0||event.speed>12||![event.offsetX,event.offsetY].every(n=>Number.isFinite(n)&&Math.abs(n)<=300))throw new Error('Invalid summon lifetime, speed or offset');
      }
      const grab=event?.grab??event?.projectile?.grab;
      if(grab?.actorGrip){
        const g=grab.actorGrip;
        if(event.actor!==g.actor || !draft.actors?.some(a=>a.id===g.actor&&a.summon) || !['socketX','socketY','lift','swing'].every(k=>Number.isFinite(g[k])&&Math.abs(g[k])<=200))throw new Error('Invalid summon grip socket or trajectory');
        if(g.layerSplitY!==undefined&&(!Number.isFinite(g.layerSplitY)||Math.abs(g.layerSplitY)>200))throw new Error('Invalid grip layer split');
        for(const key of ['holdStartFrame','holdEndFrame'])if(g[key]!==undefined&&(!Number.isInteger(g[key])||g[key]<0||g[key]>=(draft.sprite?.frameCounts?.[move.animation]??1)))throw new Error('Grip frame is outside the animation');
        if((g.holdEndFrame??Infinity)<(g.holdStartFrame??0))throw new Error('Grip frame range is reversed');
      }
      if(event?.type==='hitbox_active'){
        for(const box of [event.hitbox,...(event.keyframes??[])])if(box){
          for(const k of ['x','y','width','height'])if(box[k]!==undefined&&(!Number.isFinite(box[k])||Math.abs(box[k])>600||(['width','height'].includes(k)&&box[k]<=0)))throw new Error('Invalid contact geometry');
        }
        let prior=-1;
        for(const k of event.keyframes??[]){if(!Number.isInteger(k.atFrame)||k.atFrame<=prior||k.atFrame>=phase.frames)throw new Error('Contact track must increase within its phase');prior=k.atFrame;}
      }
      if(grab){for(const k of ['holdDuration','pullFrames','releaseHitstun']){const v=grab[k];if(v!==undefined&&(!Number.isInteger(v)||v<0||v>180||(k==='holdDuration'&&v===0)))throw new Error('Invalid grab timer (0–180 ticks; hold must be positive)');}if((grab.pullFrames??0)>(grab.holdDuration??0))throw new Error('Grab pull cannot exceed hold duration');}
      if(event?.type!=='spawn_effect')continue;
      const fx=event.effect;
      if(!fx?.id||!['spark','ink','watercolor','thread','electric','shards','spores','pressure','bind'].includes(fx.kind)) throw new Error('Independent effect requires an id and supported kind');
      if(!Number.isInteger(fx.durationTicks)||fx.durationTicks<1||fx.durationTicks>180||!Number.isFinite(fx.radius)||fx.radius<1||fx.radius>250) throw new Error('Effect lifetime must be 1–180 ticks and radius 1–250');
      if(![fx.color,fx.accent].every(v=>Number.isInteger(v)&&v>=0&&v<=0xffffff)||![event.offsetX,event.offsetY].every(v=>Number.isFinite(v)&&Math.abs(v)<=500)) throw new Error('Invalid effect colors or socket coordinates');
    }
  }
  for (const [key,min,max] of [['relativeHeight',.5,1.6],['scaleAdjust',.25,4]]) {
    const value=draft.sprite?.[key];
    if(value!==undefined && (!Number.isFinite(value)||value<min||value>max)) throw new Error(`sprite.${key} must be between ${min} and ${max}`);
  }
  // Moves own their reaction timings. Reject invalid locks at the authoring
  // boundary instead of letting NaN/negative timers strand a fighter.
  const hitboxes = (draft.moves??[]).flatMap(move => (move.phases??[]).flatMap(phase =>
    (phase.events??[]).flatMap(({event}) => [event?.hitbox,event?.projectile?.hitbox].filter(Boolean))));
  hitboxes.push(...(draft.projectiles??[]).map(p=>p.hitbox).filter(Boolean));
  for(const hitbox of hitboxes)for(const key of ['hitstun','blockstun','stun','hitstop']) {
    const value=hitbox[key];
    if(value!==undefined && (!Number.isInteger(value)||value<0||value>180)) throw new Error(`${key} must be 0–180 whole ticks (60 ticks = 1 second)`);
  }
  if(draft.combatStats!==undefined) modifiers(draft.combatStats);
  for(const power of draft.powerUps??[]) {lifetime(power);modifiers(power.modifiers);}
  const ids=new Set();
  for(const form of draft.forms??[]) {
    lifetime(form);
    const c=form.config;
    if(!form.id||ids.has(form.id)||!c||c.id!==form.id||c.parentId!==parentId||c.selectable!==false||c.forms?.length) throw new Error('Each form must be a unique non-selectable child of this character, without nested forms');
    ids.add(form.id);modifiers(c.stats);
    if(!c.sprite?.basePath||!Array.isArray(c.moves)||!c.moves.length) throw new Error('Forms require their own sprite pack and moves');
    for(const move of c.moves) {
      const sprite=move.controlledActor?c.actors?.find(actor=>actor.id===move.controlledActor&&actor.summon)?.sprite:c.sprite;
      if(!sprite?.frames?.[move.animation]?.length) throw new Error(`Form ${form.id} is missing animation ${move.animation}`);
    }
  }
}
