import {GenerationAttemptLedger} from './GenerationAttemptLedger.js';
import {BflFluxKleinGeneratorAdapter} from './adapters/bflFluxKleinGeneratorAdapter.js';
import {FalImageGeneratorAdapter} from './adapters/falImageGeneratorAdapter.js';
import {MinimaxH3SpriteSheetGeneratorAdapter} from './adapters/minimaxH3SpriteSheetGeneratorAdapter.js';
import {downloadImage,responseJson} from './adapters/remoteImageAdapterUtils.js';
const active=new Set();

/** Recover only an already accepted provider result. Never calls submit or
 * generate. Outputs stay archived candidates; installation/review is separate. */
export async function recoverGenerationAttempt({storage,characterId,attemptId,confirmed,adapters={},isBuildActive=null}){
  if(confirmed!==true)throw Object.assign(new Error('Confirm the previous worker has stopped.'),{statusCode:400});
  if(active.has(attemptId))throw Object.assign(new Error('Recovery is already running.'),{statusCode:409});
  active.add(attemptId);
  try{
    const ledger=new GenerationAttemptLedger(storage.lineage);
    const {intent,events}=await ledger.read(attemptId);
    if(intent.characterId!==characterId)throw Object.assign(new Error('Attempt does not belong to this character.'),{statusCode:404});
    if(intent.buildJobId&&await isBuildActive?.(intent.buildJobId))throw Object.assign(new Error('The original build is still active. Wait for it to finish before recovering.'),{statusCode:409});
    const archived=events.findLast(event=>event.outputArtifact);
    if(archived){await storage.lineage.readArtifact(archived.outputArtifact);return {attemptId,outputArtifact:archived.outputArtifact,reused:true};}
    const providerTaskId=events.findLast(event=>event.providerTaskId)?.providerTaskId;
    if(!providerTaskId)throw Object.assign(new Error('Submission is uncertain: no accepted task ID. Check the provider account; recovery will not submit again.'),{statusCode:409});
    let result;
    if(intent.provider==='bfl-klein'){
      const adapter=adapters.bfl??new BflFluxKleinGeneratorAdapter({model:intent.model});
      const completed=await adapter.waitForResult(`${adapter.baseUrl.replace(/\/$/,'')}/v1/get_result?id=${encodeURIComponent(providerTaskId)}`);
      result=await downloadImage(adapter.fetch,completed.result?.sample??completed.sample,'BFL');
    }else if(intent.provider==='fal'&&intent.kind==='image'){
      const adapter=adapters.fal??new FalImageGeneratorAdapter({model:intent.model});
      // FAL request routes use the namespace/owner pair, not sub-model suffixes.
      const route=String(intent.model).split('/').slice(0,2).join('/');
      const base=`${adapter.queueUrl.replace(/\/$/,'')}/${route}/requests/${encodeURIComponent(providerTaskId)}`;
      const headers={authorization:`Key ${adapter.apiKey}`};
      await adapter.waitForResult(`${base}/status`,headers);
      const completed=await responseJson(await adapter.fetch(base,{headers}),'fal');
      const image=completed.images?.[0]??completed.image??completed.output?.images?.[0];
      const inline=image?.content??image?.base64;
      result=inline?{bytes:Buffer.from(inline,'base64'),contentType:image.content_type??'image/png'}:await downloadImage(adapter.fetch,typeof image==='string'?image:image?.url,'fal');
    }else if(intent.provider==='minimax-h3'){
      const adapter=adapters.minimax??new MinimaxH3SpriteSheetGeneratorAdapter({model:intent.model});
      const completed=await adapter.waitForTask(providerTaskId);
      const response=await adapter.fetch(completed.content?.url);
      if(!response.ok)throw new Error(`Video download failed: ${response.status}`);
      result={bytes:Buffer.from(await response.arrayBuffer()),contentType:'video/mp4'};
    }else throw Object.assign(new Error('This provider requires its archived video checkpoint or manual account recovery. No new generation was submitted.'),{statusCode:409});
    if(!result.bytes?.length)throw new Error('Provider returned an empty asset.');
    const outputArtifact=await storage.lineage.artifact(result.bytes,{contentType:result.contentType});
    await ledger.event({...intent,status:'succeeded',recovered:true,completedAt:new Date().toISOString(),providerTaskId,outputArtifact,durationMs:null,estimatedCostUsd:null});
    return {attemptId,providerTaskId,outputArtifact,reused:false,reviewRequired:true};
  }finally{active.delete(attemptId);}
}
