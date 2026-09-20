import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {FileCmsStorage} from '../cms/storage/FileCmsStorage.js';
import {CharacterContentRepository} from '../cms/repositories/CharacterContentRepository.js';
import {defineSummon,addSummonMove,defineForm,installForm} from '../cms/authoring/characterComponents.js';
import {planAnimations,getAnimationPlan} from '../cms/pipeline/animationPlan.js';
import {requiredMotionRows,assertMotionCoverage} from '../cms/pipeline/motionRowArtifacts.js';
import {exportCharacterToRuntime} from '../cms/export/exportCharacterToRuntime.js';
import {CharacterCreationPipeline} from '../cms/pipeline/CharacterCreationPipeline.js';
import {createCmsTools} from '../cms/tools/createCmsTools.js';
import {validateCombatRules} from '../cms/export/validateCombatRules.js';

const move=()=>({id:'jab',displayName:'Paint jab',animation:'jab',trigger:{sequence:['lp']},phases:[{name:'startup',frames:4,events:[]},{name:'active',frames:3,events:[{frame:0,event:{type:'hitbox_active',hitbox:{x:10,y:-40,width:20,height:20,damage:10,hitstun:6,knockbackX:2,knockbackY:0}}},{frame:2,event:{type:'hitbox_end'}}]},{name:'recovery',frames:8,events:[]}]});
async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'components-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const storage=new FileCmsStorage({rootDir:root}),repository=new CharacterContentRepository(storage);
  await repository.saveDraft('paint',{id:'paint',displayName:'Paint',description:'Flowing pigment',stats:{},sprite:{scale:.5},moves:[move()],projectiles:[]});
  return {root,storage:repository.storage,repository};
}
const summon={characterId:'paint',actorId:'hands',description:'Floating needle hands',durationTicks:240,speed:4,offsetX:80,offsetY:-40,button:'hp',direction:'down'};
const form={characterId:'paint',formId:'paint_storm',name:'Paint storm',description:'A cloud of swirling pigment',durationTicks:720,cost:50};

test('summon editor creates control and recall without deleting source moves or inventing art',async t=>{
  const {repository}=await fixture(t),before=await repository.getDraft('paint');
  const draft=await defineSummon(repository,summon);
  assert.deepEqual(draft.moves[0],before.moves[0]);assert.equal(draft.actors[0].idleAnimation,'hands_idle');
  assert.equal(draft.moves.find(m=>m.id==='hands_recall').controlledActor,'hands');
  const tuned=await defineSummon(repository,{...summon,speed:6});
  assert.equal(tuned.moves.length,3);assert.equal(tuned.moves.find(m=>m.id==='hands_summon').phases[1].events[0].event.speed,6);
  await assert.rejects(defineSummon(repository,{...summon,durationTicks:999}),/Invalid summon/);
});

test('controlled move gets fresh animation, scoped contacts and collision-safe inputs',async t=>{
  const {repository}=await fixture(t);await defineSummon(repository,summon);
  const input={characterId:'paint',actorId:'hands',sourceMoveId:'jab',moveId:'needle',displayName:'Needle',button:'lp',direction:'neutral'};
  const draft=await addSummonMove(repository,input),needle=draft.moves.find(m=>m.id==='needle');
  assert.equal(needle.controlledActor,'hands');assert.equal(needle.animation,'needle');assert.equal(needle.visualTimeline,undefined);
  assert.equal(needle.phases[1].events[0].event.actor,'hands');
  assert.equal(draft.moves[0].phases[1].events[0].event.actor,undefined);
  await assert.rejects(addSummonMove(repository,{...input,moveId:'needle_two'}),/command is already used/);
  await assert.rejects(addSummonMove(repository,{...input,moveId:'recall_conflict',button:'hp'}),/command is already used/);
});

