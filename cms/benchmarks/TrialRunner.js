import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {runVideoJob} from '../../scripts/generate_animation_video.mjs';
import {FAL_VIDEO_MODELS} from '../pipeline/adapters/falVideoGeneratorAdapter.js';
import {PRUNA_VIDEO_MODEL} from '../pipeline/adapters/prunaVideoGeneratorAdapter.js';

export function trialExecutionBlock(trial) {
  if(trial.references.length!==1)return 'Execution currently requires exactly one pinned image reference.';
  if(trial.settings.seed!=null)return 'These video adapters do not enforce seed; remove it before execution.';
  if(!Number.isInteger(trial.settings.durationSeconds)||trial.settings.durationSeconds<5||trial.settings.durationSeconds>15)return 'Both video adapters require an integer duration of 5–15 seconds.';
  for(const candidate of trial.candidates){
    if(candidate.provider==='fal'&&candidate.model===FAL_VIDEO_MODELS['image-to-video']){
      if(trial.settings.resolution!=='provider-native')return 'FAL does not expose resolution control here. Use provider-native to acknowledge unequal output resolutions.';
    }else if(candidate.provider==='pruna'&&candidate.model===PRUNA_VIDEO_MODEL){
      if(!['provider-native','480p','768p'].includes(trial.settings.resolution))return 'Pruna requires 480p or 768p resolution.';
    }else return 'This candidate model is not supported by the controlled video runner.';
  }
  return null;
}

/** One immutable slot per candidate/action. Fixed equal-share reservations make
 * parallel admissions budget-safe without a distributed read-modify-write lock.
 * This bounds authorized estimates/submission count, not provider invoices. */
