import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {runVideoJob} from '../../../scripts/generate_animation_video.mjs';
import {composeSpriteSheetWithFfmpeg} from './minimaxH3SpriteSheetGeneratorAdapter.js';
import {rowPromptProfile} from '../rowPromptProfiles.js';
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

async function generateExclusive({characterId,moveId,prompt,task,storage,repository,onProgress}) {
  if(!process.env.FAL_KEY)throw new Error('FAL_KEY is required for video motion. No request was submitted.');
  const referenceKey=`characters/${characterId}/assets/fighter-pack/sprites/base/base_001.png`;
  if(!await storage.exists(referenceKey))throw new Error('Generate and extract the base row before creating video motion.');
  const bytes=await storage.getBytes(referenceKey);
  const profile=rowPromptProfile(moveId);
  const motionPrompt=`Animate ONLY the single reference fighter, facing RIGHT, fixed side-view camera. Crisp 16-bit pixel art, identical costume, silhouette, palette and proportions. Solid flat #ff00ff background throughout, no floor, no shadows, no camera motion, no opponent, no text. Keep the entire actor, longest extensions and all props at least 15% away from EVERY camera edge through the whole motion; do not zoom in. Animate in place; the game engine supplies world movement. Action: ${profile.description}. Interpret these six frame roles as six consecutive key moments of this video: ${profile.frameRoles}. CHARACTER BODY PASS ONLY: no explosions, muzzle flashes, impact bursts, detached projectiles or lingering trails. Those are separate runtime VFX/entities, not pixels baked into this body animation. Motion brief: ${prompt}`;
  const fingerprint=createHash('sha256').update(bytes).update(motionPrompt).update(task).digest('hex');
  const pointerKey=`characters/${characterId}/assets/jobs/${moveId}_video.json`;
  const previous = await storage.exists(pointerKey) ? await storage.getJson(pointerKey) : null;
  const jobsRoot=path.resolve('artifacts/workbench-video-jobs');
  let directory, resume=false;
  if(previous?.fingerprint===fingerprint&&/^[a-f0-9-]{36}$/.test(previous.jobId)){
    const candidate=path.join(jobsRoot,previous.jobId);
    // A missing/corrupt checkpoint is not permission to submit another paid job.
    const job=JSON.parse(await readFile(path.join(candidate,'job.json'),'utf8'));
    if(job.transportStatus!=='downloaded'&&!isRejectedSubmission(job)){directory=candidate;resume=true;}
  }
  const started=Date.now();
  if(!directory){
    const jobId=randomUUID();directory=path.join(jobsRoot,jobId);await mkdir(directory,{recursive:true});
    await writeFile(path.join(directory,'sprite.png'),bytes);
    // A generated base can be larger than a native sprite. Downsample once,
    // then use integer enlargement and an invariant reference for the video.
    await exec('ffmpeg',['-hide_banner','-loglevel','error','-i',path.join(directory,'sprite.png'),'-vf','scale=160:160:force_original_aspect_ratio=decrease:flags=neighbor','-frames:v','1',path.join(directory,'small.png')]);
    await exec('python3',['scripts/prepare_animation_reference.py',path.join(directory,'small.png'),'--output',path.join(directory,'reference.png'),'--occupancy','0.4']);
    await repository.writeAsset(characterId,`jobs/${moveId}_video.json`,Buffer.from(JSON.stringify({jobId,fingerprint,provider:'fal',model:'kling-v3-standard',moveId})),{contentType:'application/json',provider:'fal'});
  }
  onProgress?.({type:'status',message:resume?'Resuming the existing video job; no new submission.':'Submitting a 5-second image-to-video job using the extracted base pose.'});
  const job=await runVideoJob(resume?{resume:directory}:{provider:'fal',mode:'image-to-video',image:path.join(directory,'reference.png'),prompt:motionPrompt,duration:'5',output:directory},{log:message=>onProgress?.({type:'status',message})});
  const generationMs=Date.now()-started;
  const videoBytes=await readFile(path.join(directory,'source.mp4'));
  const sheet=await composeSpriteSheetWithFfmpeg({videoBytes,task,duration:5});
  return {bytes:sheet,contentType:'image/png',provider:'fal-video',model:job.model,taskId:job.task?.requestId,videoBytes,videoContentType:'video/mp4',generationMs,elapsedMs:Date.now()-started,postprocessMs:Date.now()-started-generationMs};
}
