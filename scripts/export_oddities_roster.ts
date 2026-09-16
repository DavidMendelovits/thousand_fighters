import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createOdditiesRoster } from '../src/characters/oddities';
import {upgradeOddity,createOddityForm} from '../src/characters/advancedOddities';
const root = resolve(import.meta.dirname, '..');
const roster = createOdditiesRoster();
const signatureMoves: Record<string,string> = {brine:'tidal_reach',taffy:'sugar_straight',vesper:'vesper_sting',vellum:'binding_clause',kiln:'kiln_slam',mycel:'root_ovation',rook:'magnet_mouth',veil:'sleeve_snare',bellwether:'pressure_front'};
for (const fighter of roster) {
  const dir = resolve(root, 'public/fighters', fighter.id);
  const frameData = JSON.parse(await readFile(resolve(dir, 'frameData.json'), 'utf8'));
  fighter.sprite = { basePath: `/fighters/${fighter.id}`, scale: 1, frames: frameData.frames,
    frameCounts: Object.fromEntries(Object.entries(frameData.frames).map(([key, frames]) => [key, (frames as unknown[]).length])), sheets: {},
    stateFrames: { idle: 0, walk_forward: 0, walk_back: 0, crouch: 1, airborne: 1, landing: 1, block: 0, blockstun: 7, hitstun: 7, stunned: 7, grabbed: 7, juggle: 7, dead: 7, knockdown: 7, getup: 1 } };
  if (fighter.id === 'meridian' || signatureMoves[fighter.id]) {
    const fragment = JSON.parse(await readFile(resolve(dir, 'video-signature/runtime-fragment.json'), 'utf8'));
    const frames = fragment.frameData.frames[fragment.animation].map((frame: {file: string}) => ({...frame, file: `video-signature/${frame.file}`}));
    fighter.sprite.frames!.video_signature = frames;
    fighter.sprite.frameCounts.video_signature = frames.length;
    for (const move of fighter.moves) {
      if (move.id === signatureMoves[fighter.id] || (fighter.id === 'meridian' && move.animation === 'special_1')) {
        move.animation = 'video_signature'; move.visualTimeline = fragment.visualTimeline;
      }
    }
    fighter.concept!.artStatus = 'Video-derived signature body motion; generated key poses for other actions. Attached extensions and projectiles are engine-driven.';
  }
  upgradeOddity(fighter);
  fighter.sprite.frames!.dash_forward=[frameData.frames.base[1],frameData.frames.base[2],frameData.frames.base[0]];
  fighter.sprite.frames!.dash_back=[frameData.frames.base[1],frameData.frames.base[0]];
  fighter.sprite.frameCounts.dash_forward=3;fighter.sprite.frameCounts.dash_back=2;
  if(['brine','taffy'].includes(fighter.id)){
    const formId=fighter.id==='brine'?'brine_abyssal':'taffy_sugarstorm';
    const fd=JSON.parse(await readFile(resolve(root,'public/forms',formId,'frameData.json'),'utf8'));
    const sprite={...fighter.sprite,basePath:`/forms/${formId}`,frames:fd.frames,frameCounts:Object.fromEntries(Object.entries(fd.frames).map(([key,value])=>[key,(value as unknown[]).length]))};
    const form=createOddityForm(fighter,formId,sprite);
    fighter.forms=[{id:formId,name:form.displayName,durationTicks:fighter.id==='brine'?720:null,cost:50,config:form}];
    await writeFile(resolve(root,'public/forms',formId,'config.json'),JSON.stringify(form,null,2)+'\n');
    await writeFile(resolve(root,'public/forms',formId,'moveset.json'),JSON.stringify(form.moves,null,2)+'\n');
  }
  await writeFile(resolve(dir, 'config.json'), JSON.stringify(fighter,null,2)+'\n');
  await writeFile(resolve(dir, 'moveset.json'), JSON.stringify(fighter.moves,null,2)+'\n');
  await writeFile(resolve(dir, 'mechanics.md'), `# ${fighter.displayName}\n\n${fighter.concept!.biography}\n\n${fighter.concept!.counterplay}\n\n` + fighter.moves.map(m => `## ${m.displayName}\n\n${m.inputLabel} — ${m.description ?? 'Grounded normal attack.'}\n\n${m.phases.map(p=>`${p.name}: ${p.frames} ticks`).join(', ')} at 60 Hz.\n`).join('\n'));
}
await writeFile(resolve(root,'public/oddities-roster.json'), JSON.stringify(roster,null,2)+'\n');
const galleryPath=resolve(root,'public/animation-lab/index.json');
const gallery=JSON.parse(await readFile(galleryPath,'utf8'));
gallery.clips=gallery.clips.filter((clip:{id:string})=>!clip.id.startsWith('oddities_'));
gallery.clips.push(...roster.map(f=>({id:`oddities_${f.id}`,name:`${f.displayName} · signature`,description:'Video-derived body motion used in the live fight engine. Extensions and collisions are authored separately.',url:`/fighters/${f.id}/video-signature/clip.json`,tags:['generated video','playable','prototype']})));
await writeFile(galleryPath,JSON.stringify(gallery,null,2)+'\n');
console.log(`Exported ${roster.length} original fighters. Existing CMS fighters untouched.`);
