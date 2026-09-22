import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createCmsStorage} from '../cms/storage/createCmsStorage.js';
import {CharacterContentRepository} from '../cms/repositories/CharacterContentRepository.js';
import {CharacterBuildJobs} from '../cms/jobs/CharacterBuildJobs.js';
import {GenerationAttemptLedger} from '../cms/pipeline/GenerationAttemptLedger.js';

const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve};};
const tick=()=>new Promise(r=>setTimeout(r,10));
async function until(check){for(let n=0;n<300;n++){const value=await check();if(value)return value;await tick();}throw new Error('Timed out waiting for build');}
async function fixture(t,invoke){
  const root=await mkdtemp(path.join(os.tmpdir(),'tf-build-test-'));
  const repository=new CharacterContentRepository(createCmsStorage({provider:'file',rootDir:root}));
  await repository.saveDraft('probe',{displayName:'Probe',moves:[]});
  const storage=repository.storage;
  const manager=new CharacterBuildJobs({storage,repository,invoke});
  t.after(async()=>{await manager.stop();await rm(root,{recursive:true,force:true});});
  return {manager,storage,repository};
}
const submission=(extras={})=>({idempotencyKey:randomUUID(),tool:'generate_sprite_sheet',input:{characterId:'probe',moveId:'punch',prompt:'A safe fixture row',generator:'image'},...extras});
const result={asset:{key:'characters/probe/assets/source.png',apiUrl:'/api/assets/characters/probe/assets/source.png'},warnings:[]};
const done=async(manager,id)=>until(async()=>{const job=await manager.get('probe',id);return !manager.live.has(id)&&!['queued','running','extracting'].includes(job.status)&&job;});

test('durable admission, concurrent duplicates and server-owned extraction',async t=>{
  const gate=deferred(),calls=[];
  const f=await fixture(t,async(name,input)=>{
    calls.push(name);
    if(name==='generate_sprite_sheet'){
      assert.ok((await f.storage.list('build-jobs/probe')).some(k=>k.endsWith('/request.json')));
      await gate.promise;
      input.context.onGenerationAttempt({status:'succeeded',provider:'fixture',durationMs:15,estimatedCostUsd:0});
      return result;
    }
    return {warnings:['Fixture extraction warning']};
  });
  const request=submission();
  const [a,b,c]=await Promise.all([f.manager.submit('probe',request),f.manager.submit('probe',request),f.manager.submit('probe',{...request,idempotencyKey:randomUUID()})]);
  assert.equal(a.job.id,b.job.id);assert.equal(c.job.id,a.job.id);assert.equal(b.reused,true);
  await assert.rejects(f.manager.submit('probe',{...request,input:{...request.input,prompt:'Changed'}}),{statusCode:409});
  await assert.rejects(f.manager.submit('probe',submission({input:{...request.input,moveId:'kick'}})),{statusCode:409});
  gate.resolve();
  const job=await done(f.manager,a.job.id);
  assert.equal(job.status,'completed');assert.equal(job.result.framesReady,true);
  assert.deepEqual(calls,['generate_sprite_sheet','extract_row_frames']);
  assert.deepEqual(job.result.warnings,['Fixture extraction warning']);
  assert.equal(job.attempts.length,1);assert.ok(job.generationMs>=0);assert.ok(job.extractionMs>=0);
  const restarted=new CharacterBuildJobs({...f,invoke:()=>{throw Error('Must never replay');}});
  assert.equal((await restarted.get('probe',a.job.id)).status,'completed');
  assert.equal((await restarted.submit('probe',request)).reused,true);
});

test('failed durable admission cannot invoke a provider',async t=>{
  let calls=0;const f=await fixture(t,async()=>{calls++;return result;});
  f.storage.lineage.immutable=async()=>{throw Error('Disk full');};
  await assert.rejects(f.manager.submit('probe',submission()),/Disk full/);
  assert.equal(calls,0);
});