test('forms are hidden independent drafts with no inherited artwork and editable expiry',async t=>{
  const {repository}=await fixture(t);
  await defineForm(repository,form);const child=await repository.getDraft('paint_storm');
  assert.equal(child.parentId,'paint');assert.equal(child.selectable,false);assert.deepEqual(child.sprite.frameCounts,{});
  assert.equal(child.assets,undefined);assert.equal(child.motionRows,undefined);assert.equal(child.moves[0].artStatus,'needs-generation');
  const parent=await defineForm(repository,{...form,durationTicks:null,cost:25});
  assert.equal(parent.formDrafts.length,1);assert.equal(parent.formDrafts[0].durationTicks,null);
  assert.throws(()=>assertMotionCoverage(parent),/not been installed/);
  await assert.rejects(defineForm(repository,{...form,characterId:'paint_storm',formId:'nested'}),/Nested/);
  await repository.saveDraft('taken',{id:'taken',moves:[]});
  await assert.rejects(defineForm(repository,{...form,formId:'taken'}),/already exists/);
});

test('planner is read-only, de-duplicates rows and distinguishes references, review and approval',async t=>{
  const {repository,storage}=await fixture(t);await defineSummon(repository,summon);await defineForm(repository,form);
  const before=await storage.list(''),plan=await getAnimationPlan(repository,'paint');
  assert.deepEqual(await storage.list(''),before);assert.equal(plan.paidRequests,0);assert.equal(plan.scopes.length,2);
  assert.equal(plan.scopes[0].jobs.find(j=>j.row==='hands_idle').status,'missing');
  assert.equal(plan.scopes[0].jobs.find(j=>j.row==='jab').status,'blocked');
  const draft={id:'paint',moves:[move(),move()],motionRows:{jab:{status:'approved',uniqueFrames:8,clippedFrames:[]}}};
  let p=planAnimations(draft,{frames:{base:[{}],jab:Array(8).fill({})}});
  assert.equal(p.jobs.filter(j=>j.row==='jab').length,1);assert.equal(p.jobs.find(j=>j.row==='base').status,'reference-ready');
  assert.equal(p.jobs.find(j=>j.row==='jab').status,'approved');
  draft.motionRows.jab.clippedFrames=[1];p=planAnimations(draft,{frames:{jab:[{}]}});assert.equal(p.jobs.find(j=>j.row==='jab').status,'rejected');
});

test('form starter moves cannot retain dangling summon-only string predecessors',async t=>{
  const {repository}=await fixture(t);await defineSummon(repository,summon);
  const parent=await repository.getDraft('paint');
  parent.moves[0].trigger={sequence:['lp'],cancelOnly:true,cancelFrom:['hands_summon']};
  await repository.saveDraft('paint',parent);
  await assert.rejects(defineForm(repository,form),/body-only predecessor/);
  assert.equal(await repository.storage.exists(repository.draftKey(form.formId)),false);
});

async function approveFixture(repository,storage){
  const child=await repository.getDraft('paint_storm'),rows=['base',...requiredMotionRows(child)];
  child.motionRows={};child.assets={rootKey:'characters/paint_storm/assets/fighter-pack'};
  const frames={},sheets={},counts={};
  for(const row of rows){
    frames[row]=Array.from({length:8},(_,index)=>({file:`sprites/${row}/${index}.png`,width:32,height:32,anchor:{x:16,y:32}}));
    sheets[row]=`sheets/${row}.png`;counts[row]=8;
    for(const frame of frames[row])await storage.putBytes(`${child.assets.rootKey}/${frame.file}`,Buffer.from(`fixture-${row}`));
    await storage.putBytes(`${child.assets.rootKey}/${sheets[row]}`,Buffer.from('fixture-sheet'));
    child.motionRows[row]={status:'approved',uniqueFrames:8,clippedFrames:[],review:{notes:'Synthetic contract fixture, not visual acceptance'}};
  }
  child.moves[0].artStatus='ready';
  await storage.putJson(`${child.assets.rootKey}/frameData.json`,{frames});
  await storage.putJson(`${child.assets.rootKey}/manifest.json`,{id:child.id,sheets,frameCounts:counts});
  await repository.saveDraft(child.id,child);
}

test('installation rejects assets changed between read and checkpoint without switching parent',async t=>{
  const {repository,storage}=await fixture(t);await defineForm(repository,form);await approveFixture(repository,storage);
  const before=await repository.getDraft('paint'),checkpoint=repository.createVersion.bind(repository);
  repository.createVersion=async(...args)=>{
    await storage.putBytes('characters/paint_storm/assets/fighter-pack/sprites/jab/0.png',Buffer.from('concurrent-generation'));
    return checkpoint(...args);
  };
  await assert.rejects(installForm(repository,{characterId:'paint',formId:'paint_storm'}),/changed during installation/);
  assert.deepEqual(await repository.getDraft('paint'),before);
});

