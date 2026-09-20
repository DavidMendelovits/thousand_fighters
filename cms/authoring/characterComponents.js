import {randomUUID} from 'node:crypto';
import {validateCombatRules} from '../export/validateCombatRules.js';
import {convertDraftToCharacterConfig} from '../export/convertDraftToCharacterConfig.js';
import {assertMotionCoverage,requiredMotionRows} from '../pipeline/motionRowArtifacts.js';
import {digest} from '../storage/LineageStore.js';

const clone=value=>structuredClone(value);
const id=value=>{if(typeof value!=='string'||!/^[a-z][a-z0-9_]{1,63}$/.test(value))throw new Error('Use a lowercase id with letters, numbers and underscores (2–64 characters).');return value;};
const text=value=>{if(typeof value!=='string'||!value.trim())throw new Error('Name and description are required.');return value.trim();};
function uniqueCommand(draft,trigger,actorId,exceptId) {
  const collision=draft.moves?.find(m=>m.id!==exceptId&&(m.controlledActor??null)===(actorId??null)&&!m.trigger?.cancelOnly&&
    JSON.stringify(m.trigger?.sequence)===JSON.stringify(trigger.sequence)&&
    (m.trigger?.directions??['neutral']).some(d=>trigger.directions.includes(d)));
  if(collision)throw new Error(`This command is already used by ${collision.displayName??collision.id}. Choose another direction or button.`);
}
function command(button,direction='neutral') {
  if(!['lp','lk','hp','grab'].includes(button)||!['neutral','forward','back','down','up'].includes(direction))throw new Error('Unsupported button or direction.');
  return {sequence:[button],directions:[direction]};
}
function action(moveId,name,trigger,event,controlledActor) {
  return {id:moveId,displayName:name,animation:moveId,requiredAnimation:moveId,description:name,
    ...(controlledActor?{controlledActor}:{}),trigger,
    phases:[{name:'startup',frames:12,events:[]},{name:'active',frames:1,events:[{frame:0,event}]},{name:'recovery',frames:12,events:[]}]};
}

/** Edits metadata/mechanics only. Existing art, grips and unrelated moves survive. */
export async function defineSummon(repository,{characterId,actorId,description,durationTicks,speed,offsetX,offsetY,button='hp',direction='down'}) {
  id(actorId);if(actorId==='lead')throw new Error('lead is reserved for the fighter body.');
  const draft=clone(await repository.getDraft(characterId));
  const prior=(draft.actors??[]).find(a=>a.id===actorId);
  if(prior&&!prior.summon)throw new Error('This id belongs to a non-summon actor.');
  const event={type:'summon_control',actor:actorId,duration:durationTicks,speed,offsetX,offsetY};
  const existing=(draft.moves??[]).find(m=>m.phases?.some(p=>p.events?.some(e=>e.event?.type==='summon_control'&&e.event.actor===actorId)));
  const summonId=existing?.id??`${actorId}_summon`,recallId=`${actorId}_recall`;
  uniqueCommand(draft,command(button,direction),null,summonId);
  draft.actors=[...(draft.actors??[]).filter(a=>a.id!==actorId),{...prior,id:actorId,summon:true,description:text(description),...(!prior?.sprite?{idleAnimation:prior?.idleAnimation??`${actorId}_idle`}:{})}];
  if(existing){
    existing.trigger={...existing.trigger,...command(button,direction)};
    for(const phase of existing.phases)for(const entry of phase.events??[])if(entry.event.type==='summon_control'&&entry.event.actor===actorId)entry.event=event;
  }else{
    if(draft.moves?.some(m=>m.id===summonId))throw new Error('Summon move id already exists. Choose a different actor id.');
    (draft.moves??=[]).push(action(summonId,`Summon ${actorId}`,command(button,direction),event));
  }
  if(!draft.moves.some(m=>m.controlledActor===actorId&&m.phases.some(p=>p.events?.some(e=>e.event.type==='recall_summon')))){
    if(draft.moves.some(m=>m.id===recallId))throw new Error('Recall move id already exists.');
    draft.moves.push(action(recallId,`Recall ${actorId}`,command('hp'),{type:'recall_summon'},actorId));
  }
  draft.requireMotionCoverage=true;
  validateCombatRules(draft);
  return repository.saveDraft(characterId,draft,{operation:'define-summon'});
}

