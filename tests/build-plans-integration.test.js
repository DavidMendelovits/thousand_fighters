import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFixture} from './helpers/buildFixture.js';
import {loadReviewContext,motionFingerprint} from '../cms/pipeline/reviewFingerprint.js';
import {digest} from '../cms/storage/LineageStore.js';

test('real pipeline: durable plan reaches identity, base checkpoint, and representative motion without stale self-edits',async t=>{
  const fixture=await buildFixture({delayMs:1});t.after(()=>fixture.close());
  const {characterId:id,runtime}=fixture,base=`${fixture.url}/api/characters/${id}`;
  async function api(path,body){const response=await fetch(`${base}${path}`,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:undefined);const value=await response.json();assert.ok(response.ok,`${response.status}: ${JSON.stringify(value)}`);return value;}
  async function done(jobId){for(let n=0;n<300;n++){const {job}=await api(`/build-jobs/${jobId}`);if(!['queued','running','extracting'].includes(job.status)){assert.equal(job.status,'completed',JSON.stringify(job));return job;}await new Promise(r=>setTimeout(r,20));}throw Error('Timed out');}
  let {plan}=await api('/build-plans',{budgetUsd:1,maxSubmissions:3,estimatedCostUsd:0,generator:'image'});
  assert.equal(fixture.calls,0);
  ({plan}=await api(`/build-plans/${plan.id}/advance`,{confirmed:true}));
  await done(plan.steps.find(s=>s.status==='submitted').jobId);
  ({plan}=await api(`/build-plans/${plan.id}/advance`,{confirmed:true}));assert.equal(plan.status,'review');assert.equal(fixture.calls,1);
  const context=await loadReviewContext(runtime.repository,id);
  await runtime.repository.saveDraft(id,{...context.draft,referenceReview:{sha256:context.conceptHash,status:'approved'}});
  ({plan}=await api(`/build-plans/${plan.id}/advance`,{confirmed:true}));
  const baseStep=plan.steps.find(s=>s.status==='submitted');assert.equal(baseStep.row,'base');await done(baseStep.jobId);
  ({plan}=await api(`/build-plans/${plan.id}/advance`,{confirmed:true}));assert.equal(plan.status,'review');assert.equal(fixture.calls,2);
  const reviewedBase=plan.steps.find(s=>s.row==='base');assert.ok(reviewedBase.reviewAssets.length);
  await api(`/build-plans/${plan.id}/review`,{stepId:reviewedBase.id,expectedFingerprint:reviewedBase.reviewFingerprint,notes:'Controlled fixture base inspected; all frames fit.',confirmed:true});
  ({plan}=await api(`/build-plans/${plan.id}/advance`,{confirmed:true}));
  const motion=plan.steps.find(s=>s.status==='submitted');assert.equal(motion.row,'walk_forward');await done(motion.jobId);
  ({plan}=await api(`/build-plans/${plan.id}/advance`,{confirmed:true}));assert.equal(plan.status,'review');assert.equal(fixture.calls,3);assert.equal(plan.budget.reservedSubmissions,3);
});

