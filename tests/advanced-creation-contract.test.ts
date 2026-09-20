import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CharacterCreationPipeline} from '../cms/pipeline/CharacterCreationPipeline.js';
import {PipelinePort} from '../cms/pipeline/ports.js';
import {characterContentDraftSchema,comboAuthoringSchema} from '../cms/pipeline/adapters/characterContentDraftSchema.js';
import {normalizeGeneratedMoves} from '../cms/pipeline/adapters/advancedMoveSchema.js';
import {convertDraftToCharacterConfig,resolveDraftActors} from '../cms/export/convertDraftToCharacterConfig.js';
import {validateCombatRules} from '../cms/export/validateCombatRules.js';
import {requiredMotionRows,assertMotionCoverage} from '../cms/pipeline/motionRowArtifacts.js';
import {motionActorReference} from '../cms/pipeline/adapters/workbenchVideoRow.js';
import {createPalimpsest} from '../src/characters/palimpsest';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {FileCmsStorage} from '../cms/storage/FileCmsStorage.js';
import {createLocalCmsRuntime} from '../cms/runtime/createLocalCmsRuntime.js';
import {createCmsServer} from '../cms/server/createCmsServer.js';
import {exportCharacterToRuntime} from '../cms/export/exportCharacterToRuntime.js';
import {isAuthoredRow,createCmsTools} from '../cms/tools/createCmsTools.js';

function fixture():any {
  return {...createPalimpsest(),stats:{},sprite:{scale:.5,frameCounts:{}},
    actors:[{id:'hands',summon:true,idleAnimation:'hands_idle',description:'Isolated floating paint hands'}]};
}
function pipeline(value:any,onSave:(draft:any)=>any){
  return new CharacterCreationPipeline({resolve(port:string){
    if(port===PipelinePort.TEXT_MODEL)return {completeStructured:async()=>({value,provider:'test'})};
    if(port===PipelinePort.CHARACTER_REPOSITORY)return {saveDraft:async(_id:string,draft:any)=>onSave(draft)};
    throw new Error(port);
  }});
}

test('strict creation and combo schemas expose advanced events without permissive objects',()=>{
  function strict(schema:any){
    if(schema.type==='object'){
      assert.equal(schema.additionalProperties,false);
      assert.deepEqual([...schema.required].sort(),Object.keys(schema.properties).sort());
      Object.values(schema.properties).forEach(strict);
    }
    schema.anyOf?.forEach(strict);
    if(schema.items)strict(schema.items);
  }
  const schema=characterContentDraftSchema();strict(schema);strict(comboAuthoringSchema());
  assert.ok(schema.properties.actors);
  assert.equal(schema.properties.moves.items.properties.animation.enum,undefined);
  const events=schema.properties.moves.items.properties.phases.items.properties.events.items.properties.event.anyOf;
  for(const type of ['grab_check','grab_end','summon_control','recall_summon','spawn_projectile_from_sky','spawn_projectile_behind_target'])assert.ok(events.some((e:any)=>e.properties.type.enum.includes(type)));
});

test('workbench permits declared custom rows for image generation and extraction, not arbitrary paths',async()=>{
  const draft=fixture(),calls:any[]=[];
  const tools=createCmsTools({repository:{getDraft:async()=>draft},pipeline:{
    generateSpriteSheet:async(input:any)=>{calls.push(input);return {};},
    extractRowFrames:async(input:any)=>{calls.push(input);return {};},
  },registry:{}});
  assert.equal(isAuthoredRow(draft,'hands_idle'),true);
  assert.equal(isAuthoredRow(draft,'needle_thrust'),true);
  assert.equal(isAuthoredRow(draft,'../hands'),false);
  assert.equal(isAuthoredRow(undefined,'unowned'),false);
  await tools.invoke('generate_sprite_sheet',{characterId:'paint',moveId:'hands_idle',prompt:'Isolated hands',generator:'image'});
  await tools.invoke('extract_row_frames',{characterId:'paint',moveId:'hands_idle',sourceAssetKey:'source.png'});
  assert.equal(calls.length,2);
  await assert.rejects(tools.invoke('generate_sprite_sheet',{characterId:'paint',moveId:'unowned',prompt:'test'}),/unknown row/);
});

