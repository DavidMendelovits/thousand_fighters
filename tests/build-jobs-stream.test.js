import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createCmsStorage} from '../cms/storage/createCmsStorage.js';
import {CharacterContentRepository} from '../cms/repositories/CharacterContentRepository.js';
import {createCmsServer} from '../cms/server/createCmsServer.js';

async function fixture(t,invoke){
  const root=await mkdtemp(path.join(os.tmpdir(),'tf-job-stream-'));
  const storage=createCmsStorage({provider:'file',rootDir:root}),repository=new CharacterContentRepository(storage);
  await repository.saveDraft('probe',{displayName:'Probe',moves:[]});
  const server=createCmsServer({runtime:{storage,repository,tools:{invoke}}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});});
  return {server,url:`http://127.0.0.1:${server.address().port}/api/characters/probe/build-jobs`};
}
const submission=()=>({idempotencyKey:randomUUID(),tool:'generate_character_concept',input:{characterId:'probe',prompt:'Fixture'}});
async function until(check){for(let i=0;i<200;i++){const result=await check();if(result)return result;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Timed out');}

test('GET SSE replays a terminal job after the client disconnects using Last-Event-ID',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});t.after(()=>release());
  const f=await fixture(t,async()=>{await gate;return {asset:{key:'candidate'},framesReady:true};});
  const response=await fetch(f.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(submission())});
  assert.equal(response.status,202);const {job}=await response.json();
  const controller=new AbortController();
  const stream=await fetch(`${f.url}/${job.id}/events`,{signal:controller.signal});
  assert.match(stream.headers.get('content-type'),/text\/event-stream/);
  const reader=stream.body.getReader();let body='';
  while(!body.includes('event: job'))body+=new TextDecoder().decode((await reader.read()).value);
  const cursor=Number([...body.matchAll(/^id: (\d+)/gm)].at(-1)[1]);
  controller.abort();release();
  const finished=await until(async()=>{const result=await (await fetch(`${f.url}/${job.id}`)).json();return result.job.status==='completed'&&result.job;});
  const reconnect=new AbortController();
  const resumed=await fetch(`${f.url}/${job.id}/events`,{headers:{'last-event-id':String(cursor)},signal:reconnect.signal});
  const resumedReader=resumed.body.getReader();let replay='';
  while(!replay.includes('"status":"completed"'))replay+=new TextDecoder().decode((await resumedReader.read()).value);
  const ids=[...replay.matchAll(/^id: (\d+)/gm)].map(match=>Number(match[1]));
  assert.ok(ids.every(id=>id>cursor));assert.equal(new Set(ids).size,ids.length);assert.equal(ids.at(-1),finished.revision);
  reconnect.abort();
  assert.equal((await fetch(`${f.url}/${job.id}/events?after=bad`)).status,400);
  await until(()=>f.server.buildJobs.events.listenerCount(job.id)===0);
});

test('graceful close rejects new builds and waits for the current provider invocation',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});t.after(()=>release());
  const f=await fixture(t,async()=>{await gate;return {framesReady:true};});
  const {job}=await (await fetch(f.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(submission())})).json();
  await until(()=>f.server.buildJobs.live.has(job.id));let closed=false;
  const stopped=new Promise(resolve=>f.server.close(()=>{closed=true;resolve();}));
  await assert.rejects(f.server.buildJobs.submit('probe',submission()),{statusCode:503});assert.equal(closed,false);
  const mutation=await fetch(new URL('/api/tools/generate_character_concept',f.url),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({characterId:'probe',prompt:'Must not execute'})});
  assert.equal(mutation.status,503);assert.match((await mutation.json()).error,/draining/);
  const draftMutation=await fetch(new URL('/api/characters/probe',f.url),{method:'PUT',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(draftMutation.status,503);
  release();await stopped;assert.equal((await f.server.buildJobs.get('probe',job.id)).status,'completed');
});

test('drain retains ownership until a previously admitted direct tool finishes',async t=>{
  let release,entered=false;const gate=new Promise(resolve=>{release=resolve;});t.after(()=>release());
  const f=await fixture(t,async()=>{entered=true;await gate;return {ok:true};});
  const pending=fetch(new URL('/api/tools/fixture',f.url),{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  await until(()=>entered);let closed=false;
  const stopped=new Promise(resolve=>f.server.close(()=>{closed=true;resolve();}));
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(closed,false);assert.equal(f.server.buildJobs.owner.held,true);
  release();assert.equal((await pending).status,200);await stopped;
  assert.equal(f.server.buildJobs.owner.held,false);
});