test('local reference preflight failure is not reported as an uncertain paid submission',async t=>{
  const f=await fixture(t,async()=>{const error=new Error('Sprite exceeds motion-safe canvas');error.preflight=true;throw error;});
  const {job}=await f.manager.submit('probe',submission());
  const failed=await done(f.manager,job.id);
  assert.equal(failed.status,'failed');
  assert.match(failed.phase,/no provider request/);
  assert.equal(failed.attempts.length,0);
  assert.equal(failed.canResolve,true);
});

test('restarted queued or claimed jobs require explicit resolution, never paid replay',async t=>{
  let calls=0;const f=await fixture(t,async()=>{calls++;return result;});
  f.manager.drain=async()=>{};
  const {job}=await f.manager.submit('probe',submission());
  await f.storage.lineage.immutable(`build-jobs/probe/${job.id}/claim.json`,Buffer.from('{}'));
  await f.manager.stop();
  const restarted=new CharacterBuildJobs({...f,invoke:async()=>{calls++;return result;}});
  await restarted.start();t.after(()=>restarted.stop());
  assert.equal((await restarted.get('probe',job.id)).status,'submission-uncertain');
  await assert.rejects(restarted.submit('probe',submission({input:{characterId:'probe',prompt:'Different'}})),{statusCode:409});
  await assert.rejects(restarted.resolve('probe',job.id,{confirmed:false,note:'Checked fixture worker'}),/Confirm/);
  const resolved=await restarted.resolve('probe',job.id,{confirmed:true,note:'Verified previous fixture worker is stopped; no provider submission.'});
  assert.equal(resolved.status,'resolved');assert.equal(calls,0);
});

test('extraction failure preserves source and blocks a replacement',async t=>{
  let calls=0;const f=await fixture(t,async name=>{calls++;if(name==='extract_row_frames')throw Error('Bad saved source');return result;});
  const {job}=await f.manager.submit('probe',submission());
  const failed=await done(f.manager,job.id);
  assert.equal(failed.status,'needs-recovery');assert.equal(failed.generationResult.asset.key,result.asset.key);
  await assert.rejects(f.manager.submit('probe',submission({input:{characterId:'probe',prompt:'Replacement'}})),{statusCode:409});
  await f.manager.resolve('probe',job.id,{confirmed:true,note:'Source inspected; extraction failed locally. No paid retry.'});
  assert.equal(calls,2);
});

test('queued draft changes block execution before a provider call',async t=>{
  let calls=0;const f=await fixture(t,async()=>{calls++;return result;});
  f.manager.drain=async()=>{};
  const {job}=await f.manager.submit('probe',submission());
  await tick();await f.repository.saveDraft('probe',{description:'Changed during queue'});
  await f.manager.execute(f.manager.pending.shift());
  assert.equal((await f.manager.get('probe',job.id)).status,'blocked');assert.equal(calls,0);
});

test('failed terminal journaling remains visibly unresolved',async t=>{
  const f=await fixture(t,async()=>result);
  const immutable=f.storage.lineage.immutable.bind(f.storage.lineage);
  f.storage.lineage.immutable=async(key,...args)=>{
    if(/events\/00000[2-9]\.json$/.test(key))throw Error('Storage unavailable after generation');
    return immutable(key,...args);
  };
  const {job}=await f.manager.submit('probe',submission());
  await until(()=>!f.manager.running);
  assert.equal((await f.manager.get('probe',job.id)).status,'needs-recovery');
});

test('claims are execute-once even if an executor is accidentally called twice',async t=>{
  let calls=0;const f=await fixture(t,async()=>{calls++;return {...result,framesReady:true};});
  f.manager.drain=async()=>{};
  const {job}=await f.manager.submit('probe',submission());
  const entry=f.manager.pending.shift();await f.manager.execute(entry);await f.manager.execute(entry);
  assert.equal(calls,1);assert.equal((await f.manager.get('probe',job.id)).status,'completed');
});

