import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {GenerationAttemptLedger} from './GenerationAttemptLedger.js';

/** Rehydrate accepted transport state in a fresh directory: stale local worker
 * locks and lost scratch files cannot cause a second paid submission. */
export async function restoreBuildVideoCheckpoint({storage,characterId,buildJobId,referenceBytes,rootDir=path.resolve('artifacts/workbench-video-jobs')}){
  const keys=await storage.list(`build-attempts/${characterId}/${buildJobId}`),ledger=new GenerationAttemptLedger(storage.lineage);
  const candidates=[];
  for(const key of keys){
    const {attemptId}=await storage.getJson(key),{intent,events}=await ledger.read(attemptId);
    if(intent.characterId!==characterId||intent.buildJobId!==buildJobId)throw new Error('Video checkpoint ownership mismatch.');
    const checkpoint=events.findLast(event=>event.checkpointArtifact);
    if(checkpoint)candidates.push(checkpoint);
  }
  if(candidates.length!==1)throw new Error('Select one accepted video checkpoint from History. No new generation submitted.');
  const job=JSON.parse(await storage.lineage.readArtifact(candidates[0].checkpointArtifact));
  if(!job.task?.requestId&&job.transportStatus!=='downloaded')throw new Error('Video acceptance is uncertain. No persisted task ID; no new generation submitted.');
  await mkdir(rootDir,{recursive:true});const directory=await mkdtemp(path.join(rootDir,'recovered-'));
  for(const {role,artifact} of job.archivedReferences??[]){
    if(!['image','endImage','motion'].includes(role))throw new Error('Unsupported archived reference.');
    const filename=path.join(directory,`${role}.${artifact.contentType==='video/mp4'?'mp4':'png'}`);
    await writeFile(filename,await storage.lineage.readArtifact(artifact),{flag:'wx'});
    if(job.request.references[role])job.request.references[role].path=filename;
  }
  await writeFile(path.join(directory,'sprite.png'),referenceBytes,{flag:'wx'});
  if(job.archivedOutput)await writeFile(path.join(directory,'source.mp4'),await storage.lineage.readArtifact(job.archivedOutput),{flag:'wx'});
  await writeFile(path.join(directory,'job.json'),JSON.stringify(job),{flag:'wx'});
  return directory;
}
