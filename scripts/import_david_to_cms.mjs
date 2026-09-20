import { readFile, readdir } from 'node:fs/promises';
import { importExistingFightersToCms } from '../cms/import/importExistingFighters.js';
import { createCmsStorage } from '../cms/storage/createCmsStorage.js';
import { CharacterContentRepository } from '../cms/repositories/CharacterContentRepository.js';
import { convertDraftToCharacterConfig } from '../cms/export/convertDraftToCharacterConfig.js';
import assert from 'node:assert/strict';

const storage=createCmsStorage(), repository=new CharacterContentRepository(storage);
await importExistingFightersToCms({storage,repository,fighterIds:['david']});
const root='public/fighters/david', assetRoot='characters/david/assets/fighter-pack';
async function copy(dir='') {
  for(const e of await readdir(`${root}/${dir}`,{withFileTypes:true})) {
    const relative=dir?`${dir}/${e.name}`:e.name;
    if(e.isDirectory())await copy(relative);
    else {
      const bytes=await readFile(`${root}/${relative}`);
      await storage.putBytes(`${assetRoot}/${relative}`,bytes,{contentType:e.name.endsWith('.png')?'image/png':e.name.endsWith('.json')?'application/json':'text/plain'});
      // Remove only byte-identical duplicate files just created by the legacy importer.
      const duplicate=`characters/david/assets/${relative}`;
      if(await storage.exists(duplicate) && (await storage.getBytes(duplicate)).equals(bytes))await storage.delete(duplicate);
    }
  }
}
await copy();
const config=JSON.parse(await readFile(`${root}/config.json`,'utf8'));
const draft=await repository.getDraft('david');
Object.assign(draft,{rosterGroup:config.rosterGroup,concept:config.concept,pushboxWidth:config.pushboxWidth,combatStats:config.stats,comboRoutes:config.comboRoutes,geometryMode:'authored-runtime',sprite:{...draft.sprite,...config.sprite,scaleMode:'authored-reference'},source:{...draft.source,runtimeConfigSource:'public/fighters/david/config.json'}});
draft.assets.rootKey=assetRoot;
draft.projectiles=[];
for(const move of draft.moves)for(const phase of move.phases)for(const {event} of phase.events)if(event.projectile){
  event.projectile.velocity ??= {x:event.projectile.speed,y:0,relativeToFacing:true};
  if(!draft.projectiles.some(p=>p.id===event.projectile.id))draft.projectiles.push(structuredClone(event.projectile));
  event.projectileId=event.projectile.id;delete event.projectile;
}
draft.combos=config.comboRoutes.map((route,index)=>({id:`david_route_${index+1}`,name:route.name,segments:route.moves,description:route.purpose}));
for(const [key,file] of Object.entries({manifestKey:'manifest.json',frameDataKey:'frameData.json',normalizationReportKey:'normalization-report.json',descriptionKey:'description.txt',movesetKey:'moveset.txt'}))draft.assets[key]=`${assetRoot}/${file}`;
await repository.saveDraft('david',draft,{provider:'bfl-key-pose-import'});
const exported=convertDraftToCharacterConfig({draft,frameData:await storage.getJson(`${assetRoot}/frameData.json`),manifest:await storage.getJson(`${assetRoot}/manifest.json`)});
assert.equal(exported.sprite.scale,1);
assert.equal(exported.rosterGroup,'oddities');
assert.equal(exported.moves.length,7);
assert.deepEqual(exported.moves.find(m=>m.id==='mic_reel').extension,config.moves.find(m=>m.id==='mic_reel').extension);
assert.deepEqual(exported.moves.find(m=>m.id==='cascade').cancelInto,config.moves.find(m=>m.id==='cascade').cancelInto);
assert.deepEqual(exported.hurtboxes,config.hurtboxes);
console.log('David imported with canonical fighter pack. CMS re-export preserves scale, collisions, moves and cable.');
