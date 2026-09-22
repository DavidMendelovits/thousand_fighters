import test from 'node:test';
import assert from 'node:assert/strict';
import {ParallelFrameSpriteGenerator} from '../cms/pipeline/adapters/parallelFrameSpriteGenerator.js';
import {CharacterCreationPipeline} from '../cms/pipeline/CharacterCreationPipeline.js';
import {PipelinePort} from '../cms/pipeline/ports.js';
import {runGenerationAttempt} from '../cms/pipeline/generationAttemptTelemetry.js';
import {BflFluxKleinGeneratorAdapter} from '../cms/pipeline/adapters/bflFluxKleinGeneratorAdapter.js';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createCmsStorage} from '../cms/storage/createCmsStorage.js';

async function fixtureLineage(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'tf-material-ledger-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  return createCmsStorage({provider:'file',rootDir:root}).lineage;
}

test('frame generation forwards painted material into local sheet composition',async()=>{
  let composition;
  const generator=new ParallelFrameSpriteGenerator({composeFrameSheet:async args=>{composition=args;return Buffer.from('fixture-sheet');},frameRetries:0});
  generator.provider='test';generator.model='test';generator.generateFrame=async()=>({bytes:Buffer.from('fixture-frame')});
  await generator.generateImage({task:'fighter-1x6-row',moveId:'base',prompt:'One painted creature',context:{artStyle:'paint'}});
  assert.equal(composition.artStyle,'paint');assert.equal(composition.frames.length,6);
});

test('concept generation uses persisted material direction, not pixel defaults',async()=>{
  let request;
  const pipeline=new CharacterCreationPipeline({resolve(port){
    if(port===PipelinePort.IMAGE_GENERATOR)return {generateImage:async input=>{request=input;return {bytes:Buffer.from('fixture-image')};}};
    if(port===PipelinePort.CHARACTER_REPOSITORY)return {getDraft:async()=>({artStyle:'paint'}),writeAsset:async()=>({key:'fixture'})};
    if(port===PipelinePort.ASSET_STORAGE)return {};
    throw new Error(port);
  }});
  await pipeline.generateCharacterConcept({characterId:'paint',prompt:'Single paint creature'});
  assert.equal(request.context.artStyle,'paint');
});

test('unknown generation cost is not recorded as a free request',async t=>{
  let event;
  const recorder=async value=>{event=value;};
  recorder.lineage=await fixtureLineage(t);
  await runGenerationAttempt({onGenerationAttempt:recorder},{kind:'image',provider:'test'},async()=>({estimatedCostUsd:null}));
  assert.equal(event.estimatedCostUsd,null);
});

test('BFL journals accepted job before polling and retains ID on timeout',async()=>{
  let clock=0, submitted=0;
  const events=[];
  const recorder=async()=>{};
  recorder.lineage={event:async(_id,event)=>events.push(event)};
  const adapter=new BflFluxKleinGeneratorAdapter({apiKey:'fixture',timeoutMs:5,pollIntervalMs:1,now:()=>clock,sleep:async()=>{clock+=10;},fetch:async(_url,options)=>{
    if(options.method==='POST'){submitted++;return Response.json({id:'known-job'});}
    assert.equal(events[0].providerTaskId,'known-job');
    return Response.json({status:'Pending'});
  }});
  await assert.rejects(adapter.generateFrame({prompt:'fixture',context:{characterId:'skein'},onGenerationAttempt:recorder}),error=>error.noRetry===true&&error.taskId==='known-job');
  assert.equal(submitted,1);
});

test('accepted or uncertain paid frame requests are never automatically resubmitted',async t=>{
  let attempts=0;
  const generator=new ParallelFrameSpriteGenerator({frameConcurrency:1,frameRetries:2});
  generator.provider='test';generator.model='test';
  generator.generateFrame=async()=>{attempts++;throw Object.assign(new Error('Accepted job timed out'),{noRetry:true,taskId:'known-job'});};
  const recorder=async()=>{};
  recorder.lineage=await fixtureLineage(t);
  await assert.rejects(generator.generateImage({task:'fighter-1x6-row',prompt:'fixture',onGenerationAttempt:recorder}));
  assert.equal(attempts,1);
});

test('BFL transport failure during submission is not safe to retry',async()=>{
  const adapter=new BflFluxKleinGeneratorAdapter({apiKey:'fixture',fetch:async()=>{throw new Error('Connection closed');}});
  await assert.rejects(adapter.generateFrame({prompt:'fixture'}),error=>error.noRetry===true);
});