export class TrialRunner {
  constructor({storage,transport=runVideoJob,rootDir=path.resolve('artifacts/model-trials')}){
    this.storage=storage;this.transport=transport;this.rootDir=rootDir;this.live=new Map();this.admission=Promise.resolve();
  }
  root(trialId,slot){return `benchmarks/trial-runs/${trialId}/${slot}`;}
  slot(trial,input){
    const {candidateIndex,actionIndex}=input;
    if(!Number.isInteger(candidateIndex)||!trial.candidates[candidateIndex]||!Number.isInteger(actionIndex)||!trial.actions[actionIndex])throw new Error('Choose a valid candidate and action.');
    return `${candidateIndex}-${actionIndex}`;
  }
  async state(trial,slot){
    const root=this.root(trial.id,slot);
    if(!await this.storage.exists(`${root}/request.json`))return null;
    const request=await this.storage.getJson(`${root}/request.json`);
    const keys=(await this.storage.list(`${root}/events`)).filter(key=>key.endsWith('.json')).sort();
    const latest=keys.length?await this.storage.getJson(keys.at(-1)):{};
    const status=this.live.has(root)?'running':latest.status==='completed'?'completed':'needs-recovery';
    return {...request,...latest,status,slot};
  }
  async states(trial){
    const results=[];
    for(let c=0;c<trial.candidates.length;c++)for(let a=0;a<trial.actions.length;a++){
      const state=await this.state(trial,`${c}-${a}`);if(state)results.push(state);
    }
    return results;
  }
  admit(trial,input,options={}){
    const pending=this.admission.then(()=>this.admitExclusive(trial,input,options));
    this.admission=pending.catch(()=>{});return pending;
  }
  async admitExclusive(trial,input,{resume=false}={}){
    if(input.confirmed!==true)throw new Error('Confirm this single candidate/action request.');
    const blocked=trialExecutionBlock(trial);if(blocked)throw new Error(blocked);
    const slot=this.slot(trial,input),root=this.root(trial.id,slot);
    let state=await this.state(trial,slot);
    if(state&&!resume)return {run:state,reused:true};
    if(this.live.size&&!this.live.has(root))throw new Error('A controlled trial is already running on this worker. Wait for it before submitting another slot.');
    if(resume){
      if(!state)throw new Error('No saved trial attempt exists to resume.');
      if(state.status==='completed'||this.live.has(root))return {run:state,reused:true};
    }else{
      if(input.acceptUnknownCost!==true)throw new Error('Provider price is unknown. Acknowledge that the reservation is not an invoice cap.');
      const reservationUsd=trial.budgetUsd/(trial.candidates.length*trial.actions.length);
      const request={schemaVersion:1,id:randomUUID(),trialId:trial.id,slot,candidateIndex:input.candidateIndex,actionIndex:input.actionIndex,
        createdAt:new Date().toISOString(),reservationUsd,unknownCostAcknowledged:true,comparisonHash:trial.comparisonHash,
        candidate:trial.candidates[input.candidateIndex],action:trial.actions[input.actionIndex],settings:trial.settings,
        reference:trial.references[0],directory:path.join(this.rootDir,trial.id,slot),status:'reserved'};
      try{await this.storage.putImmutable(`${root}/request.json`,Buffer.from(JSON.stringify(request)),{contentType:'application/json'});}
      catch(error){if(await this.storage.exists(`${root}/request.json`))return {run:await this.state(trial,slot),reused:true};throw error;}
      state=request;
    }
    // Set ownership before yielding to the caller. A refresh observes this worker;
    // a new process sees needs-recovery and never silently submits another task.
    const promise=this.execute(trial,state,resume).catch(()=>{}).finally(()=>this.live.delete(root));
    this.live.set(root,promise);
    return {run:await this.state(trial,slot),reused:false};
  }
  async execute(trial,request,resume){
    const root=this.root(trial.id,request.slot);
    const event=async value=>{
      for(let retry=0;retry<10;retry++){
        const keys=(await this.storage.list(`${root}/events`)).filter(key=>key.endsWith('.json'));
        const key=`${root}/events/${String(keys.length).padStart(10,'0')}.json`;
        try{await this.storage.putImmutable(key,Buffer.from(JSON.stringify({...value,observedAt:new Date().toISOString()})),{contentType:'application/json'});return;}
        catch(error){if(!await this.storage.exists(key))throw error;}
      }
      throw new Error('Trial journal contention.');
    };
    try{
      await event({status:'running',resumed:resume});
      const options=resume?{resume:request.directory}:{provider:request.candidate.provider,mode:'image-to-video',prompt:`${request.action.prompt}\nArt medium: ${trial.settings.artStyle}.`,duration:trial.settings.durationSeconds,output:request.directory,
        ...(request.candidate.provider==='pruna'?{resolution:trial.settings.resolution==='provider-native'?'768p':trial.settings.resolution,recipe:'quality'}:{})};
      if(!resume){
        const bytes=await this.storage.lineage.readArtifact(request.reference);
        const extension={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'}[request.reference.contentType];
        if(!extension)throw new Error('Pinned reference must be PNG, JPEG or WebP.');
        await mkdir(request.directory,{recursive:true});
        options.image=path.join(request.directory,`reference${extension}`);
        await writeFile(options.image,bytes,{flag:'wx'});
      }
      const job=await this.transport(options,{storage:this.storage,characterId:trial.characterId,moveId:request.action.moveId,buildJobId:request.id,log:()=>{},
        onGenerationAttempt:async attempt=>{
          const recorded={...attempt,trialId:trial.id,trialSlot:request.slot,characterId:trial.characterId,moveId:request.action.moveId,buildJobId:request.id,style:trial.settings.artStyle,resolution:request.candidate.provider==='pruna'?(trial.settings.resolution==='provider-native'?'768p':trial.settings.resolution):'provider-native',referenceSha256:request.reference.sha256,comparisonHash:trial.comparisonHash};
          await this.storage.putJson(`benchmarks/generation-attempts/${attempt.startedAt.slice(0,10)}/${attempt.attemptId}-trial-${randomUUID()}.json`,recorded);
        }});
      if(job.model!==request.candidate.model)throw new Error('Returned model does not match the pinned trial candidate.');
      if(!job.archivedOutput)throw new Error('Trial completed without an archived output.');
      await this.storage.lineage.readArtifact(job.archivedOutput);
      await event({status:'completed',attemptId:job.generationAttempt?.attemptId??null,outputArtifact:job.archivedOutput,model:job.model,qualityStatus:'unreviewed',completedAt:new Date().toISOString()});
    }catch(error){await event({status:'needs-recovery',error:String(error.message).replace(/https?:\S+/g,'[URL]').slice(0,400)});throw error;}
  }
}
