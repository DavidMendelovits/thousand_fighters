// Strict structured-output objects: every declared property is required;
// optional authoring fields use null and are removed before runtime conversion.
const object = properties => ({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const number = {type:'number'};
const integer = {type:'integer'};
const string = {type:'string'};
const nullable = value => ({anyOf:[value,{type:'null'}]});
const box = () => object({x:number,y:number,width:number,height:number});
const vector = () => object({x:number,y:number});
const variant = (type, properties={}) => object({type:{type:'string',enum:[type]},...properties});

export function advancedMoveEvents() {
  return [
    variant('summon_control',{actor:string,duration:integer,speed:number,offsetX:number,offsetY:number}),
    variant('recall_summon'),
    variant('grab_end',{id:nullable(string)}),
    variant('grab_check',{
      actor:nullable(string),id:nullable(string),
      grab:object({
        hitbox:box(),damage:number,holdOffsetX:number,holdOffsetY:number,
        holdDuration:integer,pullFrames:integer,releaseKnockback:vector(),
        releaseHitstun:integer,releaseLaunches:{type:'boolean'},releaseKnockdown:{type:'boolean'},
        groundOnly:{type:'boolean'},anchor:{type:'string',enum:['attacker','contact']},
        actorGrip:nullable(object({actor:string,socketX:number,socketY:number,lift:number,swing:number})),
      }),
    }),
    variant('spawn_projectile_at_target',{projectileId:string,offsetX:number,offsetY:number}),
    variant('spawn_projectile_from_sky',{projectileId:string,targetOffsetX:number,spawnOffsetY:number}),
    variant('spawn_projectile_behind_target',{projectileId:string,distance:number,offsetY:number}),
  ];
}

export function summonActorSchema() {
  // These are asset bindings, not invented image paths. Export resolves actual
  // frames from the reviewed pack; the body/lead actor is derived separately.
  return object({id:string,summon:{type:'boolean',enum:[true]},idleAnimation:string,description:string});
}

export function commandDirectionsSchema() {
  return nullable({type:'array',minItems:1,items:{type:'string',enum:[
    'neutral','forward','back','up','down','up-forward','up-back','down-forward','down-back',
  ]}});
}

/** Only strip optional structured-output nulls from moves/actors, never forms
 * or power-ups, where null duration intentionally means until knockout. */
export function normalizeGeneratedMoves(value) {
  if(Array.isArray(value))return value.map(normalizeGeneratedMoves);
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value)
    .filter(([,v])=>v!==null).map(([k,v])=>[k,normalizeGeneratedMoves(v)]));
  return value;
}
