import {access} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
import {runVideoJob} from './generate_animation_video.mjs';
const exec=promisify(execFile);
const jobs=[
 ['vesper','vesper-cast-v1','The cyan jellyfish oracle draws her tendril hands inward, then smoothly extends her right open hand to cast, her bell hood gently rippling, then recovers to the original stance. No detached electricity or glow.'],
 ['vellum','vellum-bind-v1','The moth archivist slowly unfurls his folded moth wings, raises both gloved hands, thrusts the right hand forward in a binding spell gesture, then folds wings and returns to the original stance. No detached pages or effects.'],
 ['kiln','kiln-slam-v1','The squat ceramic kiln golem lowers its weight, draws one huge stone fist back, throws a powerful straight punch toward the RIGHT, recoils its fist and returns to the original stance. Furnace glow stays contained inside the belly.'],
 ['mycel','mycel-roots-v1','The mushroom conductor raises its thin baton arm high, gives a smooth emphatic downward conducting stroke toward the ground to its RIGHT, then returns the arm and body to the original stance. The root spell itself is invisible.'],
 ['rook','rook-magnet-v1','The scrapyard crow mechanic braces its legs, opens its rust orange magnetic gauntlet, reaches its open hand toward the RIGHT, clenches and pulls back, then returns to original stance. No detached metal or sparks.'],
 ['veil','veil-snare-v1','The living empty mourning dress with floating ivory mask extends its pale blue ribbon arms smoothly to the RIGHT, ribbons elongate to twice their length and curl at the tips to catch, then reel back into original posture. Preserve detached floating mask.'],
 ['bellwether','bellwether-wave-v1','The brass bell-headed deep sea diver braces its weighted boots, compresses its huge gauntlets close to its chest, then smoothly thrusts both palms to the RIGHT and slowly retracts them to the original stance. No detached water, wave or effects.'],
];
const queue=[...jobs];
async function worker(){while(queue.length){const [id,name,action]=queue.shift();const dir=resolve('artifacts/animation-video/oddities',name),image=resolve('artifacts/animation-video/oddities',`${id}-reference.png`);
 try{await access(image);}catch{await exec('python3',['scripts/prepare_animation_reference.py',`public/fighters/${id}/portrait.png`,'--output',image]);}
 let resume=false;try{await access(resolve(dir,'job.json'));resume=true;}catch{}
 const prompt=`Locked orthographic SIDE VIEW video-game camera. Exact same single fighter from the reference, facing RIGHT throughout. ${action} One complete smooth action with clear anticipation, activation, recovery. Full body visible. Feet stay planted in the EXACT SAME position. Preserve design, costume, proportions, palette and pixel outlines. Do not add props, opponents or extra anatomy. Solid pure MAGENTA background throughout, no gradient, shadow, scenery, camera motion or zoom. All anatomy remains inside frame with generous margin. Authentic 16-bit pixel art, not 3D or action figures.`;
 await runVideoJob(resume?{resume:dir}:{provider:'fal',mode:'image-to-video',image,'end-image':image,duration:'5',prompt,output:dir},{log:s=>console.log(`[${id}] ${s}`)});
}}
await Promise.all(Array.from({length:3},worker));
