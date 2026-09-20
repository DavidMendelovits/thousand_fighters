// Read-only: validate every currently previewable CMS row without API calls,
// generation, normalization, approval or publication.
import {FileCmsStorage} from '../cms/storage/FileCmsStorage.js';
import {CharacterContentRepository} from '../cms/repositories/CharacterContentRepository.js';
import {workbenchLibrary,workbenchReviewClip} from '../cms/authoring/workbenchLibrary.js';
import {parseAnimationClip} from '../shared/animationClip.ts';
const repository=new CharacterContentRepository(new FileCmsStorage());
for(const method of ['getDraft','listCharacterAssets']){
  const original=repository[method].bind(repository),cache=new Map();
  repository[method]=id=>{if(!cache.has(id))cache.set(id,original(id));return cache.get(id);};
}
let checked=0;
const failures=[];
for(const character of await workbenchLibrary(repository))for(const row of character.rows.filter(row=>row.clipUrl&&row.available===row.frameCount)){
  try{parseAnimationClip(await workbenchReviewClip(repository,character.id,row.row));checked++;}
  catch(error){failures.push({character:character.id,row:row.row,error:error.message});}
}
console.log(JSON.stringify({checked,failures,scope:'Geometry and schema only; not visual approval.'},null,2));
if(failures.length)process.exitCode=1;
