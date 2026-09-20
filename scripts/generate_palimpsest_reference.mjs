import {readFile,mkdir,writeFile,access} from 'node:fs/promises';
import {BflFluxKleinGeneratorAdapter} from '../cms/pipeline/adapters/bflFluxKleinGeneratorAdapter.js';
import {createCmsStorage} from '../cms/storage/createCmsStorage.js';
const [referenceFolder,kind='body',version='v1']=process.argv.slice(2);
if(!referenceFolder || !['body','hands'].includes(kind) || !/^v\d+$/.test(version))throw new Error('Usage: generate_palimpsest_reference.mjs REFERENCE_FOLDER body|hands vN');
const output=`generated/palimpsest/${kind}-${version}`;
await mkdir(output,{recursive:true});
try{await access(`${output}/request.json`);throw new Error('Attempt exists; choose a new version.');}catch(e){if(e.code!=='ENOENT')throw e;}
const references=await Promise.all([1,2,3].map(async n=>({base64:(await readFile(`${referenceFolder}/${n}-Photo-${n}.jpg`)).toString('base64'),contentType:'image/jpeg'})));
const subject=kind==='body'
 ? 'Design ONE original living-paint creature for a side-view fighting game. Use paintings 2 and 3 as visual inspiration, NOT their rectangular canvas or gallery surroundings. An asymmetric compact vortex core with a single teal spiral eye, molten crimson and vermilion pigment ribbons, lavender channels, golden edges, bold charcoal contour brush lines. Its lower body is a pooled ribbon of paint. Two long tapering paint tendrils curl out of the core. NO human skeleton, no human arms or legs, no clothing, no feet. It must read as an organic surreal abstract painting come alive, not a robot, slime emoji, person or action figure. Facing RIGHT. A coherent memorable silhouette, readable at small game size.'
 : 'Create ONE isolated summoned entity consisting of exactly TWO floating painterly hands and ONE slender grey sewing needle, inspired by painting 1. The upper orange-ochre hand pinches the long needle pointing RIGHT, the lower open hand curls beneath it. The two wrists dissolve into short flowing crimson and lavender brush ribbons, no person or arms attached. Preserve bold charcoal drawn contours and hand-painted acrylic brush texture. Compact side-view arrangement, clear silhouette. The pair is one game entity. No thread, no surrounding painting.';
const prompt=`${subject} Rich opaque hand-painted acrylic texture INSIDE the silhouette, not photorealistic, not vector. Square canvas. Entire subject occupies central 50 percent with very generous empty margins. Exact flat uniform solid #ff00ff background, no ground, no shadow, no paper texture outside subject, no text, no border, no other objects. Palette excludes bright magenta so background can be removed.`;
await writeFile(`${output}/request.json`,JSON.stringify({prompt,referenceFolder,kind,provider:'bfl-klein'},null,2));
const storage=createCmsStorage();
const result=await new BflFluxKleinGeneratorAdapter().generateImage({task:'character-concept',prompt,referenceImages:references,context:{characterId:'palimpsest',artStyle:'paint'},onGenerationAttempt:async event=>{
 await writeFile(`${output}/attempt.json`,JSON.stringify(event,null,2));
 const key=`benchmarks/generation-attempts/${event.startedAt.slice(0,10)}/${event.attemptId}-${event.completedAt.replaceAll(':','-')}.json`;
 await storage.putJson(key,{...event,characterId:'palimpsest',operation:`${kind}-reference`,benchmarkKey:key});
}});
await writeFile(`${output}/reference.png`,result.bytes);
console.log(JSON.stringify({output,model:result.model,elapsedMs:result.elapsedMs}));
