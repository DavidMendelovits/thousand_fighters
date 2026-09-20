import { readFile, mkdir, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runVideoJob } from './generate_animation_video.mjs';
import { motionProfile } from '../cms/pipeline/motionProfiles.js';
import { createCmsStorage } from '../cms/storage/createCmsStorage.js';
const exec=promisify(execFile);
const [character,action,version='v1']=process.argv.slice(2);
for(const value of [character,action,version])if(!/^[a-z][a-z0-9_-]*$/.test(value??''))throw new Error('Usage: generate_character_motion.mjs CHARACTER ACTION [VERSION]');
const root=`generated/character-motion/${character}`,output=`${root}/${action}-${version}`;
await mkdir(root,{recursive:true});
const config=JSON.parse(await readFile(`public/fighters/${character}/config.json`,'utf8'));
const reference=`${root}/reference.png`;
try{await access(reference);}catch{
  await exec('python3',['scripts/prepare_animation_reference.py',`public/fighters/${character}/${config.sprite.frames.base[0].file}`,'--output',reference,'--size','768','--occupancy','0.6']);
}
const profile=motionProfile(action,config.moves.find(m=>m.animation===action)?.description);
const prompt=`Animate this exact pixel-art fighter. Preserve face, hair, colorful costume, proportions, pixel-art outlines and palette throughout. Fixed orthographic side camera, fighter always faces RIGHT, entire body inside frame with generous margins. Single actor, flat solid #ff00ff background, no floor shadow, no text, no camera pan/zoom, no scene change. Crisp expressive 2D fighting-game character animation, not a 3D toy. ${profile.prompt}`;
let resume=false;try{await access(`${output}/job.json`);resume=true;}catch{}
const storage=createCmsStorage();
await runVideoJob(resume?{resume:output}:{provider:'fal',mode:'image-to-video',image:reference,prompt,duration:profile.duration,output},{
  storage, characterId:character, moveId:action,
  onGenerationAttempt:async event=>{
    const key=`benchmarks/generation-attempts/${event.startedAt.slice(0,10)}/${event.attemptId}-${event.completedAt.replaceAll(':','-').replaceAll('.','-')}.json`;
    await storage.putJson(key,{...event,characterId:character,moveId:action,operation:'character-motion',benchmarkKey:key});
  },
});