export async function addSummonMove(repository,{characterId,actorId,sourceMoveId,moveId,displayName,button='lp',direction='neutral'}) {
  id(moveId);
  const draft=clone(await repository.getDraft(characterId));
  if(!draft.actors?.some(a=>a.id===actorId&&a.summon))throw new Error('Choose a configured summon.');
  if(draft.moves.some(m=>m.id===moveId||m.animation===moveId))throw new Error('Move/animation id already exists; existing art will not be overwritten.');
  const source=draft.moves.find(m=>m.id===sourceMoveId);
  const events=source?.phases.flatMap(p=>(p.events??[]).map(e=>e.event))??[];
  if(!events.some(e=>['hitbox_active','grab_check'].includes(e.type))||events.some(e=>!['hitbox_active','hitbox_end','grab_check','grab_end','play_sound','spawn_effect','set_velocity'].includes(e.type)))throw new Error('Choose a strike or grab without projectile or transformation events.');
  const move=clone(source);
  uniqueCommand(draft,command(button,direction),actorId);
  Object.assign(move,{id:moveId,animation:moveId,requiredAnimation:moveId,displayName:text(displayName),controlledActor:actorId,
    description:`${displayName}: controlled by ${actorId}. Tune contact and timing, then generate isolated actor motion.`,trigger:command(button,direction),cancelInto:[],artStatus:'needs-generation'});
  delete move.visualTimeline;
  for(const phase of move.phases){
    phase.events=(phase.events??[]).filter(e=>!['set_velocity','spawn_effect'].includes(e.event.type));
    for(const entry of phase.events){
      if(['hitbox_active','hitbox_end','grab_check'].includes(entry.event.type))entry.event.actor=actorId;
      if(entry.event.grab)entry.event.grab.actorGrip={socketX:0,socketY:-48,lift:24,swing:12,...entry.event.grab.actorGrip,actor:actorId};
    }
  }
  draft.moves.push(move);validateCombatRules(draft);
  return repository.saveDraft(characterId,draft,{operation:'add-summon-move'});
}

function formRule(input) {
  id(input.formId);text(input.name);
  if(input.formId.length<3)throw new Error('Form ids must have at least 3 characters.');
  if(input.durationTicks!==null&&(!Number.isInteger(input.durationTicks)||input.durationTicks<1||input.durationTicks>36000))throw new Error('Form duration must be 1–36000 ticks or null (until KO).');
  if(!Number.isFinite(input.cost)||input.cost<0||input.cost>100)throw new Error('Form meter cost must be 0–100.');
}

/** A form is a separate hidden authoring draft, not a texture swap. */
export async function defineForm(repository,input) {
  formRule(input);
  const {characterId,formId,name,durationTicks,cost}=input;
  const parent=clone(await repository.getDraft(characterId));
  if(parent.parentId)throw new Error('Nested transformations are not supported.');
  if(formId===characterId)throw new Error('Form id must differ from its parent.');
  const existing=parent.formDrafts?.find(f=>f.id===formId);
  if(!existing&&parent.forms?.some(f=>f.id===formId))throw new Error('This is an installed legacy form. Use a new id to author a new independent form.');
  if(!existing){
    await repository.withMutation(formId,async()=>{
    if(await repository.storage.exists(repository.draftKey(formId)))throw new Error('That character id already exists; no draft was overwritten.');
    const moves=clone((parent.moves??[]).filter(m=>!m.controlledActor&&!m.phases.some(p=>p.events?.some(e=>['summon_control','transform','revert_form'].includes(e.event.type)))));
    const projectileNames=new Map((parent.projectiles??[]).map(p=>[p.animation??`${characterId}_${p.id}`,`${formId}_${p.id}`]));
    const moveIds=new Set(moves.map(move=>move.id));
    for(const move of moves){delete move.visualTimeline;move.artStatus='needs-generation';
      if(move.cancelInto)move.cancelInto=move.cancelInto.filter(id=>moveIds.has(id));
      if(move.trigger?.cancelFrom){
        move.trigger.cancelFrom=move.trigger.cancelFrom.filter(id=>moveIds.has(id));
        if(move.trigger.cancelOnly&&!move.trigger.cancelFrom.length)throw new Error(`Starter move ${move.id} depends on a summon or transformation. Give it a body-only predecessor before creating the form.`);
      }
      for(const phase of move.phases)for(const {event} of phase.events??[])if(event.projectile){event.projectile.animation=projectileNames.get(event.projectile.animation)??`${formId}_${event.projectile.id??move.id}`;delete event.projectile.sourceKey;}
    }
    const child={schemaVersion:parent.schemaVersion??1,id:formId,parentId:characterId,selectable:false,displayName:text(name),description:text(input.description),artBrief:text(input.description),
      artStyle:parent.artStyle,stats:clone(parent.stats??{}),combatStats:clone(parent.combatStats??{}),
      sprite:{relativeHeight:parent.sprite?.relativeHeight??1,scaleAdjust:parent.sprite?.scaleAdjust??1,frameCounts:{}},moves,
      projectiles:clone(parent.projectiles??[]).map(({sourceKey,...projectile})=>({...projectile,animation:`${formId}_${projectile.id}`})),combos:[],forms:[],requireMotionCoverage:true};
    validateCombatRules(child);
    await repository.saveDraft(formId,child,{operation:'create-hidden-form',parentId:characterId});
    });
  }
  const rule={...existing,id:formId,characterId:formId,name:text(name),durationTicks,cost};
  parent.formDrafts=[...(parent.formDrafts??[]).filter(f=>f.id!==formId),rule];
  parent.forms=(parent.forms??[]).map(f=>f.id===formId?{...f,name:rule.name,durationTicks,cost}:f);
  validateCombatRules(parent);
  return repository.saveDraft(characterId,parent,{operation:'define-form'});
}