test('actor reference uses real extraction, freezes identity, then submits a separate idle motion with that reference',async t=>{
  const fixture=await buildFixture({delayMs:1});t.after(()=>fixture.close());
  const {runtime,characterId:id}=fixture,storage=runtime.storage,repository=runtime.repository;
  await repository.saveDraft(id,{...await repository.getDraft(id),actors:[{id:'hands',idleAnimation:'hands_idle'}]});
  const endpoint=`${fixture.url}/api/characters/${id}`;
  async function api(path,body){const response=await fetch(`${endpoint}${path}`,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:undefined);const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data;}
  async function done(jobId){for(let i=0;i<300;i++){const {job}=await api(`/build-jobs/${jobId}`);if(!['queued','running','extracting'].includes(job.status)){assert.equal(job.status,'completed',JSON.stringify(job));return;}await new Promise(r=>setTimeout(r,20));}throw Error('timeout');}
  let {plan}=await api('/build-plans',{budgetUsd:5,maxSubmissions:8,estimatedCostUsd:0,generator:'video'});
  const advance=async()=>{({plan}=await api(`/build-plans/${plan.id}/advance`,{confirmed:true}));return plan.steps.find(s=>s.status==='submitted');};
  const approve=async step=>{({plan}=await api(`/build-plans/${plan.id}/review`,{stepId:step.id,expectedFingerprint:step.reviewFingerprint,notes:'Fixture identity silhouette inspected before animation.',confirmed:true}));};
  await done((await advance()).jobId);await advance();
  const identity=await loadReviewContext(repository,id);await repository.saveDraft(id,{...identity.draft,referenceReview:{sha256:identity.conceptHash,status:'approved'}});
  await done((await advance()).jobId);await advance();await approve(plan.steps.find(s=>s.row==='base'));
  const actor=await advance();assert.equal(actor.row,'hands_idle');assert.equal(actor.kind,'reference');await done(actor.jobId);await advance();
  const reference=plan.steps.find(s=>s.row==='hands_idle'&&s.kind==='reference');assert.equal(reference.reviewAssets.length,6);
  await approve(reference);
  const frozen=plan.steps.find(s=>s.id===reference.id).frozenReferences;assert.equal(frozen.length,6);
  const frozenBytes=await storage.getBytes(frozen[0].key);
  // Offline stand-in at the video-tool boundary: no provider keys or network.
  // Actual image extraction above supplies the six identity frames. Synthetic
  // motion below verifies pipeline state/identity separation, not video quality.
  const original=runtime.tools.invoke.bind(runtime.tools);let videoCalls=0;
  runtime.tools.invoke=async(name,input)=>{
    if(name!=='generate_sprite_sheet'||input.generator!=='video')return original(name,input);
    videoCalls++;assert.equal(input.moveId,'hands_idle');assert.deepEqual(input.referenceAssetKeys,[frozen[0].key]);
    assert.deepEqual(await storage.getBytes(input.referenceAssetKeys[0]),frozenBytes);
    const context=await loadReviewContext(repository,id),frames=[];
    for(let n=0;n<8;n++){const file=`sprites/hands_idle/fixture_motion_${n}.png`;await storage.putBytes(`${context.root}/${file}`,Buffer.concat([frozenBytes,Buffer.from(`fixture-${n}`)]));frames.push({file});}
    await storage.putJson(`${context.root}/frameData.json`,{...context.frameData,frames:{...context.frameData.frames,hands_idle:frames}});
    await repository.saveDraft(id,{...context.draft,motionRows:{...context.draft.motionRows,hands_idle:{uniqueFrames:8,clippedFrames:[],status:'needs-visual-review'}}});
    return {framesReady:true,asset:{key:`${context.root}/sheets/hands_idle.png`}};
  };
  const idle=await advance();assert.equal(idle.kind,'motion');await done(idle.jobId);await advance();assert.equal(videoCalls,1);
  assert.equal(plan.steps.find(s=>s.id===reference.id).status,'kept');assert.equal(plan.steps.find(s=>s.id===idle.id).status,'review');
  assert.equal(digest(await storage.getBytes(frozen[0].key)),frozen[0].sha256);
  const current=await loadReviewContext(repository,id),fingerprint=await motionFingerprint(current,'hands_idle');
  await repository.saveDraft(id,{...current.draft,motionRows:{...current.draft.motionRows,hands_idle:{...current.draft.motionRows.hands_idle,status:'approved',review:{fingerprint:fingerprint.fingerprint}}}});
  // Corruption of a frozen identity fails closed before buying the next row.
  await storage.putBytes(frozen[0].key,Buffer.from('changed'));
  const response=await fetch(`${endpoint}/build-plans/${plan.id}/advance`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({confirmed:true})});
  assert.equal(response.status,409);assert.match((await response.json()).error,/Frozen actor reference/);assert.equal(videoCalls,1);
});
