import {createCmsStorage} from '../cms/storage/createCmsStorage.js';
import {CharacterContentRepository} from '../cms/repositories/CharacterContentRepository.js';
import {expandDavidMoveset} from '../cms/content/davidMoveset.js';
import {validateCombatRules} from '../cms/export/validateCombatRules.js';
const repository=new CharacterContentRepository(createCmsStorage());
const original=await repository.getDraft('david');
const draft=expandDavidMoveset(original);
validateCombatRules(draft);
if(process.argv.includes('--apply')){
  const before=await repository.createVersion('david',original,{label:'Before directional strings v2'});
  await repository.saveDraft('david',draft,{provider:'authored-directional-strings-v2'});
  const after=await repository.createVersion('david',draft,{label:'Directional strings v2 - proxy art - unpublished'});
  console.log(JSON.stringify({before:before.versionId,after:after.versionId,moves:draft.moves.length,published:false}));
}else console.log(JSON.stringify({moves:draft.moves.length,routes:draft.comboRoutes.length,apply:'Pass --apply to stage a versioned draft'}));