test('only narrow build inputs are admitted',async t=>{
  const f=await fixture(t,async()=>{throw Error('Unexpected provider');});
  for(const input of [{characterId:'other',prompt:'x'},{characterId:'probe',prompt:'x',context:{apiKey:'no'}},{characterId:'probe',prompt:'x',generator:'unknown'},{characterId:'probe',prompt:''},...['characters/other/assets/ref.png','characters/probe/assets/../private.png','characters/probe/assets/missing.png'].map(key=>({characterId:'probe',prompt:'x',referenceAssetKeys:[key]}))]){
    await assert.rejects(f.manager.submit('probe',submission({input})),{statusCode:400});
  }
  await assert.rejects(f.manager.submit('probe',submission({tool:'publish_character'})),{statusCode:400});
});

test('explicit character-owned references survive build admission and execution',async t=>{
  let captured;
  const f=await fixture(t,async(name,input)=>{captured=input;return {...result,framesReady:true};});
  const key='characters/probe/assets/build-plan-references/plan/actor.png';await f.storage.putBytes(key,Buffer.from('actor'));
  const input={characterId:'probe',prompt:'Flow as this actor',moveId:'hands_idle',generator:'video',referenceAssetKeys:[key]};
  const {job}=await f.manager.submit('probe',submission({input}));await done(f.manager,job.id);
  assert.deepEqual(captured.referenceAssetKeys,[key]);
});
test('changed queued reference blocks before paid execution',async t=>{
  let calls=0;const f=await fixture(t,async()=>{calls++;return result;});f.manager.drain=async()=>{};
  const key='characters/probe/assets/build-plan-references/plan/actor.png';await f.storage.putBytes(key,Buffer.from('actor'));
  const {job}=await f.manager.submit('probe',submission({input:{characterId:'probe',prompt:'Flow',referenceAssetKeys:[key]}}));
  await f.storage.putBytes(key,Buffer.from('different actor'));
  await f.manager.execute(f.manager.pending.shift());
  assert.equal((await f.manager.get('probe',job.id)).status,'blocked');assert.equal(calls,0);
});

test('nested tool mutations are reentrant but unrelated writers stay serialized',async t=>{
  const f=await fixture(t,async()=>result),gate=deferred(),order=[];
  const first=f.repository.withMutation('probe',async()=>{
    order.push('start');await f.repository.withMutation('probe',async()=>order.push('nested'));
    await gate.promise;order.push('end');
  });
  const second=f.repository.withMutation('probe',async()=>order.push('other'));
  await until(()=>order.includes('nested'));assert.deepEqual(order,['start','nested']);
  gate.resolve();await Promise.all([first,second]);assert.deepEqual(order,['start','nested','end','other']);
});

test('saved-source recovery extracts pinned bytes and never generates a replacement',async t=>{
  const calls=[];let fail=true;
  const f=await fixture(t,async name=>{calls.push(name);if(name==='extract_row_frames'&&fail)throw Error('Interrupted extraction');return result;});
  await f.storage.putBytes(result.asset.key,Buffer.from('pinned-source'),{contentType:'image/png'});
  const {job}=await f.manager.submit('probe',submission());
  const stopped=await done(f.manager,job.id);assert.equal(stopped.canResume,true);
  await f.storage.putBytes(result.asset.key,Buffer.from('changed-source'));
  assert.match((await f.manager.resume('probe',job.id,{confirmed:true})).error,/source changed/);
  await f.storage.putBytes(result.asset.key,Buffer.from('pinned-source'));fail=false;
  const recovered=await f.manager.resume('probe',job.id,{confirmed:true});
  assert.equal(recovered.status,'completed');assert.equal(calls.filter(name=>name==='generate_sprite_sheet').length,1);
  assert.equal(calls.filter(name=>name==='extract_row_frames').length,2);
  await assert.rejects(f.manager.resume('probe',job.id,{confirmed:true}),{statusCode:409});
});

