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