const safeFile=file=>{
  if(typeof file!=='string'||file.startsWith('/')||file.includes('\\')||file.split('/').some(p=>!p||p==='.'||p==='..')||/[:?#]/.test(file))throw new Error('Unsafe form asset path.');
  return file;
};

/** Copy a reviewed snapshot into the parent's versioned pack. Later child edits
 * never mutate an installed form; installation is an explicit new snapshot. */
export async function installForm(repository,{characterId,formId}) {
  const parent=clone(await repository.getDraft(characterId));
  const rule=parent.formDrafts?.find(f=>f.id===formId);
  if(!rule)throw new Error('Define this form first.');
  return repository.withMutation(rule.characterId,async()=>{
    const child=await repository.getDraft(rule.characterId);
    if(child.parentId!==characterId||child.selectable!==false)throw new Error('Form ownership mismatch.');
    assertMotionCoverage({...child,requireMotionCoverage:true});
    if(child.forms?.length||child.formDrafts?.length)throw new Error('Nested forms are not supported.');
    const storage=repository.storage;
    const childRoot=child.assets?.rootKey??`characters/${child.id}/assets/fighter-pack`;
    const frameBytes=await storage.getBytes(`${childRoot}/frameData.json`);
    const manifestBytes=await storage.getBytes(`${childRoot}/manifest.json`);
    const frameData=JSON.parse(frameBytes.toString());
    const manifest=JSON.parse(manifestBytes.toString());
    if(!frameData.frames?.base?.length)throw new Error('The form needs its own base reference.');
    for(const row of requiredMotionRows(child))if((frameData.frames?.[row]?.length??0)<8)throw new Error(`Form ${formId} is missing extracted motion frames for ${row}.`);
    const config=convertDraftToCharacterConfig({draft:child,frameData,manifest});
    const copies=new Map();
    for(const sprite of [config.sprite,...(config.actors??[]).map(a=>a.sprite)].filter(Boolean)){
      for(const row of Object.values(sprite.frames??{}))for(const frame of row)copies.set(safeFile(frame.file),`${childRoot}/${safeFile(frame.file)}`);
      for(const file of Object.values(sprite.sheets??{}))copies.set(safeFile(file),`${childRoot}/${safeFile(file)}`);
    }
    const entities=new Map((child.projectiles??[]).map(p=>[p.animation??`${child.id}_${p.id}`,p]));
    for(const move of config.moves)for(const phase of move.phases)for(const {event} of phase.events??[])if(event.projectile&&!entities.has(event.projectile.animation))entities.set(event.projectile.animation,event.projectile);
    for(const projectile of entities.values()){
      if(projectile.visual)continue;
      const file=`projectiles/${safeFile(projectile.animation??`${child.id}_${projectile.id}`)}.png`;
      copies.set(file,projectile.sourceKey??`${childRoot}/${file}`);
    }
    // Read every required byte before switching the parent's installed config.
    const bytes=await Promise.all([...copies].map(async([file,key])=>[file,await storage.getBytes(key)]));
    const source=await repository.createVersion(child.id,child,{label:`Install form in ${characterId}`});
    const frozen=await storage.getJson(source.history.manifestKey);
    const hashes=new Map(frozen.assets.map(asset=>[asset.sourceKey,asset.original.sha256]));
    for(const [key,data] of [[`${childRoot}/frameData.json`,frameBytes],[`${childRoot}/manifest.json`,manifestBytes],...bytes.map(([file,data])=>[copies.get(file),data])]){
      if(!hashes.has(key))throw new Error('Every form asset must belong to its versioned workspace. Import external assets before installation.');
      if(hashes.get(key)!==digest(data))throw new Error('Form assets changed during installation. Retry after generation finishes.');
    }
    const relative=`forms/${formId}/${randomUUID()}`;
    const root=parent.assets?.rootKey??`${parent.history?.workingRoot??`characters/${characterId}/assets`}/fighter-pack`;
    for(const [file,data] of bytes)await storage.putBytes(`${root}/${relative}/${file}`,data,{operation:'install-form',sourceVersionId:source.versionId});
    config.id=formId;config.parentId=characterId;config.selectable=false;
    config.assetBasePath=`/fighters/${characterId}/${relative}`;
    for(const sprite of [config.sprite,...(config.actors??[]).map(a=>a.sprite)].filter(Boolean))sprite.basePath=config.assetBasePath;
    const form={id:formId,name:rule.name,durationTicks:rule.durationTicks,cost:rule.cost,config,
      source:{characterId:child.id,versionId:source.versionId,updatedAt:child.updatedAt,assetRootKey:`${root}/${relative}`}};
    parent.forms=[...(parent.forms??[]).filter(f=>f.id!==formId),form];
    validateCombatRules(parent);
    return repository.saveDraft(characterId,parent,{operation:'install-reviewed-form',sourceVersionId:source.versionId});
  });
}
