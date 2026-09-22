import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createCmsStorage} from '../cms/storage/createCmsStorage.js';
import {CharacterContentRepository} from '../cms/repositories/CharacterContentRepository.js';
import {CharacterBuildPlans} from '../cms/plans/CharacterBuildPlans.js';
import {digest} from '../cms/storage/LineageStore.js';
import {loadReviewContext,motionFingerprint} from '../cms/pipeline/reviewFingerprint.js';

async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'tf-plans-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const storage=createCmsStorage({provider:'file',rootDir:root}),repository=new CharacterContentRepository(storage);
  await repository.saveDraft('probe',{displayName:'Probe',description:'Liquid paint movement',moves:[{id:'jab',animation:'paint_jab',input:['forward','light']}]});
  const jobs=new Map(),calls=[];
  const buildJobs={get:async(c,id)=>{if(!jobs.has(id))throw Object.assign(Error('missing'),{statusCode:404});return jobs.get(id);},submit:async(c,input)=>{calls.push(input);const job={id:input.idempotencyKey,status:'queued',phase:'fixture'};jobs.set(job.id,job);return {job};}};
  return {storage,repository,buildJobs,jobs,calls,manager:new CharacterBuildPlans({storage,repository,buildJobs})};
}
const settings={budgetUsd:2,maxSubmissions:3,estimatedCostUsd:0.5};

test('saved itinerary survives restart, reserves before submission, and waits without duplicate calls',async t=>{
  const f=await fixture(t),plan=await f.manager.create('probe',settings);
  assert.equal(f.calls.length,0);assert.ok(plan.steps.some(s=>s.row==='paint_jab'));assert.ok(plan.steps.some(s=>s.row==='walk_forward'&&s.representative));
  const restarted=new CharacterBuildPlans(f);
  const [a,b]=await Promise.all([restarted.advance('probe',plan.id,{confirmed:true}),restarted.advance('probe',plan.id,{confirmed:true})]);
  assert.equal(f.calls.length,1);assert.equal(a.budget.reservedUsd,0.5);assert.equal(b.budget.reservedSubmissions,1);
  assert.equal((await restarted.list('probe')).length,1);
  f.jobs.get(f.calls[0].idempotencyKey).status='needs-recovery';
  assert.equal((await restarted.advance('probe',plan.id,{confirmed:true})).status,'needs-recovery');assert.equal(f.calls.length,1);
});

test('local no-provider preflight rearms once and requires a second explicit click',async t=>{
  const f=await fixture(t),plan=await f.manager.create('probe',settings);
  await f.manager.advance('probe',plan.id,{confirmed:true});
  const first=f.calls[0].idempotencyKey;
  Object.assign(f.jobs.get(first),{status:'failed',phase:'Local preparation failed · no provider request',attempts:[]});
  const rearmed=await f.manager.advance('probe',plan.id,{confirmed:true});
  assert.equal(rearmed.status,'ready');assert.equal(f.calls.length,1);
  assert.equal(rearmed.budget.reservedSubmissions,1);
  await f.manager.advance('probe',plan.id,{confirmed:true});
  assert.equal(f.calls.length,2);assert.notEqual(f.calls[1].idempotencyKey,first);
  assert.equal((await f.manager.get('probe',plan.id)).budget.reservedSubmissions,1);
});

test('unknown cost requires opt-in, explicit confirmation, and estimated cap blocks before a request',async t=>{
  const f=await fixture(t),unknown=await f.manager.create('probe',{budgetUsd:2,maxSubmissions:2});
  await assert.rejects(f.manager.advance('probe',unknown.id),/Confirm/);
  await assert.rejects(f.manager.advance('probe',unknown.id,{confirmed:true}),/unknown/);
  const expensive=await f.manager.create('probe',{...settings,estimatedCostUsd:3});
  await assert.rejects(f.manager.advance('probe',expensive.id,{confirmed:true}),/ceiling/);assert.equal(f.calls.length,0);
  const allowed=await f.manager.create('probe',{budgetUsd:0,maxSubmissions:1,allowUnknownCosts:true});
  const result=await f.manager.advance('probe',allowed.id,{confirmed:true});assert.equal(result.budget.unknownReservations,1);assert.equal(result.budget.reservedUsd,0);
});