test('startup safely replays unclaimed queued work and repairs a stale materialized head',async t=>{
  let calls=0;const f=await fixture(t,async()=>{calls++;return {...result,framesReady:true};});
  f.manager.drain=async()=>{};
  const {job}=await f.manager.submit('probe',submission());
  await f.manager.stop();
  await f.storage.putJson(`build-job-heads/probe/${job.id}.json`,{request:(await f.manager.raw('probe',job.id)).request,state:{status:'failed',revision:-1}});
  const restarted=new CharacterBuildJobs({...f,invoke:async()=>{calls++;return {...result,framesReady:true};}});
  t.after(()=>restarted.stop());await restarted.start();
  assert.equal((await done(restarted,job.id)).status,'completed');assert.equal(calls,1);
});

test('submission response loss becomes uncertain, survives restart and never automatically submits',async t=>{
  let calls=0;
  const f=await fixture(t,async()=>{calls++;throw Error('Connection closed after upload');});
  const {job}=await f.manager.submit('probe',submission());
  assert.equal((await done(f.manager,job.id)).status,'submission-uncertain');
  await f.manager.stop();
  const restarted=new CharacterBuildJobs({...f,invoke:async()=>{calls++;return result;}});t.after(()=>restarted.stop());
  await restarted.start();await tick();
  assert.equal((await restarted.get('probe',job.id)).status,'submission-uncertain');
  await assert.rejects(restarted.submit('probe',submission({input:{characterId:'probe',prompt:'Replacement'}})),{statusCode:409});
  assert.equal(calls,1);
});

test('accepted image task resumes from indexed ledger and extracts without another generate',async t=>{
  let recoveries=0;const calls=[];
  const f=await fixture(t,async()=>{throw Error('unused');});f.manager.drain=async()=>{};
  const {job}=await f.manager.submit('probe',submission());
  const entry=await f.manager.raw('probe',job.id);
  await f.manager.write(entry.request,{...entry.state,status:'submitting'});
  const ledger=new GenerationAttemptLedger(f.storage.lineage),attemptId=randomUUID();
  await ledger.intent({attemptId,characterId:'probe',buildJobId:job.id,provider:'fixture',kind:'image'});
  await ledger.event({attemptId,status:'accepted',providerTaskId:'accepted-once'});
  await f.manager.stop();
  const artifact=await f.storage.lineage.artifact(Buffer.from('recovered-sheet'),{contentType:'image/png'});
  const restarted=new CharacterBuildJobs({...f,invoke:async name=>{calls.push(name);return {warnings:[]};},recoverAttempt:async input=>{assert.equal(input.attemptId,attemptId);recoveries++;return {outputArtifact:artifact};}});
  t.after(()=>restarted.stop());await restarted.start();
  await until(()=>!restarted.running);
  assert.equal((await done(restarted,job.id)).status,'completed');
  assert.equal(recoveries,1);assert.deepEqual(calls,['extract_row_frames']);
});

test('host ownership excludes a second worker and drain blocks admission',async t=>{
  const f=await fixture(t,async()=>({...result,framesReady:true}));await f.manager.start();
  const other=new CharacterBuildJobs({...f,invoke:async()=>result});
  await assert.rejects(other.start(),/Another build worker/);
  await f.manager.stop();await other.start();await other.stop();
  await assert.rejects(f.manager.submit('probe',submission()),{statusCode:503});
});

test('job stream replays revisions once and disconnect removes subscriptions',async t=>{
  const f=await fixture(t,async()=>result);f.manager.drain=async()=>{};
  const {job}=await f.manager.submit('probe',submission());let entry=await f.manager.raw('probe',job.id);
  entry.state=await f.manager.write(entry.request,{...entry.state,status:'submitting'});
  const received=[];
  const dispose=await f.manager.stream('probe',job.id,{after:0,onJob:({job})=>received.push(job.revision)});
  entry.state=await f.manager.write(entry.request,{...entry.state,status:'submission-uncertain'});
  assert.deepEqual(received,[1,2]);dispose();assert.equal(f.manager.events.listenerCount(job.id),0);
  await f.manager.write(entry.request,{...entry.state,status:'resolved'});assert.deepEqual(received,[1,2]);
  const replay=[];const off=await f.manager.stream('probe',job.id,{after:2,onJob:({job})=>replay.push(job.status)});
  assert.deepEqual(replay,['resolved']);off();
});

