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
  for(const move of draft.moves??[]) {
    if(move.cancelOn!==undefined&&!['hit','contact','always'].includes(move.cancelOn)) throw new Error('Invalid cancel condition');
    for(const phase of move.phases??[])for(const {event} of phase.events??[]) {
      const grab=event?.grab??event?.projectile?.grab;
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
    for(const move of c.moves) if(!c.sprite.frames?.[move.animation]?.length) throw new Error(`Form ${form.id} is missing animation ${move.animation}`);
  }
}
