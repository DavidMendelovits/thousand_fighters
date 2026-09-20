import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createCmsStorage} from '../cms/storage/createCmsStorage.js';
import {CharacterContentRepository} from '../cms/repositories/CharacterContentRepository.js';
import {installMotionRow,approveMotionRow,retimeMotion} from '../cms/pipeline/motionRowArtifacts.js';
const planPath=process.argv[2];if(!planPath)throw new Error('Pass reviewed-plan.json');
const plan=JSON.parse(await readFile(planPath,'utf8'));
const storage=createCmsStorage(),repository=new CharacterContentRepository(storage);
await repository.withMutation('david',async()=>{
 await repository.createVersion('david',await repository.getDraft('david'),{label:'Before expanded animation selection'});
 for(const row of plan){
  const directory=row.directory??path.join(path.dirname(planPath),row.action);
  const report=JSON.parse(await readFile(`${directory}/motion.json`,'utf8'));
  if(report.action!==row.action||!row.notes?.trim())throw new Error('Invalid reviewed selection');
  const draft=await repository.getDraft('david');
  const move=draft.moves.find(m=>m.requiredAnimation===row.action);
  if(!move)throw new Error(`No authored move for ${row.action}`);
  await storage.lineage.run({characterId:'david',stage:'expanded-motion-selection',moveId:move.id,inputs:{selection:row,source:await storage.lineage.artifact(await readFile(report.source),{contentType:'video/mp4'}),compiler:await storage.lineage.artifact(await readFile('scripts/compile_character_motion.py'),{contentType:'text/x-python'}),keyer:await storage.lineage.artifact(await readFile('scripts/compile_animation_clip.py'),{contentType:'text/x-python'}),report:await storage.lineage.artifact(await readFile(`${directory}/motion.json`),{contentType:'application/json'})}},async()=>{
   await installMotionRow({characterId:'david',directory,storage,repository,contactFrame:row.contact,recoveryFrame:row.recovery});
   const updated=await repository.getDraft('david'),bound=updated.moves.find(m=>m.id===move.id);
   bound.animation=row.action;bound.artStatus='ready';bound.visualTimeline=retimeMotion(bound,report.frameCount,row.contact,row.recovery);
   await repository.saveDraft('david',updated,{provider:'reviewed-expanded-motion-binding'});
   await approveMotionRow({repository,characterId:'david',action:row.action,notes:row.notes});
  });
  console.log(`Bound reviewed animation ${row.action}`);
 }
 const version=await repository.createVersion('david',await repository.getDraft('david'),{label:'Expanded animation selection - unpublished'});
 console.log(`Checkpoint ${version.versionId}`);
});
