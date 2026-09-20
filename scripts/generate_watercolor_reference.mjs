import {readFile,mkdir,writeFile,access} from 'node:fs/promises';
import {BflFluxKleinGeneratorAdapter} from '../cms/pipeline/adapters/bflFluxKleinGeneratorAdapter.js';
import {createCmsStorage} from '../cms/storage/createCmsStorage.js';

const [photo,output='generated/david-watercolor/reference-v1']=process.argv.slice(2);
if(!photo)throw new Error('Usage: generate_watercolor_reference.mjs OUTFIT_PHOTO [OUTPUT_DIRECTORY]');
await mkdir(output,{recursive:true});
try{await access(`${output}/request.json`);throw new Error('Reference attempt already exists; use a new version.');}catch(error){if(error.code!=='ENOENT')throw error;}
const prompt='Create ONE full-body 2D watercolor fighting-game character based on the man in the reference photograph. Preserve his recognizable narrow face, swept medium brown hair, slim adult build, vivid red yellow teal blue abstract patchwork short-sleeved button-up shirt tucked into medium BLUE JEANS, belt, and light off-white sneakers. Side view facing RIGHT with a slight three-quarter face, energetic balanced fighting-ready pose, knees gently bent, feet apart. Holds a small silver handheld microphone in one hand near his chest; free hand open ready to paint. The character himself is beautifully hand-painted WATERCOLOR: luminous translucent pigment washes inside a clearly readable silhouette, visible paper-grain texture within clothing and skin, subtle dark indigo brush outlines, warm expressive face, dimensional brushwork. Not a photograph, not 3D, not a plastic action figure, not vector art. No scenery, no fire, no mic stand, no audience. Flat exact solid #ff00ff background with NO texture or shadow on the background. Whole body occupies central 60 percent of a square canvas with generous empty margins on every side. No floating paint or projectiles in this BODY REFERENCE. No text or logos. Keep both feet and the microphone completely inside the frame.';
await writeFile(`${output}/request.json`,JSON.stringify({prompt,photo,provider:'bfl-klein'},null,2));
const storage=createCmsStorage();
const result=await new BflFluxKleinGeneratorAdapter().generateImage({task:'character-concept',prompt:prompt+' IMPORTANT: one hand FIRMLY GRIPS the microphone handle with fingers visibly wrapped around it. Microphone must touch that hand, never float. This is painterly watercolor, NOT pixel art.',referenceImages:[{base64:(await readFile(photo)).toString('base64'),contentType:'image/jpeg'}],context:{characterId:'david',artStyle:'watercolor'},onGenerationAttempt:async event=>{
  await writeFile(`${output}/attempt.json`,JSON.stringify(event,null,2));
  const key=`benchmarks/generation-attempts/${event.startedAt.slice(0,10)}/${event.attemptId}-${event.completedAt.replaceAll(':','-')}.json`;
  await storage.putJson(key,{...event,operation:'watercolor-reference',benchmarkKey:key});
}});
await writeFile(`${output}/reference.png`,result.bytes);
console.log(JSON.stringify({output:`${output}/reference.png`,elapsedMs:result.elapsedMs,model:result.model}));
