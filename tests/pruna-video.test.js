import test from 'node:test';
import assert from 'node:assert/strict';
import {PrunaVideoGeneratorAdapter,prunaVideoPayload,trustedPrunaUrl} from '../cms/pipeline/adapters/prunaVideoGeneratorAdapter.js';
import {runVideoJob,parseVideoArgs} from '../scripts/generate_animation_video.mjs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('Pruna validates five-second minimum and does not upscale the prompt',()=>{
  const request={mode:'image-to-video',image:'https://example.com/ref.png',prompt:'Walk',duration:5};
  assert.equal(prunaVideoPayload(request).prompt_upsampler,'off');
  assert.throws(()=>prunaVideoPayload({...request,duration:3}),/5–15/);
  assert.throws(()=>prunaVideoPayload({...request,mode:'motion-control'}),/not motion-control/);
  assert.equal(parseVideoArgs(['--provider','pruna','--mode','image-to-video','--image','ref.png','--prompt','Walk','--output','out']).provider,'pruna');
});
test('credentials are restricted to Pruna and redirects are refused',async()=>{
  assert.throws(()=>trustedPrunaUrl('https://evil.test/v1/files/a'),/Untrusted/);
  const adapter=new PrunaVideoGeneratorAdapter({apiKey:'test-secret',fetch:async(url,options)=>{
    assert.equal(options.redirect,'error');assert.equal(options.headers.apikey,'test-secret');
    return new Response(JSON.stringify({status:'processing'}),{status:200});
  }});
  await adapter.requestJson('https://api.pruna.ai/v1/predictions/status/id');
  await assert.rejects(adapter.requestJson('https://evil.test/v1/status'),/Untrusted/);
});
test('Pruna completion, telemetry and resume reuse do not create duplicate paid calls',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'tf-pruna-test-'));let submissions=0;const events=[];
  const adapter={submit:async()=>{submissions++;return {requestId:'abc',timings:{referenceUploadMs:4}};},poll:async(_,hooks)=>hooks.onStatus('COMPLETED'),result:async()=>({url:'https://api.pruna.ai/v1/predictions/delivery/a'}),download:async()=>Buffer.from('0000ftypisom00000000000000000000')};
  try{
    await runVideoJob({provider:'pruna',mode:'image-to-video',image:'https://example.com/ref.png',prompt:'Walk',duration:5,output:root},{adapter,log:()=>{},onGenerationAttempt:event=>events.push(event)});
    await runVideoJob({resume:root},{adapter,log:()=>{},onGenerationAttempt:event=>events.push(event)});
    assert.equal(submissions,1);assert.equal(events.length,1);assert.equal(events[0].provider,'pruna');assert.equal(events[0].status,'succeeded');
    const job=JSON.parse(await readFile(path.join(root,'job.json')));assert.equal(job.timings.referenceUploadMs,4);assert.equal(job.request.audio,true);
  }finally{await rm(root,{recursive:true,force:true});}
});
