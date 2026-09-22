import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createCmsStorage} from '../cms/storage/createCmsStorage.js';
import {runGenerationAttempt} from '../cms/pipeline/generationAttemptTelemetry.js';
import {GenerationAttemptLedger} from '../cms/pipeline/GenerationAttemptLedger.js';
import {recoverGenerationAttempt} from '../cms/pipeline/recoverGenerationAttempt.js';
import {runVideoJob} from '../scripts/generate_animation_video.mjs';
import {restoreBuildVideoCheckpoint} from '../cms/pipeline/restoreBuildVideoCheckpoint.js';

async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'tf-ledger-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const storage=createCmsStorage({provider:'file',rootDir:path.join(root,'storage')});
  const observations=[];const recorder=async event=>observations.push(event);recorder.lineage=storage.lineage;
  return {root,storage,observations,request:{context:{characterId:'probe',buildJobId:'fixture-job',measurementKind:'fixture'},onGenerationAttempt:recorder}};
}
test('intent exists before external operation; accepted IDs and output are independently durable',async t=>{
  const f=await fixture(t);let calls=0;
  const result=await runGenerationAttempt(f.request,{provider:'bfl-klein',model:'test'},async()=>{
    calls++;assert.equal((await f.storage.list('generation-attempts')).filter(k=>k.endsWith('intent.json')).length,1);
    await f.request.generationCheckpoint({status:'accepted',providerTaskId:'paid-once'});
    return {bytes:Buffer.from('image'),contentType:'image/png',taskId:'paid-once'};
  });
  const {intent,events}=await new GenerationAttemptLedger(f.storage.lineage).read(result.generationAttemptId);
  assert.equal(intent.buildJobId,'fixture-job');assert.equal(intent.measurementKind,'fixture');
  assert.equal(events.filter(e=>e.status==='accepted').length,1);
  assert.equal(events.filter(e=>e.status==='succeeded').length,1);
  const recovered=await recoverGenerationAttempt({storage:f.storage,characterId:'probe',attemptId:intent.attemptId,confirmed:true});
  assert.equal(recovered.reused,true);assert.equal(calls,1);
  await assert.rejects(recoverGenerationAttempt({storage:f.storage,characterId:'probe',attemptId:intent.attemptId,confirmed:true,isBuildActive:id=>id==='fixture-job'}),{statusCode:409});
});
test('intent persistence failure prevents submission entirely',async t=>{
  const f=await fixture(t);let calls=0;
  const immutable=f.storage.lineage.immutable.bind(f.storage.lineage);
  f.storage.lineage.immutable=(key,...args)=>key.endsWith('/intent.json')?Promise.reject(Error('Disk full')):immutable(key,...args);
  await assert.rejects(runGenerationAttempt(f.request,{provider:'test'},async()=>{calls++;}),/Disk full/);
  assert.equal(calls,0);
});
test('lost submit response remains uncertain and cannot be automatically resubmitted',async t=>{
  const f=await fixture(t);let id;
  await assert.rejects(runGenerationAttempt(f.request,{provider:'bfl-klein'},async()=>{throw Error('Disconnected');}),error=>{id=error.attemptId;return error.noRetry===true;});
  await assert.rejects(recoverGenerationAttempt({storage:f.storage,characterId:'probe',attemptId:id,confirmed:true}),/uncertain/);
});
test('accepted-task persistence failure stops polling and disables retries',async t=>{
  const f=await fixture(t);let posts=0,polls=0;
  const immutable=f.storage.lineage.immutable.bind(f.storage.lineage);
  f.storage.lineage.immutable=(key,...args)=>key.startsWith('generation-attempts/')&&key.includes('/events/')?Promise.reject(Error('Ledger unavailable')):immutable(key,...args);
  await assert.rejects(runGenerationAttempt(f.request,{provider:'bfl-klein'},async()=>{posts++;await f.request.generationCheckpoint({status:'accepted',providerTaskId:'accepted-before-disk-error'});polls++;}),error=>error.noRetry===true);
  assert.equal(posts,1);assert.equal(polls,0);
  assert.equal((await f.storage.list('generation-attempts')).filter(key=>key.endsWith('/intent.json')).length,1);
});
test('after acceptance interruption recovery polls/downloads without another submission',async t=>{
  const f=await fixture(t);let posts=0,id,polls=0;
  await assert.rejects(runGenerationAttempt(f.request,{provider:'bfl-klein',model:'test'},async()=>{
    posts++;await f.request.generationCheckpoint({status:'accepted',providerTaskId:'paid-id'});throw Error('Worker interrupted');
  }),error=>{id=error.attemptId;return error.taskId==='paid-id';});
  const adapter={baseUrl:'https://api.bfl.ai',waitForResult:async url=>{polls++;assert.match(url,/paid-id/);return {result:{sample:'https://example.com/image'}};},fetch:async()=>new Response(Buffer.from('recovered'),{headers:{'content-type':'image/png'}})};
  const recovered=await recoverGenerationAttempt({storage:f.storage,characterId:'probe',attemptId:id,confirmed:true,adapters:{bfl:adapter}});
  assert.equal(posts,1);assert.equal(polls,1);assert.equal(recovered.reviewRequired,true);
  assert.equal((await f.storage.lineage.readArtifact(recovered.outputArtifact)).toString(),'recovered');
});
test('video interruption resumes persisted provider task with one paid submission',async t=>{
  const f=await fixture(t);let posts=0,polls=0;
  const adapter={provider:'fixture',submit:async()=>{posts++;return {requestId:'video-paid'};},poll:async(task,{onStatus})=>{assert.equal(task.requestId,'video-paid');if(polls++===0)throw Error('Interrupted');await onStatus('COMPLETED');},result:async()=>({url:'https://example.com/clip'}),download:async()=>Buffer.from('0000ftypisom00000000000000000000')};
  const options={provider:'pruna',mode:'image-to-video',image:'https://example.com/ref.png',prompt:'Flow',duration:5,output:path.join(f.root,'video')};
  const dependencies={adapter,storage:f.storage,characterId:'probe',buildJobId:'fixture-job',log:()=>{}};
  await assert.rejects(runVideoJob(options,dependencies),/Interrupted/);
  await rm(options.output,{recursive:true});
  const restored=await restoreBuildVideoCheckpoint({storage:f.storage,characterId:'probe',buildJobId:'fixture-job',referenceBytes:Buffer.from('reference'),rootDir:path.join(f.root,'restored')});
  const job=await runVideoJob({resume:restored},dependencies);
  assert.equal(job.transportStatus,'downloaded');assert.equal(posts,1);assert.equal(polls,2);
  const {intent,events}=await new GenerationAttemptLedger(f.storage.lineage).read(job.generationAttempt.attemptId);
  assert.equal(intent.buildJobId,'fixture-job');assert.equal(events.some(e=>e.providerTaskId==='video-paid'),true);
});

test('MiniMax recovery composes its accepted video into the original sprite profile without submission',async t=>{
  const f=await fixture(t);let id,compositions=0;
  f.request.task='fighter-2x3-grid';
  await assert.rejects(runGenerationAttempt(f.request,{provider:'minimax-h3',kind:'video',model:'fixture'},async()=>{
    await f.request.generationCheckpoint({status:'accepted',providerTaskId:'known-task'});throw Error('stopped');
  }),error=>{id=error.attemptId;return true;});
  const adapter={waitForTask:async taskId=>{assert.equal(taskId,'known-task');return {content:{url:'https://fixture.invalid/video'},duration:5};},fetch:async()=>new Response('video'),composeSpriteSheet:async({videoBytes,task})=>{compositions++;assert.equal(task,'fighter-2x3-grid');assert.equal(videoBytes.toString(),'video');return Buffer.from('sheet');}};
  const recovered=await recoverGenerationAttempt({storage:f.storage,characterId:'probe',attemptId:id,confirmed:true,adapters:{minimax:adapter}});
  assert.equal(compositions,1);assert.equal(recovered.outputArtifact.contentType,'image/png');assert.equal((await f.storage.lineage.readArtifact(recovered.outputArtifact)).toString(),'sheet');
});
