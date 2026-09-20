import {createCmsStorage} from '../cms/storage/createCmsStorage.js';
import {CharacterContentRepository} from '../cms/repositories/CharacterContentRepository.js';
import {installMotionRow,approveMotionRow} from '../cms/pipeline/motionRowArtifacts.js';

const [characterId,directory,reviewNotes,contact,recovery]=process.argv.slice(2);
if(!/^[a-z][a-z0-9_-]*$/.test(characterId??'')||!directory)throw new Error('Usage: import_motion_candidate.mjs CHARACTER DIRECTORY [VISUAL_REVIEW_NOTES]');
const storage=createCmsStorage(),repository=new CharacterContentRepository(storage);
for(const value of [contact,recovery])if(value!==undefined&&!/^\d+$/.test(value))throw new Error('Contact and recovery markers must be nonnegative frame indices');
const result=await installMotionRow({characterId,directory,storage,repository,contactFrame:contact===undefined?undefined:Number(contact),recoveryFrame:recovery===undefined?undefined:Number(recovery)});
const draft=await repository.getDraft(characterId);
draft.requireMotionCoverage=true;
await repository.saveDraft(characterId,draft,{provider:'motion-candidate-import'});
if(reviewNotes)await approveMotionRow({repository,characterId,action:result.action,notes:reviewNotes});
console.log(JSON.stringify({...result,status:reviewNotes?'approved':'needs-visual-review',published:false}));