test('normal list and get read heads without global attempt or journal scans',async t=>{
  const f=await fixture(t,async()=>({...result,framesReady:true}));
  const {job}=await f.manager.submit('probe',submission());await done(f.manager,job.id);
  const listed=[],list=f.storage.list.bind(f.storage);f.storage.list=async prefix=>{listed.push(prefix);return list(prefix);};
  assert.equal((await f.manager.list('probe')).length,1);assert.equal((await f.manager.get('probe',job.id)).status,'completed');
  assert.deepEqual(listed,['build-job-heads/probe']);
});

test('preparing stage can restart with its original claim before any provider submission',async t=>{
  const f=await fixture(t,async()=>result);f.manager.drain=async()=>{};
  const {job}=await f.manager.submit('probe',submission()),entry=await f.manager.raw('probe',job.id);
  await f.storage.lineage.immutable(`build-jobs/probe/${job.id}/claim.json`,Buffer.from('{}'));
  await f.manager.write(entry.request,{...entry.state,status:'preparing'});await f.manager.stop();
  let calls=0;const restarted=new CharacterBuildJobs({...f,invoke:async()=>{calls++;return {...result,framesReady:true};}});t.after(()=>restarted.stop());
  await restarted.start();await until(()=>!restarted.running);
  assert.equal((await restarted.get('probe',job.id)).status,'completed');assert.equal(calls,1);
});

test('operator may attach a checked task only to its own unresolved attempt',async t=>{
  const f=await fixture(t,async()=>{throw Error('lost response');});
  const {job}=await f.manager.submit('probe',submission());await done(f.manager,job.id);
  const ledger=new GenerationAttemptLedger(f.storage.lineage),attemptId=randomUUID();
  await ledger.intent({attemptId,characterId:'probe',buildJobId:job.id,provider:'fixture',kind:'image'});
  await assert.rejects(f.manager.attachTask('probe',job.id,{attemptId,providerTaskId:'checked-id'}),/Confirm/);
  const attached=await f.manager.attachTask('probe',job.id,{confirmed:true,attemptId,providerTaskId:'checked-id'});
  assert.equal(attached.status,'needs-recovery');assert.equal(attached.canResume,true);
  await assert.rejects(f.manager.attachTask('probe',job.id,{confirmed:true,attemptId,providerTaskId:'different-id'}),/different accepted/);
});

test('ledger acceptance persists provider-active before polling and streams that stage',async t=>{
  const phases=[];
  const f=await fixture(t,async(name,input)=>{
    const ledger=new GenerationAttemptLedger(f.storage.lineage),attemptId=randomUUID();
    await ledger.intent({attemptId,characterId:'probe',buildJobId:input.context.buildJobId,provider:'fixture'});
    await ledger.event({attemptId,status:'accepted',providerTaskId:'paid-once'});
    const persisted=await f.manager.raw('probe',input.context.buildJobId);
    assert.equal(persisted.state.status,'provider-active');assert.equal(persisted.state.providerTaskId,'paid-once');
    return {...result,framesReady:true};
  });
  f.manager.drain=async()=>{};const {job}=await f.manager.submit('probe',submission());
  const off=await f.manager.stream('probe',job.id,{onJob:({job})=>phases.push(job.status)});
  await f.manager.execute(f.manager.pending.shift());off();
  assert.ok(phases.includes('provider-active'));assert.equal(phases.at(-1),'completed');
});

test('archived characters never execute queued work on startup',async t=>{
  let calls=0;const f=await fixture(t,async()=>{calls++;return result;});f.manager.drain=async()=>{};
  const {job}=await f.manager.submit('probe',submission());
  await f.repository.saveDraft('probe',{...await f.repository.getDraft('probe'),workbench:{archived:true}});await f.manager.stop();
  const restarted=new CharacterBuildJobs({...f,invoke:async()=>{calls++;return result;}});t.after(()=>restarted.stop());await restarted.start();
  assert.equal((await restarted.get('probe',job.id)).status,'blocked');assert.equal(calls,0);
});