test('normalization removes optional nulls without changing authored false/zero or input',()=>{
  const input={controlledActor:null,trigger:{directions:null},event:{type:'grab_check',grab:{actorGrip:null,groundOnly:false,damage:0}}};
  assert.deepEqual(normalizeGeneratedMoves(input),{trigger:{},event:{type:'grab_check',grab:{groundOnly:false,damage:0}}});
  assert.equal(input.controlledActor,null);
});

test('creation persists summon blueprint and commands and requires motion review',async()=>{
  const source=fixture();source.moves[0].controlledActor=null;
  const draft=await pipeline(source,d=>d).createCharacterDraft({characterId:'new_paint',brief:'Nonhuman paint summoner'});
  assert.deepEqual(draft.actors,source.actors);
  assert.equal(draft.requireMotionCoverage,true);
  assert.equal(draft.moves[0].controlledActor,undefined);
  assert.deepEqual(draft.moves.find((m:any)=>m.id==='summon').trigger.directions,['down','down-forward','down-back']);
  assert.ok(requiredMotionRows(draft).includes('hands_idle'));
  assert.throws(()=>assertMotionCoverage(draft),/hands_idle/);
  assert.throws(()=>convertDraftToCharacterConfig({draft}),/missing animation/);
});

test('creation persists an explicit art style and rejects unsupported styles before model work',async()=>{
  for(const artStyle of ['paint','watercolor','pixel']){
    const draft=await pipeline(fixture(),d=>d).createCharacterDraft({characterId:'style_test',brief:'Material-specific motion',artStyle});
    assert.equal(draft.artStyle,artStyle);
  }
  await assert.rejects(new CharacterCreationPipeline({resolve(){throw new Error('Model must not run');}}).createCharacterDraft({characterId:'style_test',brief:'x',artStyle:'unsupported'}),/Unsupported character art style/);
});

test('malformed generated summon references fail before any draft write',async()=>{
  const source=fixture();source.actors=[];let writes=0;
  await assert.rejects(pipeline(source,()=>{writes++;}).createCharacterDraft({characterId:'bad',brief:'test'}),/configured actor|unknown actor/);
  assert.equal(writes,0);
});

test('summon export derives isolated actor pack and body without corrupting legacy actors',()=>{
  const draft=fixture();
  const rows=['base','hands_idle',...draft.moves.filter((m:any)=>m.controlledActor).map((m:any)=>m.animation)];
  const frames=Object.fromEntries(rows.map(row=>[row,[{file:`sprites/${row}/1.png`,width:128,height:128,anchor:{x:64,y:120}}]]));
  const result=convertDraftToCharacterConfig({draft,frameData:{frames}});
  assert.equal(result.actors[0].id,'lead');assert.deepEqual(result.actors[0].sprite,result.sprite);
  const hands=result.actors[1];assert.equal(hands.defaultVisible,false);
  assert.equal(hands.sprite.frames.base[0].file,'sprites/hands_idle/1.png');
  assert.equal(hands.sprite.frames.ribbon_jab,undefined);
  assert.equal(result.moves.find((m:any)=>m.id==='hands_pinch').phases[1].events[0].event.grab.actorGrip.actor,'hands');
  const legacy={actors:[{id:'lead',sprite:{basePath:'/legacy'}},{id:'hands',summon:true,sprite:{basePath:'/legacy-hands'}}]};
  assert.deepEqual(resolveDraftActors(legacy,result.sprite),legacy.actors);
});

