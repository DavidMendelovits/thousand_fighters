import {createCmsStorage} from '../cms/storage/createCmsStorage.js';
import {CharacterContentRepository} from '../cms/repositories/CharacterContentRepository.js';
import {palimpsestMotion} from '../shared/palimpsestMotion.js';
const repository=new CharacterContentRepository(createCmsStorage());
await repository.withMutation('palimpsest',async()=>{
 const draft=await repository.getDraft('palimpsest');
 draft.artStyle='paint';draft.motionPrompts=palimpsestMotion;
 draft.motionActors=Object.fromEntries(['hands_idle','needle_thrust','hands_pinch','hands_recall'].map(row=>[row,'hands']));
 await repository.saveDraft('palimpsest',draft,{provider:'paint-authoring-profile'});
 const version=await repository.createVersion('palimpsest',draft,{label:'Paint-aware workbench regeneration profile'});
 console.log(JSON.stringify({versionId:version.versionId}));
});
