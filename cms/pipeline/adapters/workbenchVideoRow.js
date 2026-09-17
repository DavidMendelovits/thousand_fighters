import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {runVideoJob} from '../../../scripts/generate_animation_video.mjs';
import {motionProfile} from '../motionProfiles.js';
import {installMotionRow} from '../motionRowArtifacts.js';
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

async function generateExclusive({characterId,moveId,prompt,task,storage,repository,onProgress,onGenerationAttempt}) {
  const started=Date.now();
  const stageTimings={};
  if(!process.env.FAL_KEY)throw new Error('FAL_KEY is required for video motion. No request was submitted.');
  const referenceKey=`characters/${characterId}/assets/fighter-pack/sprites/base/base_001.png`;
  const referenceLoadStartedAt=Date.now();
  if(!await storage.exists(referenceKey))throw new Error('Generate and extract the base row before creating video motion.');
  const bytes=await storage.getBytes(referenceKey);
  stageTimings.referenceLoadMs=Date.now()-referenceLoadStartedAt;
  const profile=motionProfile(moveId,prompt);
  const motionPrompt=`Animate ONLY the reference fighter, always facing RIGHT, fixed side-view camera. Crisp expressive 2D pixel art, identical costume, silhouette, palette and proportions. Flat #ff00ff background, no floor shadow, no camera motion, no opponent or text. Keep the entire actor at least 15% from every edge. Animate in place; the engine supplies world movement. BODY PASS ONLY: projectiles and long extensions are separate game entities. ${profile.prompt}`;
  const fingerprint=createHash('sha256').update(bytes).update(motionPrompt).update(task).digest('hex');
  const pointerKey=`characters/${characterId}/assets/jobs/${moveId}_video.json`;
  const previous = await storage.exists(pointerKey) ? await storage.getJson(pointerKey) : null;
  const jobsRoot=path.resolve('artifacts/workbench-video-jobs');
  let directory, resume=false;
  if(previous?.fingerprint===fingerprint&&/^[a-f0-9-]{36}$/.test(previous.jobId)){
    const candidate=path.join(jobsRoot,previous.jobId);
    // A missing/corrupt checkpoint is not permission to submit another paid job.
    const job=JSON.parse(await readFile(path.join(candidate,'job.json'),'utf8'));
    if(!isRejectedSubmission(job)){directory=candidate;resume=true;}
  }
  if(!directory){
    const referencePreparationStartedAt=Date.now();
    const jobId=randomUUID();directory=path.join(jobsRoot,jobId);await mkdir(directory,{recursive:true});
    await writeFile(path.join(directory,'sprite.png'),bytes);
    // Preserve the approved native sprite with integer enlargement and margins.
    await exec('python3',['scripts/prepare_animation_reference.py',path.join(directory,'sprite.png'),'--output',path.join(directory,'reference.png'),'--size','768','--occupancy','0.6']);
    stageTimings.referencePreparationMs=Date.now()-referencePreparationStartedAt;
    const checkpointStartedAt=Date.now();
    await repository.writeAsset(characterId,`jobs/${moveId}_video.json`,Buffer.from(JSON.stringify({jobId,fingerprint,provider:'fal',model:'kling-v3-standard',moveId})),{contentType:'application/json',provider:'fal'});
    stageTimings.jobCheckpointMs=Date.now()-checkpointStartedAt;
  }else{
    stageTimings.referencePreparationMs=0;
    stageTimings.jobCheckpointMs=0;
  }
  onProgress?.({type:'status',message:resume?'Resuming the existing video job; no new submission.':'Generating a complete action video; variable-count frames require visual review.'});
  const transportStartedAt=Date.now();
  const job=await runVideoJob(
    resume?{resume:directory}:{provider:'fal',mode:'image-to-video',image:path.join(directory,'reference.png'),prompt:motionPrompt,duration:profile.duration,output:directory},
    {
      log:message=>onProgress?.({type:'status',message}),
      onGenerationAttempt:event=>onGenerationAttempt?.({...event,characterId,moveId,operation:'fighter-video-row'}),
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
  if(!exists)await exec('python3',['scripts/compile_character_motion.py',path.join(directory,'source.mp4'),'--reference',path.join(directory,'sprite.png'),'--output',compiled,'--action',moveId,'--frames',String(profile.frames),...(profile.loop?['--loop']:[])],{timeout:120000,maxBuffer:2*1024*1024});
  const motionRow=await installMotionRow({characterId,directory:compiled,storage,repository});
  const sheet=await readFile(path.join(compiled,'sheet.png'));
  stageTimings.spriteCompositionMs=Date.now()-compositionStartedAt;
  stageTimings.totalAdapterMs=Date.now()-started;
  const generationMs=stageTimings.videoTransportMs;
  const postprocessMs=stageTimings.spriteCompositionMs;
  return {bytes:sheet,contentType:'image/png',provider:'fal-video',model:job.model,taskId:job.task?.requestId,videoBytes,videoContentType:'video/mp4',generationMs,elapsedMs:stageTimings.totalAdapterMs,postprocessMs,stageTimings,motionRow,framesReady:true};
}
