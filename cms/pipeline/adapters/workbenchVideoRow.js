import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {runVideoJob} from '../../../scripts/generate_animation_video.mjs';
import {installMotionRow} from '../motionRowArtifacts.js';
import {workbenchMotionPrompt} from './workbenchMotionPrompt.js';
import {motionActorReference, motionCompilerSettings, motionCompilerArgs} from '../motionReference.js';
import {restoreBuildVideoCheckpoint} from '../restoreBuildVideoCheckpoint.js';
export {motionActorReference} from '../motionReference.js';
const exec=promisify(execFile);
const inFlight = new Map();
// A definitive HTTP rejection is different from an ambiguous lost response.
// Only a later explicit Generate/Regen click may submit a replacement.
export function isRejectedSubmission(job){return !job.task?.requestId&&[400,401,403,422].includes(job.lastError?.statusCode);}

/** Same durable video transport as the CLI, now reachable through the authoring UI. */
export async function generateWorkbenchVideoRow(request) {
  const key = `${request.characterId}:${request.moveId}`;
  if (inFlight.has(key)) throw new Error('This video row is already generating. Wait for its existing job; no duplicate was submitted.');
  const pending = generateExclusive(request);
  inFlight.set(key, pending);
  try { return await pending; }
  finally { inFlight.delete(key); }
}

