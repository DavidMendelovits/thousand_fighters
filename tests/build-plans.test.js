import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createCmsStorage} from '../cms/storage/createCmsStorage.js';
import {CharacterContentRepository} from '../cms/repositories/CharacterContentRepository.js';
import {CharacterBuildPlans} from '../cms/plans/CharacterBuildPlans.js';
import {digest} from '../cms/storage/LineageStore.js';

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

test('summons, form drafts, and separate effects remain visible requirements',async t=>{
  const f=await fixture(t);
  await f.repository.saveDraft('probe',{actors:[{id:'hands',idleAnimation:'hands_idle'}],moves:[{id:'needle',animation:'hands_pinch',controlledActor:'hands',phases:[{events:[{event:{projectile:{}}}]}]}],formDrafts:[{id:'ink',characterId:'probe_ink'}]});
  const plan=await f.manager.create('probe',settings);
  assert.ok(plan.steps.some(s=>s.row==='hands_idle'));assert.ok(plan.steps.some(s=>s.row==='hands_pinch'&&s.actorId==='hands'));
  assert.ok(plan.blockers.some(b=>b.includes('projectile/impact')));assert.ok(plan.blockers.some(b=>b.includes('probe_ink')));
});