test('failed durable reservation prevents admission; lost submit response retries the same reserved ID',async t=>{
  const f=await fixture(t),plan=await f.manager.create('probe',settings),original=f.storage.lineage.immutable.bind(f.storage.lineage);
  f.storage.lineage.immutable=async()=>{throw Error('disk full');};
  await assert.rejects(f.manager.advance('probe',plan.id,{confirmed:true}),/disk full/);assert.equal(f.calls.length,0);
  f.storage.lineage.immutable=original;
  const submit=f.buildJobs.submit;f.buildJobs.submit=async()=>{throw Error('lost response before admission');};
  await assert.rejects(f.manager.advance('probe',plan.id,{confirmed:true}),/lost response/);
  const reserved=await f.manager.get('probe',plan.id);assert.equal(reserved.budget.reservedSubmissions,1);
  f.buildJobs.submit=submit;
  const next=await new CharacterBuildPlans(f).advance('probe',plan.id,{confirmed:true});
  assert.equal(next.budget.reservedSubmissions,1);assert.equal(f.calls[0].idempotencyKey,reserved.steps[0].jobId);
});

test('changed rules or reference bytes reject stale plans before spend',async t=>{
  const f=await fixture(t),plan=await f.manager.create('probe',settings);
  await f.repository.saveDraft('probe',{description:'Different material'});
  await assert.rejects(f.manager.advance('probe',plan.id,{confirmed:true}),/rules changed/);
  const fresh=await f.manager.create('probe',settings);
  await f.storage.putBytes('characters/probe/assets/concept/concept_art.png',Buffer.from('changed'));
  await assert.rejects(f.manager.advance('probe',fresh.id,{confirmed:true}),/reference bytes changed/);assert.equal(f.calls.length,0);
});

test('completed identity waits for version-bound review and base requires its own checkpoint',async t=>{
  const f=await fixture(t),plan=await f.manager.create('probe',settings);
  await f.manager.advance('probe',plan.id,{confirmed:true});
  await f.storage.putBytes('characters/probe/assets/concept/concept_art.png',Buffer.from('concept'));
  f.jobs.get(f.calls[0].idempotencyKey).status='completed';
  assert.equal((await f.manager.advance('probe',plan.id,{confirmed:true})).status,'review');assert.equal(f.calls.length,1);
  await f.repository.saveDraft('probe',{...await f.repository.getDraft('probe'),referenceReview:{sha256:digest(Buffer.from('concept')),status:'approved'}});
  await f.manager.advance('probe',plan.id,{confirmed:true});assert.equal(f.calls.length,2);assert.equal(f.calls[1].input.moveId,'base');
  const root='characters/probe/assets/fighter-pack';await f.storage.putBytes(`${root}/base.png`,Buffer.from('base'));await f.storage.putJson(`${root}/frameData.json`,{frames:{base:[{file:'base.png'}]}});
  f.jobs.get(f.calls[1].idempotencyKey).status='completed';
  const waiting=await f.manager.advance('probe',plan.id,{confirmed:true}),base=waiting.steps.find(s=>s.row==='base');assert.equal(base.status,'review');assert.equal(f.calls.length,2);
  await assert.rejects(f.manager.review('probe',plan.id,{stepId:base.id,expectedFingerprint:'wrong',notes:'Checked silhouette and edges.',confirmed:true}),/Reference changed/);
  await f.manager.review('probe',plan.id,{stepId:base.id,expectedFingerprint:base.reviewFingerprint,notes:'Checked silhouette and edges.',confirmed:true});
  await f.manager.advance('probe',plan.id,{confirmed:true});assert.equal(f.calls[2].input.moveId,'walk_forward');
});

