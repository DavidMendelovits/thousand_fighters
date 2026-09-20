import {runVideoJob} from './generate_animation_video.mjs';
import {createCmsStorage} from '../cms/storage/createCmsStorage.js';
import {motionProfile} from '../cms/pipeline/motionProfiles.js';
const [image,output,provider='pruna',action='walk_forward',recipe='speed',endLock]=process.argv.slice(2);
if(!image||!output||!['pruna','fal'].includes(provider))throw new Error('Usage: benchmark_character_video.mjs IMAGE OUTPUT [pruna|fal] [ACTION] [speed|quality]');
const storage=createCmsStorage();
const prompt=`Animate the exact hand-painted watercolor character in the reference. Preserve his face, hair, patterned shirt, BLUE JEANS and pale sneakers, proportions, brush outlines and pigment texture. Fixed orthographic SIDE camera. Always face RIGHT. Single character, full body and both feet visible with 15 percent safe margins on all sides. FLAT #ff00ff background throughout, no scenery or ground shadow. Do not paint the background. No zoom or cuts, no turn toward camera. BODY PASS ONLY: no paint splashes, flying objects or effects. Microphone remains held in one hand. ${motionProfile(action).prompt}`;
await runVideoJob({provider,mode:'image-to-video',image,prompt,output,duration:5,...(endLock==='end-lock'?{'end-image':image}:{}),...(provider==='pruna'?{resolution:'480p',recipe}: {})},{storage,characterId:'david',moveId:action,onGenerationAttempt:async event=>{
  const key=`benchmarks/generation-attempts/${event.startedAt.slice(0,10)}/${event.attemptId}-${event.completedAt.replaceAll(':','-')}.json`;
  await storage.putJson(key,{...event,characterId:'david',moveId:action,operation:'watercolor-video-comparison',benchmarkKey:key});
}});
