import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createCmsStorage} from '../cms/storage/createCmsStorage.js';
import {CharacterContentRepository} from '../cms/repositories/CharacterContentRepository.js';
import {BenchmarkService,deduplicateAttempts,summarizeAttempts} from '../cms/benchmarks/BenchmarkService.js';
import {loadReviewContext,motionFingerprint} from '../cms/pipeline/reviewFingerprint.js';

async function fixture(t) {
  const root=await mkdtemp(path.join(os.tmpdir(),'tf-benchmarks-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const storage=createCmsStorage({provider:'file',rootDir:root}),repository=new CharacterContentRepository(storage);
  return {root,storage,repository,service:new BenchmarkService({storage,repository})};
}
const attempt=(id,extras={})=>({attemptId:id,status:'succeeded',provider:'test',model:'model-a',kind:'video',startedAt:'2026-09-20T00:00:00.000Z',completedAt:'2026-09-20T00:00:01.000Z',durationMs:1000,estimatedCostUsd:null,...extras});

test('deduplicates observations and canonical recovery state wins over late legacy success',()=>{
  const result=deduplicateAttempts([
    attempt('a',{estimatedCostUsd:.2}),
    attempt('a',{_canonical:true,status:'needs-recovery',at:'2026-09-20T00:00:02.000Z',completedAt:undefined}),
    attempt('a',{completedAt:'2026-09-20T00:00:03.000Z',estimatedCostUsd:.2}),
  ]);
  assert.equal(result.length,1);assert.equal(result[0].status,'needs-recovery');assert.equal(result[0].observations,3);
  assert.equal(result[0].estimatedCostUsd,.2);assert.equal(result[0].measurementKind,'unclassified');
});

test('null prices remain unknown and percentiles exclude missing/inflight values',()=>{
  const result=summarizeAttempts(deduplicateAttempts([
    attempt('a',{durationMs:100,estimatedCostUsd:0,attemptNumber:1,stageTimings:{downloadMs:20}}),
    attempt('b',{durationMs:300,estimatedCostUsd:2,attemptNumber:2,stageTimings:{downloadMs:40}}),
    attempt('c',{status:'failed',durationMs:200,estimatedCostUsd:null}),
    attempt('d',{status:'accepted',durationMs:900,estimatedCostUsd:null}),
  ]));
  assert.deepEqual(result.duration,{samples:3,p50Ms:200,p95Ms:300});
  assert.deepEqual(result.stages.downloadMs,{samples:2,p50Ms:20,p95Ms:40});
  assert.equal(result.cost.unknownAttempts,2);assert.equal(result.cost.knownSubtotalUsd,2);assert.equal(result.cost.complete,false);
  assert.equal(result.failed,1);assert.equal(result.unresolved,1);assert.equal(result.retries,1);
});

test('recovery uses observed chronology and preserves measured timing when resume has none',()=>{
  const [result]=deduplicateAttempts([
    attempt('a',{_canonical:true,status:'needs-recovery',observedAt:'2026-09-20T00:00:02.000Z',durationMs:600,estimatedCostUsd:.2,stageTimings:{downloadMs:50}}),
    attempt('a',{_canonical:true,status:'succeeded',observedAt:'2026-09-20T00:00:03.000Z',durationMs:null,estimatedCostUsd:null,stageTimings:null}),
  ]);
  assert.equal(result.status,'succeeded');assert.equal(result.durationMs,600);assert.equal(result.estimatedCostUsd,.2);assert.equal(result.stageTimings.downloadMs,50);
});

test('report merges both stores, separates fixtures, filters cohorts and joins job timings',async t=>{
  const {storage,service}=await fixture(t);
  await storage.putJson('benchmarks/generation-attempts/2026-09-20/a.json',attempt('a',{measurementKind:'provider',buildJobId:'job-a'}));
  await storage.putJson('generation-attempts/a/intent.json',attempt('a',{measurementKind:'provider',status:'intent',buildJobId:'job-a',durationMs:undefined,completedAt:undefined}));
  await storage.putJson('generation-attempts/a/events/001.json',attempt('a',{measurementKind:'provider',estimatedCostUsd:.1}));
  await storage.putJson('benchmarks/generation-attempts/2026-09-20/b.json',attempt('b',{measurementKind:'fixture',durationMs:1}));
  await storage.putJson('build-jobs/probe/job-a/request.json',{id:'job-a',characterId:'probe'});
  await storage.putJson('build-jobs/probe/job-a/events/000001.json',{status:'completed',extractionMs:40,executionMs:1100});
  const all=await service.report();
  assert.equal(all.summary.attempts,2);assert.equal(all.groups.length,2);assert.equal(all.summary.cost.knownSubtotalUsd,.1);
  const provider=await service.report({measurementKind:'provider'});
  assert.equal(provider.summary.attempts,1);assert.equal(provider.jobs.matched,1);assert.equal(provider.jobs.extraction.p50Ms,40);
  assert.equal((await service.report({model:'missing'})).summary.attempts,0);
});

test('historical malformed observations surface incomplete warning without hiding intact attempts',async t=>{
  const {storage,service}=await fixture(t);
  await storage.putJson('benchmarks/generation-attempts/2026-09-20/a.json',attempt('a'));
  await storage.putBytes('benchmarks/generation-attempts/2026-09-20/broken.json',Buffer.from('{'));
  const report=await service.report();assert.equal(report.summary.attempts,1);assert.equal(report.warnings.length,1);
});

test('accepted source cost never pretends to include failed or discarded attempts',async t=>{
  const {storage,repository,service}=await fixture(t);
  const root='characters/probe/assets/fighter-pack';
  await repository.saveDraft('probe',{displayName:'Probe',moves:[],motionRows:{walk:{sourceSha256:'source-hash',status:'approved',uniqueFrames:8}}});
  await storage.putJson(`${root}/frameData.json`,{frames:{walk:[{file:'frames/walk.png'}],base:[]}});
  await storage.putBytes(`${root}/sheets/walk.png`,Buffer.from('sheet'));await storage.putBytes(`${root}/frames/walk.png`,Buffer.from('frame'));
  const context=await loadReviewContext(repository,'probe'),{fingerprint}=await motionFingerprint(context,'walk');
  const draft=await repository.getDraft('probe');draft.motionRows.walk.review={decision:'approved',fingerprint};await repository.saveDraft('probe',draft);
  await storage.putJson('benchmarks/generation-attempts/day/winner.json',attempt('winner',{characterId:'probe',moveId:'walk',sourceSha256:'source-hash',estimatedCostUsd:1}));
  await storage.putJson('benchmarks/generation-attempts/day/failure.json',attempt('failure',{characterId:'probe',moveId:'walk',status:'failed',estimatedCostUsd:5}));
  const report=await service.report();assert.equal(report.summary.cost.knownSubtotalUsd,6);
  assert.equal(report.reviews.acceptedRows,1);assert.equal(report.reviews.meanAcceptedOutputAttemptCostUsd,1);
  assert.equal(report.reviews.costPerAcceptedRowUsd,null);assert.equal(report.reviews.costPerAcceptedCharacterUsd,null);
  assert.equal(report.cohort.recordedEstimatePerCurrentAcceptedRowUsd,6);
  assert.equal(report.inventory.length,2);assert.equal(report.inventory.find(row=>row.attemptId==='failure').estimatedCostUsd,5);
  await storage.putJson('benchmarks/generation-attempts/day/unknown.json',attempt('unknown',{characterId:'probe',moveId:'walk',status:'failed',estimatedCostUsd:null}));
  assert.equal((await service.report()).cohort.recordedEstimatePerCurrentAcceptedRowUsd,null);
  await storage.putBytes(`${root}/frames/walk.png`,Buffer.from('changed'));
  assert.equal((await service.report()).reviews.acceptedRows,0);
});

const trialInput={name:'Paint trial',characterId:'probe',budgetUsd:2,referenceKeys:['characters/probe/assets/source/concept.png'],candidates:[{provider:'a',model:'m1'},{provider:'b',model:'m2'}],actions:[{moveId:'walk',prompt:'Flow forward like liquid paint, fixed camera'}],settings:{resolution:'768p',durationSeconds:6,artStyle:'paint'}};
test('trials archive reference bytes immutably and survive service restart without provider execution',async t=>{
  const {storage,service}=await fixture(t);
  await storage.putBytes(trialInput.referenceKeys[0],Buffer.from('reference one'));
  const saved=await service.createTrial(trialInput);
  await storage.putBytes(trialInput.referenceKeys[0],Buffer.from('replacement'));
  assert.equal((await storage.lineage.readArtifact(saved.references[0])).toString(),'reference one');
  const restarted=new BenchmarkService({storage});
  assert.deepEqual(await restarted.getTrial(saved.id),saved);assert.equal((await restarted.listTrials()).length,1);
  assert.equal(saved.status,'saved-not-submitted');assert.match(saved.executionBlockedReason,/not supported/);
  assert.equal((await storage.list('generation-attempts')).length,0);
  await assert.rejects(storage.putImmutable(`benchmarks/trials/${saved.id}.json`,Buffer.from('{}')),/EEXIST/);
});

test('trial validation rejects invalid comparisons and budgets',async t=>{
  const {storage,service}=await fixture(t);await storage.putBytes(trialInput.referenceKeys[0],Buffer.from('reference'));
  for(const input of [
    {...trialInput,budgetUsd:0}, {...trialInput,budgetUsd:null}, {...trialInput,candidates:[trialInput.candidates[0],trialInput.candidates[0]]},
    {...trialInput,referenceKeys:['characters/other/assets/concept.png']}, {...trialInput,settings:{}},
    {...trialInput,actions:[trialInput.actions[0],trialInput.actions[0]]}, {...trialInput,settings:{...trialInput.settings,durationSeconds:-1}},
  ]) await assert.rejects(service.createTrial(input));
  assert.equal((await service.listTrials()).length,0);
});

const executableTrial={...trialInput,candidates:[{provider:'fal',model:'fal-ai/kling-video/v3/standard/image-to-video'},{provider:'pruna',model:'p-video-2-pro'}],settings:{...trialInput.settings,resolution:'provider-native'}};
async function waitRun(service,id){for(let n=0;n<200;n++){const trial=await service.getTrial(id);if(trial.runs.length&&trial.runs.every(run=>run.status!=='running'))return trial;await new Promise(resolve=>setTimeout(resolve,5));}throw new Error('Trial did not settle');}
test('one asynchronous trial slot pins bytes and model, deduplicates, reserves budget and never alters character assets',async t=>{
  const {root,storage}=await fixture(t);await storage.putBytes(trialInput.referenceKeys[0],Buffer.from('pinned bytes'),{contentType:'image/png'});
  let release;const gate=new Promise(resolve=>{release=resolve;});let calls=0;
  const service=new BenchmarkService({storage,trialRootDir:path.join(root,'transport'),trialTransport:async(options,context)=>{
    calls++;assert.equal((await readFile(options.image)).toString(),'pinned bytes');assert.equal(options.duration,6);
    assert.match(options.prompt,/Exact|Flow forward/);await gate;
    return {model:executableTrial.candidates[0].model,archivedOutput:await context.storage.lineage.artifact(Buffer.from('video'),{contentType:'video/mp4'}),generationAttempt:{attemptId:'fixture-attempt'}};
  }});
  const trial=await service.createTrial(executableTrial);
  await storage.putBytes(trialInput.referenceKeys[0],Buffer.from('new current bytes'));
  const input={candidateIndex:0,actionIndex:0,confirmed:true,acceptUnknownCost:true};
  const [first,duplicate]=await Promise.all([service.runTrial(trial.id,input),service.runTrial(trial.id,input)]);
  assert.equal(first.run.id,duplicate.run.id);assert.equal(first.run.reservationUsd,1);
  await assert.rejects(service.runTrial(trial.id,{...input,candidateIndex:1}),/already running/);
  assert.equal((await service.getTrial(trial.id)).runs.length,1);
  release();const completed=await waitRun(service,trial.id);
  assert.equal(calls,1);assert.equal(completed.runs[0].status,'completed');
  assert.equal((await storage.getBytes(trialInput.referenceKeys[0])).toString(),'new current bytes');
  assert.equal((await service.runTrial(trial.id,input)).reused,true);assert.equal(calls,1);
});

test('trial interruption requires explicit resume and never consumes a new slot reservation',async t=>{
  const {root,storage}=await fixture(t);await storage.putBytes(trialInput.referenceKeys[0],Buffer.from('reference'),{contentType:'image/png'});
  const initial=new BenchmarkService({storage,trialRootDir:path.join(root,'transport'),trialTransport:async()=>{throw new Error('Connection lost after provider accepted');}});
  const trial=await initial.createTrial(executableTrial),input={candidateIndex:0,actionIndex:0,confirmed:true,acceptUnknownCost:true};
  await initial.runTrial(trial.id,input);await waitRun(initial,trial.id);
  let resumes=0;
  const restarted=new BenchmarkService({storage,trialTransport:async(options,context)=>{
    assert.ok(options.resume);assert.equal(options.image,undefined);resumes++;
    return {model:executableTrial.candidates[0].model,archivedOutput:await context.storage.lineage.artifact(Buffer.from('saved output'),{contentType:'video/mp4'})};
  }});
  assert.equal((await restarted.runTrial(trial.id,input)).reused,true);assert.equal(resumes,0);
  await assert.rejects(restarted.resumeTrial(trial.id,{...input,confirmed:false}),/Confirm/);
  await restarted.resumeTrial(trial.id,input);const result=await waitRun(restarted,trial.id);
  assert.equal(resumes,1);assert.equal(result.runs.length,1);assert.equal(result.runs[0].reservationUsd,1);
});

test('trial rejects non-enforceable settings and missing payment acknowledgment before transport',async t=>{
  const {storage}=await fixture(t);await storage.putBytes(trialInput.referenceKeys[0],Buffer.from('reference'),{contentType:'image/png'});
  let calls=0;const service=new BenchmarkService({storage,trialTransport:async()=>{calls++;}});
  const unsupported=await service.createTrial({...executableTrial,settings:{...executableTrial.settings,resolution:'768p'}});
  await assert.rejects(service.runTrial(unsupported.id,{candidateIndex:0,actionIndex:0,confirmed:true,acceptUnknownCost:true}),/resolution control/);
  const supported=await service.createTrial(executableTrial);
  await assert.rejects(service.runTrial(supported.id,{candidateIndex:0,actionIndex:0,confirmed:true}),/price is unknown/);
  assert.equal(calls,0);assert.equal((await storage.list('benchmarks/trial-runs')).length,0);
});