test('a hidden form can own a separately animated and controlled summon',async t=>{
  const {repository,storage}=await fixture(t);await defineForm(repository,form);
  await defineSummon(repository,{...summon,characterId:'paint_storm'});
  await addSummonMove(repository,{characterId:'paint_storm',actorId:'hands',sourceMoveId:'jab',moveId:'needle',displayName:'Needle',button:'lp',direction:'neutral'});
  await approveFixture(repository,storage);
  const parent=await installForm(repository,{characterId:'paint',formId:'paint_storm'});
  const config=parent.forms[0].config,actor=config.actors.find(actor=>actor.id==='hands');
  assert.equal(actor.sprite.frames.needle.length,8);
  assert.equal(actor.sprite.basePath,config.sprite.basePath);
  // Validate ownership even when the body pack does not duplicate actor rows.
  delete config.sprite.frames.needle;
  assert.doesNotThrow(()=>validateCombatRules(parent));
});

test('reviewed form installation pins bytes and survives parent export and later child edits',async t=>{
  const {repository,storage,root}=await fixture(t);await defineForm(repository,form);
  await assert.rejects(installForm(repository,{characterId:'paint',formId:'paint_storm'}),/Incomplete motion/);
  await approveFixture(repository,storage);
  const parent=await installForm(repository,{characterId:'paint',formId:'paint_storm'}),installed=parent.forms[0];
  assert.equal(installed.config.parentId,'paint');assert.equal(installed.config.selectable,false);
  assert.ok(installed.source.versionId);assert.match(installed.config.sprite.basePath,/\/fighters\/paint\/forms\/paint_storm\//);
  await storage.putBytes('characters/paint_storm/assets/fighter-pack/sprites/jab/0.png',Buffer.from('changed'));
  assert.equal((await storage.getBytes(`${installed.source.assetRootKey}/sprites/jab/0.png`)).toString(),'fixture-jab');
  const version=await repository.createVersion('paint',parent,{label:'Parent with pinned form'});
  const result=await exportCharacterToRuntime({runtime:{repository,storage},characterId:'paint',content:version,outputDir:path.join(root,'runtime')});
  const relative=installed.config.sprite.basePath.replace('/fighters/paint/','');
  assert.equal(await readFile(path.join(root,'runtime/paint',relative,'sprites/jab/0.png'),'utf8'),'fixture-jab');
  assert.equal(result.config.forms[0].config.id,'paint_storm');
  const child=await repository.getDraft('paint_storm');await repository.saveDraft(child.id,{...child,description:'New draft edits'});
  assert.equal((await getAnimationPlan(repository,'paint')).scopes[1].hasUninstalledEdits,true);
});

test('missing form assets leave installed parent unchanged',async t=>{
  const {repository,storage}=await fixture(t);await defineForm(repository,form);await approveFixture(repository,storage);
  const frames=await storage.getJson('characters/paint_storm/assets/fighter-pack/frameData.json');frames.frames.jab[0].file='sprites/missing.png';
  await storage.putJson('characters/paint_storm/assets/fighter-pack/frameData.json',frames);
  const before=await repository.getDraft('paint');
  await assert.rejects(installForm(repository,{characterId:'paint',formId:'paint_storm'}),/ENOENT/);
  assert.deepEqual(await repository.getDraft('paint'),before);
});

test('hidden form cannot publish as a standalone selectable fighter',async t=>{
  const {repository}=await fixture(t);await defineForm(repository,form);
  const pipeline=new CharacterCreationPipeline({resolve:()=>repository});
  await assert.rejects(pipeline.publishCharacter({characterId:'paint_storm'}),/through their parent/);
});

test('workbench tools checkpoint definitions but planning never creates versions',async t=>{
  const {repository}=await fixture(t),tools=createCmsTools({repository,pipeline:{},registry:{}});
  await tools.invoke('define_summon',summon);
  const before=await repository.listVersions('paint');assert.equal(before.length,2);
  await tools.invoke('get_animation_plan',{characterId:'paint'});
  assert.deepEqual(await repository.listVersions('paint'),before);
});
