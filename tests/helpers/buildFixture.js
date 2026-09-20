import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createLocalCmsRuntime} from '../../cms/runtime/createLocalCmsRuntime.js';
import {createMockImageGenerator} from '../../cms/pipeline/adapters/mockAdapters.js';
import {createCmsServer} from '../../cms/server/createCmsServer.js';
import {runGenerationAttempt} from '../../cms/pipeline/generationAttemptTelemetry.js';

// Controlled adapter; real server, repository, lineage and row extractor.
// Never read provider credentials or submit external requests.
export async function buildFixture({port=0,delayMs=2500,trialTransport=async()=>{throw new Error('Controlled fixture has no video transport. No external request was made.');}}={}){
  const root=await mkdtemp(path.join(os.tmpdir(),'tf-web-build-'));
  let calls=0;
  const mock=createMockImageGenerator();
  const runtime=createLocalCmsRuntime({
    storageOptions:{provider:'file',rootDir:root},textModelOptions:{provider:'mock'},soundGeneratorOptions:{provider:'mock'},
    imageGenerator:{...mock,async generateImage(input){
      input.context={...input.context,measurementKind:'fixture'};
      return runGenerationAttempt(input,{provider:'fixture',model:'controlled-image',kind:'image'},async()=>{
        calls++;await new Promise(r=>setTimeout(r,delayMs));
        return {...await mock.generateImage(input),estimatedCostUsd:0};
      });
    }},
    chatAgent:{healthCheck:async()=>({status:'ok',provider:'fixture'})},
  });
  runtime.registry.health=async()=>[];
  const inFlight=new Set(),invoke=runtime.tools.invoke.bind(runtime.tools);
  runtime.tools.invoke=(...args)=>{
    const pending=invoke(...args);inFlight.add(pending);
    pending.then(()=>inFlight.delete(pending),()=>inFlight.delete(pending));return pending;
  };
  const characterId='web_build_lab';
  const draft=await runtime.pipeline.createCharacterDraft({characterId,brief:'CONTROLLED PROVIDER DEMO — No paid generation. This fixture verifies browser refresh, saved build jobs and real local frame extraction, not character art quality.'});
  await runtime.repository.saveDraft(characterId,{...draft,displayName:'Web build lab · controlled provider'});
  const server=createCmsServer({runtime,benchmarkOptions:{trialRootDir:path.join(root,'trial-work'),trialTransport:(...args)=>{
    const pending=trialTransport(...args);inFlight.add(pending);
    pending.then(()=>inFlight.delete(pending),()=>inFlight.delete(pending));return pending;
  }}});
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  return {runtime,root,characterId,get calls(){return calls;},url:`http://127.0.0.1:${server.address().port}`,
    close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));
      while(inFlight.size)await Promise.allSettled([...inFlight]);
      await Promise.allSettled([...runtime.repository.mutations.values()]);
      await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}};
}