test('video reference resolves by animation row and never substitutes body for missing actor',()=>{
  const draft=fixture();draft.moves.find((m:any)=>m.id==='needle_thrust').animation='needle_action';
  draft.sprite.frames={base:[{file:'body.png'}],hands_idle:[{file:'hands.png'}]};
  assert.deepEqual(motionActorReference(draft,'needle_action'),{actorId:'hands',referenceFile:'hands.png'});
  assert.equal(motionActorReference(draft,'hands_idle').referenceFile,'hands.png');
  delete draft.sprite.frames.hands_idle;
  assert.equal(motionActorReference(draft,'needle_action',{frames:{hands_idle:[{file:'extracted-hands.png'}]}}).referenceFile,'extracted-hands.png');
  assert.throws(()=>motionActorReference(draft,'needle_action'),/body reference will not be substituted/);
});

test('validation rejects duplicate actors and owner-relative summon contacts',()=>{
  const draft=fixture();
  draft.actors.push({...draft.actors[0]});assert.throws(()=>validateCombatRules(draft),/unique/);
  draft.actors.pop();delete draft.moves.find((m:any)=>m.id==='needle_thrust').phases[1].events[0].event.actor;
  assert.throws(()=>validateCombatRules(draft),/contact must target/);
});

test('projectile spawn references preserve behind distance and sky coordinates',()=>{
  const projectile={id:'ink',width:16,height:16,speed:4,lifetime:60,animation:'ink',velocity:{x:4,y:0,relativeToFacing:true},hitbox:{x:0,y:0,width:16,height:16,damage:10,hitstun:6,blockstun:4,knockback:{x:2,y:0},level:'mid'}};
  const draft={id:'paint',moves:[{id:'cast',animation:'cast',phases:[{name:'active',frames:3,events:[
    {frame:0,event:{type:'spawn_projectile_behind_target',projectileId:'ink',distance:135,offsetY:-82}},
    {frame:1,event:{type:'spawn_projectile_from_sky',projectileId:'ink',targetOffsetX:45,spawnOffsetY:-280}},
  ]}]}],projectiles:[projectile]};
  const events=convertDraftToCharacterConfig({draft}).moves[0].phases[0].events.map((e:any)=>e.event);
  assert.equal(events[0].distance,135);assert.equal(events[0].offsetY,-82);
  assert.equal(events[1].targetOffsetX,45);assert.equal(events[1].spawnOffsetY,-280);
});

test('workbench HTTP create/save/reload path preserves advanced kit in isolated storage',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'advanced-creation-'));
  const runtime=createLocalCmsRuntime({storage:new FileCmsStorage({rootDir:root}),
    textModel:{id:'test-text',provider:'mock',completeStructured:async()=>({value:fixture(),provider:'mock'})}});
  const server=createCmsServer({runtime});
  try {
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const origin=`http://127.0.0.1:${(server.address() as any).port}`;
    const invoke=async(name:string,input:any)=>{
      const response=await fetch(`${origin}/api/tools/${name}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
      const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;
    };
    await invoke('create_character_draft',{characterId:'paint_test',brief:'Floating paint hands'});
    const before=await runtime.repository.getDraft('paint_test');
    const moves=structuredClone(before.moves);
    moves.find((m:any)=>m.id==='hands_pinch').phases[1].events[0].event.grab.actorGrip.lift=48;
    await invoke('update_character_draft',{characterId:'paint_test',patch:{moves}});
    const response=await fetch(`${origin}/api/characters/paint_test/draft`);
    assert.equal(response.status,200);
    const {draft}=await response.json();
    assert.equal(draft.actors[0].idleAnimation,'hands_idle');
    assert.equal(draft.moves.find((m:any)=>m.id==='hands_pinch').phases[1].events[0].event.grab.actorGrip.lift,48);
    // Structural contract test only: no approved imagery is invented. Export
    // must refuse the new draft before writing a runtime config.
    await assert.rejects(exportCharacterToRuntime({characterId:'paint_test',runtime,outputDir:path.join(root,'runtime')}),/Incomplete motion pack/);
  } finally {
    server.closeAllConnections();
    if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));
    await rm(root,{recursive:true,force:true});
  }
});