async function generateExclusive({characterId,moveId,prompt,task,storage,repository,onProgress,onGenerationAttempt,buildJobId,referenceAssetKey,recoveryOnly=false,provider='fal'}) {
  const started=Date.now();
  const stageTimings={};
  const keyName=provider==='pruna'?'PRUNA_API_KEY':'FAL_KEY';
  if(!process.env[keyName])throw new Error(`${keyName} is required for video motion. No request was submitted.`);
  const draft=await repository.getDraft(characterId);
  const artStyle=['watercolor','paint'].includes(draft.artStyle)?draft.artStyle:'pixel';
  const packRoot=draft.assets?.rootKey??`characters/${characterId}/assets/fighter-pack`;
  const frameData=await storage.exists(`${packRoot}/frameData.json`)?await storage.getJson(`${packRoot}/frameData.json`):null;
  const {actorId,referenceFile}=motionActorReference(draft,moveId,frameData);
  const referenceKey=referenceAssetKey??`${draft.assets?.rootKey??`characters/${characterId}/assets/fighter-pack`}/${referenceFile}`;
  const referenceLoadStartedAt=Date.now();
  if(!await storage.exists(referenceKey))throw new Error('Generate and extract the base row before creating video motion.');
  const bytes=await storage.getBytes(referenceKey);
  stageTimings.referenceLoadMs=Date.now()-referenceLoadStartedAt;
  const {profile,motionPrompt}=workbenchMotionPrompt({draft,row:moveId,prompt,actorId});
  const fingerprint=createHash('sha256').update(bytes).update(motionPrompt).update(task).update(provider).update(artStyle==='paint'?'paint-wide-0.35-v2':'ref-occupancy-0.65-quality-loop-endlock-v1').digest('hex');
  const pointerKey=`${draft.history?.workingRoot ?? `characters/${characterId}/assets`}/jobs/${moveId}_${provider}_video.json`;
  const previous = await storage.exists(pointerKey) ? await storage.getJson(pointerKey) : null;
  const jobsRoot=path.resolve('artifacts/workbench-video-jobs');
  let directory, resume=false;
  if(recoveryOnly){
    if(previous?.fingerprint!==fingerprint)throw new Error('Video inputs changed. Restore the pinned reference and authored motion before recovery; no generation submitted.');
    directory=await restoreBuildVideoCheckpoint({storage,characterId,buildJobId,referenceBytes:bytes,rootDir:jobsRoot});resume=true;
  }else if(previous?.fingerprint===fingerprint&&/^[a-f0-9-]{36}$/.test(previous.jobId)){
    const candidate=path.join(jobsRoot,previous.jobId);
    // A missing/corrupt checkpoint is not permission to submit another paid job.
    const job=JSON.parse(await readFile(path.join(candidate,'job.json'),'utf8'));
    if(!isRejectedSubmission(job)){directory=candidate;resume=true;}
  }
  if(!directory){
    if(recoveryOnly)throw new Error('No matching accepted video checkpoint exists. Restore the original references and checkpoint from History; no generation submitted.');
    const referencePreparationStartedAt=Date.now();
    const jobId=randomUUID();directory=path.join(jobsRoot,jobId);await mkdir(directory,{recursive:true});
    await writeFile(path.join(directory,'sprite.png'),bytes);
    // Preserve the approved native sprite with integer enlargement and margins.
    await exec('python3',['scripts/prepare_animation_reference.py',path.join(directory,'sprite.png'),'--output',path.join(directory,'reference.png'),'--size','768','--occupancy',artStyle==='paint'?'0.35':'0.65',...(artStyle==='paint'?['--background','#ffffff']:[])]);
    stageTimings.referencePreparationMs=Date.now()-referencePreparationStartedAt;
    const checkpointStartedAt=Date.now();
    await repository.writeAsset(characterId,`jobs/${moveId}_${provider}_video.json`,Buffer.from(JSON.stringify({jobId,fingerprint,provider,model:provider==='pruna'?'p-video-2-pro':'kling-v3-standard',moveId})),{contentType:'application/json',provider});
    stageTimings.jobCheckpointMs=Date.now()-checkpointStartedAt;
  }else{
    stageTimings.referencePreparationMs=0;
    stageTimings.jobCheckpointMs=0;
  }
  onProgress?.({type:'status',message:resume?'Resuming the existing video job; no new submission.':'Generating a complete action video; variable-count frames require visual review.'});
  const transportStartedAt=Date.now();
  const job=await runVideoJob(
    resume?{resume:directory}:{provider,mode:'image-to-video',image:path.join(directory,'reference.png'),...(provider==='pruna'?{recipe:'quality',...(artStyle==='paint'?{resolution:'768p'}:{}),...(profile.loop?{'end-image':path.join(directory,'reference.png')}:{})}:{}),prompt:motionPrompt,duration:provider==='pruna'?5:profile.duration,output:directory},
    {
      log:message=>onProgress?.({type:'status',message}),
      storage, characterId, moveId, buildJobId,
      ...(onGenerationAttempt?{onGenerationAttempt:event=>onGenerationAttempt({...event,characterId,moveId,operation:'fighter-video-row'})}:{}),
    },
  );
  stageTimings.videoTransportMs=Date.now()-transportStartedAt;
  Object.assign(stageTimings, job.timings ?? {});
  const videoReadStartedAt=Date.now();
  const videoBytes=await readFile(path.join(directory,'source.mp4'));
  stageTimings.videoReadMs=Date.now()-videoReadStartedAt;
  const compositionStartedAt=Date.now();
  const compiled=path.join(directory,'motion-v2');
  let exists=false;try{await readFile(path.join(compiled,'motion.json'));exists=true;}catch{}
  if(!exists)await storage.lineage.run({characterId,stage:'compile-motion',moveId,inputs:{video:job.archivedOutput,reference:await storage.lineage.artifact(bytes,{contentType:'image/png'}),style:artStyle,frames:profile.frames,loop:profile.loop,compiler:await storage.lineage.artifact(await readFile('scripts/compile_character_motion.py'),{contentType:'text/x-python'})}},()=>exec('python3',['scripts/compile_character_motion.py',path.join(directory,'source.mp4'),'--reference',path.join(directory,'sprite.png'),'--output',compiled,'--action',moveId,...motionCompilerArgs(motionCompilerSettings(artStyle)),'--frames',String(profile.frames),...(profile.loop?['--loop']:[])],{timeout:120000,maxBuffer:2*1024*1024}));
  const motionRow=await installMotionRow({characterId,directory:compiled,storage,repository});
  const sheet=await readFile(path.join(compiled,'sheet.png'));
  stageTimings.spriteCompositionMs=Date.now()-compositionStartedAt;
  stageTimings.totalAdapterMs=Date.now()-started;
  const generationMs=stageTimings.videoTransportMs;
  const postprocessMs=stageTimings.spriteCompositionMs;
  return {bytes:sheet,contentType:'image/png',provider:`${provider}-video`,model:job.model,taskId:job.task?.requestId,videoBytes,videoContentType:'video/mp4',generationMs,elapsedMs:stageTimings.totalAdapterMs,postprocessMs,stageTimings,motionRow,framesReady:true,referenceKey};
}