test('current change request unlocks one bounded retry but stale feedback cannot spend',async t=>{
  const f=await fixture(t),pack='characters/probe/assets/fighter-pack',concept=Buffer.from('approved concept');
  await f.storage.putBytes('characters/probe/assets/concept/concept_art.png',concept);
  const frames={base:[{file:'sprites/base/base_001.png'}],walk_forward:Array.from({length:8},(_,i)=>({file:`sprites/walk_forward/walk_${i}.png`}))};
  for(const row of Object.values(frames))for(const frame of row)await f.storage.putBytes(`${pack}/${frame.file}`,Buffer.from(frame.file));
  await f.storage.putBytes(`${pack}/sheets/walk_forward.png`,Buffer.from('walk sheet'));
  await f.storage.putJson(`${pack}/frameData.json`,{frames});
  const draft=await f.repository.getDraft('probe');
  await f.repository.saveDraft('probe',{...draft,assets:{rootKey:pack},referenceReview:{sha256:digest(concept),status:'approved'},sprite:{frames}});
  const plan=await f.manager.create('probe',{budgetUsd:0.5,maxSubmissions:1,estimatedCostUsd:0.5});
  const base=plan.steps.find(s=>s.row==='base'&&s.kind==='reference');
  await f.manager.review('probe',plan.id,{stepId:base.id,expectedFingerprint:base.reviewFingerprint,notes:'Inspected reference scale and edges.',confirmed:true});
  const context=await loadReviewContext(f.repository,'probe');
  const {fingerprint}=await motionFingerprint(context,'walk_forward');
  const saved=await f.repository.getDraft('probe');
  await f.repository.saveDraft('probe',{...saved,motionRows:{walk_forward:{status:'changes-requested',uniqueFrames:8,review:{decision:'changes-requested',fingerprint,notes:'Keep all three eyes visible during the glide.'}}}});
  const submitted=await f.manager.advance('probe',plan.id,{confirmed:true});
  assert.equal(submitted.status,'running');assert.equal(submitted.budget.reservedSubmissions,1);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].input.moveId,'walk_forward');
  await f.manager.advance('probe',plan.id,{confirmed:true});assert.equal(f.calls.length,1);
  f.jobs.get(f.calls[0].idempotencyKey).status='completed';
  const approvedDraft=await f.repository.getDraft('probe');
  approvedDraft.motionRows.walk_forward={...approvedDraft.motionRows.walk_forward,status:'approved',review:{decision:'approved',fingerprint,notes:'Current walk reviewed.'}};
  await f.repository.saveDraft('probe',approvedDraft);
  const exhausted=await f.manager.advance('probe',plan.id,{confirmed:true});
  assert.equal(exhausted.status,'blocked');assert.match(exhausted.message,/budget exhausted/);
  assert.equal(exhausted.steps.find(s=>s.row==='walk_forward'&&s.kind==='motion').status,'kept');assert.equal(f.calls.length,1);
  const staleDraft=await f.repository.getDraft('probe');
  staleDraft.motionRows.walk_forward.review.fingerprint='0'.repeat(64);
  await f.repository.saveDraft('probe',staleDraft);
  const stalePlan=await f.manager.create('probe',{budgetUsd:0.5,maxSubmissions:1,estimatedCostUsd:0.5});
  const staleBase=stalePlan.steps.find(s=>s.row==='base'&&s.kind==='reference');
  await f.manager.review('probe',stalePlan.id,{stepId:staleBase.id,expectedFingerprint:staleBase.reviewFingerprint,notes:'Inspected reference scale and edges.',confirmed:true});
  const blocked=await f.manager.advance('probe',stalePlan.id,{confirmed:true});
  assert.equal(blocked.status,'review');assert.equal(blocked.budget.reservedSubmissions,0);assert.equal(f.calls.length,1);
});

test('summons, form drafts, and separate effects remain visible requirements',async t=>{
  const f=await fixture(t);
  await f.repository.saveDraft('probe',{actors:[{id:'hands',idleAnimation:'hands_idle'}],moves:[{id:'needle',animation:'hands_pinch',controlledActor:'hands',phases:[{events:[{event:{projectile:{}}}]}]}],formDrafts:[{id:'ink',characterId:'probe_ink'}]});
  const plan=await f.manager.create('probe',settings);
  assert.ok(plan.steps.some(s=>s.row==='hands_idle'));assert.ok(plan.steps.some(s=>s.row==='hands_pinch'&&s.actorId==='hands'));
  assert.ok(plan.blockers.some(b=>b.includes('projectile/impact')));assert.ok(plan.blockers.some(b=>b.includes('probe_ink')));
});
