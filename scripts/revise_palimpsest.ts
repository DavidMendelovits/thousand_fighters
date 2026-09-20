/** Install explicitly reviewed candidates, checkpointing both sides of the revision. */
import {readFile} from 'node:fs/promises';
import {createPalimpsest} from '../src/characters/palimpsest';
import {palimpsestMotion} from '../shared/palimpsestMotion.js';
import {createCmsStorage} from '../cms/storage/createCmsStorage.js';
import {CharacterContentRepository} from '../cms/repositories/CharacterContentRepository.js';
import {installMotionRow,approveMotionRow} from '../cms/pipeline/motionRowArtifacts.js';
import {loadReviewContext,motionFingerprint} from '../cms/pipeline/reviewFingerprint.js';
import {exportCharacterToRuntime} from '../cms/export/exportCharacterToRuntime.js';
const plan=JSON.parse(await readFile(process.argv[2],'utf8'));
const storage=createCmsStorage(),repository=new CharacterContentRepository(storage),characterId='palimpsest';
await repository.withMutation(characterId,async()=>{
 let draft=await repository.getDraft(characterId);
 const before=await repository.createVersion(characterId,draft,{label:'Before expanded shapes and attached hand grip'});
 for(const [action,selection] of Object.entries(plan) as any){
  if(!selection.notes)throw new Error(`Missing review: ${action}`);
  await installMotionRow({characterId,directory:selection.directory,storage,repository,contactFrame:selection.contact,recoveryFrame:selection.recovery});
  await approveMotionRow({repository,characterId,action,notes:selection.notes,expectedFingerprint:(await motionFingerprint(await loadReviewContext(repository,characterId),action)).fingerprint});
 }
 draft=await repository.getDraft(characterId);
 const pinch=createPalimpsest().moves.find(m=>m.id==='hands_pinch')!;
 // The grip section is driven by capture progress; startup/recovery remain authored.
 draft.moves=draft.moves.map((m:any)=>m.id===pinch.id?{...pinch,visualTimeline:m.visualTimeline}:m);
 draft.motionPrompts=palimpsestMotion;
 draft.sprite.rowPlayback.block={durationTicks:10,loop:false};
 draft.sprite.rowPlayback.hands_idle={ticksPerFrame:3,loop:true};
 for(const actor of draft.actors??[])actor.sprite.rowPlayback=draft.sprite.rowPlayback;
 await repository.saveDraft(characterId,draft,{provider:'reviewed-shape-and-grip-revision'});
 const after=await repository.createVersion(characterId,draft,{label:'Expanded paint shapes and torso-attached needle hands'});
 await exportCharacterToRuntime({runtime:{repository,storage},characterId});
 console.log(JSON.stringify({before:before.versionId,after:after.versionId,rows:Object.keys(plan)}));
});
