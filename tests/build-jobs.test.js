import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createCmsStorage} from '../cms/storage/createCmsStorage.js';
import {CharacterContentRepository} from '../cms/repositories/CharacterContentRepository.js';
import {CharacterBuildJobs} from '../cms/jobs/CharacterBuildJobs.js';

const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve};};
const tick=()=>new Promise(r=>setTimeout(r,10));
async function until(check){for(let n=0;n<300;n++){const value=await check();if(value)return value;await tick();}throw new Error('Timed out waiting for build');}
async function fixture(t,invoke){
  const root=await mkdtemp(path.join(os.tmpdir(),'tf-build-test-'));
  const repository=new CharacterContentRepository(createCmsStorage({provider:'file',rootDir:root}));
  await repository.saveDraft('probe',{displayName:'Probe',moves:[]});
  const storage=repository.storage;
  const manager=new CharacterBuildJobs({storage,repository,invoke});
  t.after(async()=>{await until(()=>!manager.running);await rm(root,{recursive:true,force:true});});
  return {manager,storage,repository};
}
const submission=(extras={})=>({idempotencyKey:randomUUID(),tool:'generate_sprite_sheet',input:{characterId:'probe',moveId:'punch',prompt:'A safe fixture row',generator:'image'},...extras});
const result={asset:{key:'characters/probe/assets/source.png',apiUrl:'/api/assets/characters/probe/assets/source.png'},warnings:[]};
const done=async(manager,id)=>until(async()=>{const job=await manager.get('probe',id);return !['queued','running','extracting'].includes(job.status)&&job;});

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

test('restarted queued or claimed jobs require explicit resolution, never paid replay',async t=>{
  let calls=0;const f=await fixture(t,async()=>{calls++;return result;});
  f.manager.drain=async()=>{};
  const {job}=await f.manager.submit('probe',submission());
  const restarted=new CharacterBuildJobs({...f,invoke:async()=>{calls++;return result;}});
  assert.equal((await restarted.get('probe',job.id)).status,'needs-recovery');
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
  for(const input of [{characterId:'other',prompt:'x'},{characterId:'probe',prompt:'x',context:{apiKey:'no'}},{characterId:'probe',prompt:'x',generator:'unknown'},{characterId:'probe',prompt:''}]){
    await assert.rejects(f.manager.submit('probe',submission({input})),{statusCode:400});
  }
  await assert.rejects(f.manager.submit('probe',submission({tool:'publish_character'})),{statusCode:400});
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
