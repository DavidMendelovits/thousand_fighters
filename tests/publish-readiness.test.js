import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {FileCmsStorage} from '../cms/storage/FileCmsStorage.js';
import {CharacterContentRepository} from '../cms/repositories/CharacterContentRepository.js';
import {requiredMotionRows,approveMotionRow,requestMotionChanges} from '../cms/pipeline/motionRowArtifacts.js';
import {loadReviewContext,motionFingerprint,packFingerprint} from '../cms/pipeline/reviewFingerprint.js';
import {publishReadiness} from '../cms/authoring/publishReadiness.js';
import {CharacterCreationPipeline} from '../cms/pipeline/CharacterCreationPipeline.js';
import {PipelinePort} from '../cms/pipeline/ports.js';
import {updateWorkbench,workbenchDetail} from '../cms/authoring/workbenchLibrary.js';
import {FighterPackQaAdapter} from '../cms/pipeline/adapters/fighterPackQaAdapter.js';
import {getAnimationPlan} from '../cms/pipeline/animationPlan.js';

async function fixture(t){
  const directory=await mkdtemp(path.join(os.tmpdir(),'release-check-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const repository=new CharacterContentRepository(new FileCmsStorage({rootDir:directory})),id='paint_check',root=`characters/${id}/assets/fighter-pack`;
  const draft={id,displayName:'Paint',requireMotionCoverage:true,assets:{rootKey:root},moves:[{id:'ribbon',animation:'ribbon',phases:[{frames:3,events:[]}]}],sprite:{rowPlayback:{}},motionRows:{}};
  const frames={};
  for(const row of ['base',...requiredMotionRows(draft)]){
    frames[row]=Array.from({length:row==='base'?1:8},(_,i)=>({file:`sprites/${row}/${i}.png`,width:10,height:20,anchor:{x:5,y:19},durationFrames:3,sourceClipped:false}));
    for(const frame of frames[row])await repository.storage.putBytes(`${root}/${frame.file}`,Buffer.from(frame.file));
    await repository.storage.putBytes(`${root}/sheets/${row}.png`,Buffer.from(`sheet-${row}`));
    if(row!=='base')draft.motionRows[row]={status:'needs-visual-review',uniqueFrames:8,clippedFrames:[]};
  }
  await repository.storage.putJson(`${root}/frameData.json`,{frames});
  await repository.storage.putJson(`${root}/manifest.json`,{});
  await repository.saveDraft(id,draft);
  return {repository,id,root};
}
async function approve(repository,id,action){
  const {fingerprint}=await motionFingerprint(await loadReviewContext(repository,id),action);
  return approveMotionRow({repository,characterId:id,action,notes:'Inspected identity, edges, facing and contact.',expectedFingerprint:fingerprint});
}
async function ready(repository,id){
  for(const row of requiredMotionRows(await repository.getDraft(id)))await approve(repository,id,row);
  await repository.writeQaReport(id,'test-qa',{status:'pass',provider:'real',inputFingerprint:await packFingerprint(await loadReviewContext(repository,id))});
}

test('current assets approve; replaced pixels, sheets and authored timing invalidate approval',async t=>{
  const {repository,id,root}=await fixture(t);
  await approve(repository,id,'ribbon');
  assert.equal((await publishReadiness(repository,id)).rows.find(r=>r.row==='ribbon').status,'approved');
  for(const file of ['sprites/ribbon/0.png','sheets/ribbon.png']){
    await repository.storage.putBytes(`${root}/${file}`,Buffer.from('replacement'));
    assert.equal((await publishReadiness(repository,id)).rows.find(r=>r.row==='ribbon').status,'stale-review');
    assert.equal((await getAnimationPlan(repository,id)).scopes[0].jobs.find(job=>job.row==='ribbon').status,'needs-review');
    await approve(repository,id,'ribbon');
  }
  const draft=await repository.getDraft(id);draft.moves[0].phases[0].frames++;await repository.saveDraft(id,draft);
  assert.equal((await publishReadiness(repository,id)).rows.find(r=>r.row==='ribbon').status,'stale-review');
});
test('approval rejects a stale client fingerprint and leaves the current row unapproved',async t=>{
  const {repository,id,root}=await fixture(t);
  const {fingerprint}=await motionFingerprint(await loadReviewContext(repository,id),'ribbon');
  await repository.storage.putBytes(`${root}/sprites/ribbon/0.png`,Buffer.from('new'));
  await assert.rejects(approveMotionRow({repository,characterId:id,action:'ribbon',notes:'old view',expectedFingerprint:fingerprint}),/Motion changed/);
  assert.equal((await repository.getDraft(id)).motionRows.ribbon.status,'needs-visual-review');
});
test('older approvals are not silently converted into versioned reviews',async t=>{
  const {repository,id}=await fixture(t),draft=await repository.getDraft(id);draft.motionRows.ribbon.status='approved';draft.motionRows.ribbon.review={notes:'historical'};await repository.saveDraft(id,draft);
  const report=await publishReadiness(repository,id);assert.equal(report.canPublish,false);assert.equal(report.rows.find(r=>r.row==='ribbon').status,'unversioned-review');
});
test('requested changes revoke approval, survive reload and stay tied to inspected bytes',async t=>{
  const {repository,id,root}=await fixture(t);await ready(repository,id);
  const {fingerprint}=await motionFingerprint(await loadReviewContext(repository,id),'ribbon');
  await requestMotionChanges({repository,characterId:id,action:'ribbon',expectedFingerprint:fingerprint,notes:'Needle disconnects during opening; keep it attached to the upper hand.'});
  const report=await publishReadiness(repository,id);
  assert.equal(report.rows.find(row=>row.row==='ribbon').status,'changes-requested');assert.equal(report.canPublish,false);
  assert.equal((await getAnimationPlan(repository,id)).scopes[0].jobs.find(job=>job.row==='ribbon').status,'rejected');
  const draft=await repository.getDraft(id);draft.requireMotionCoverage=false;await repository.saveDraft(id,draft);
  assert.equal((await publishReadiness(repository,id)).canPublish,false,'explicit current rejection also blocks legacy packs');
  await repository.storage.putBytes(`${root}/sprites/ribbon/0.png`,Buffer.from('revised'));
  assert.equal((await publishReadiness(repository,id)).rows.find(row=>row.row==='ribbon').status,'stale-review');
  await assert.rejects(requestMotionChanges({repository,characterId:id,action:'ribbon',expectedFingerprint:fingerprint,notes:'old view'}),/Motion changed/);
  await approve(repository,id,'ribbon');
  assert.equal((await publishReadiness(repository,id)).rows.find(row=>row.row==='ribbon').status,'approved');
});
test('missing and clipped assets cannot be approved',async t=>{
  const {repository,id,root}=await fixture(t);
  const data=await repository.storage.getJson(`${root}/frameData.json`);data.frames.ribbon[0].sourceClipped=true;await repository.storage.putJson(`${root}/frameData.json`,data);
  await assert.rejects(approve(repository,id,'ribbon'),/clipping/);
  assert.equal((await publishReadiness(repository,id)).rows.find(r=>r.row==='ribbon').status,'rejected');
  data.frames.ribbon[0].sourceClipped=false;data.frames.ribbon[0].file='sprites/missing.png';await repository.storage.putJson(`${root}/frameData.json`,data);
  await assert.rejects(approve(repository,id,'ribbon'),/missing/);
});
test('strict publish is blocked before side effects when an approved row changes',async t=>{
  const {repository,id,root}=await fixture(t);await ready(repository,id);assert.equal((await publishReadiness(repository,id)).canPublish,true);
  await repository.storage.putBytes(`${root}/sprites/ribbon/0.png`,Buffer.from('changed'));
  let wrote=false;const pipeline=new CharacterCreationPipeline({resolve(port){if(port===PipelinePort.CHARACTER_REPOSITORY)return repository;if(port===PipelinePort.PUBLISHER)return {publishCharacter:async()=>{wrote=true;}};throw new Error(port);}});
  await assert.rejects(pipeline.publishCharacter({characterId:id}),/Publish blocked/);assert.equal(wrote,false);
});
test('reference replacement invalidates motion reviews; rejected current identity blocks publishing',async t=>{
  const {repository,id}=await fixture(t);await ready(repository,id);
  await repository.storage.putBytes(`characters/${id}/assets/concept/concept_art.png`,Buffer.from('new identity'));
  const reference=(await workbenchDetail(repository,id)).reference;
  await updateWorkbench(repository,id,{referenceStatus:'rejected',sha256:reference.sha256,notes:'Wrong silhouette'});
  const report=await publishReadiness(repository,id);assert.equal(report.canPublish,false);assert.equal(report.rows[0].status,'stale-review');assert.equal(report.referenceStatus,'rejected');
});
test('QA pins authored rules and asset bytes, not review notes or archive flags',async t=>{
  const {repository,id}=await fixture(t);await ready(repository,id);
  const draft=await repository.getDraft(id);draft.motionRows.ribbon.review.notes='More precise notes';await repository.saveDraft(id,draft);
  assert.equal((await publishReadiness(repository,id)).qaCurrent,true);
  draft.stats={health:1200};await repository.saveDraft(id,draft);
  assert.equal((await publishReadiness(repository,id)).qaCurrent,false);
  await updateWorkbench(repository,id,{archived:true});assert.equal((await publishReadiness(repository,id)).canPublish,false);
});
test('unsafe paths are rejected before reading outside the active pack',async t=>{
  const {repository,id,root}=await fixture(t),data=await repository.storage.getJson(`${root}/frameData.json`);data.frames.ribbon[0].file='../other.png';await repository.storage.putJson(`${root}/frameData.json`,data);
  await assert.rejects(publishReadiness(repository,id),/Unsafe review asset path/);
});

test('QA checks authored custom rows, not a hardcoded punch/kick template',()=>{
  const qa=new FighterPackQaAdapter({});
  const frames={base:[{}],paint_vortex:Array(8).fill({}),hands:Array(8).fill({})};
  assert.equal(qa._checkMinimumFrameCount({frames},{},Object.keys(frames)).status,'pass');
  assert.equal(qa._checkMinimumFrameCount({frames},{},[...Object.keys(frames),'missing_move']).status,'error');
  assert.equal(qa._checkFrameCountConsistency({frameCounts:{paint_vortex:7},sprites:{}},{frames},{paint_vortex:8}).status,'error');
});

test('placeholder QA and edits during validation cannot produce current strict readiness',async t=>{
  const {repository,id,root}=await fixture(t);await ready(repository,id);
  await repository.writeQaReport(id,'placeholder',{status:'pass',provider:'local',inputFingerprint:await packFingerprint(await loadReviewContext(repository,id))});
  assert.equal((await publishReadiness(repository,id)).canPublish,false);
  const pipeline=new CharacterCreationPipeline({resolve(port){
    if(port===PipelinePort.CHARACTER_REPOSITORY)return repository;
    if(port===PipelinePort.FIGHTER_QA)return {async validateFighterPack(){await repository.storage.putBytes(`${root}/sprites/ribbon/0.png`,Buffer.from('concurrent edit'));return {status:'pass',provider:'real'};}};
    throw new Error(port);
  }});
  await assert.rejects(pipeline.validateFighterPack({characterId:id,normalizedKey:`${root}/manifest.json`}),/changed during validation/);
  assert.equal((await publishReadiness(repository,id)).qaCurrent,false);
});
