import {readdir,readFile} from 'node:fs/promises';
import {createCmsStorage} from '../cms/storage/createCmsStorage.js';
const storage=createCmsStorage();
const root=process.argv[2]??'generated/david-watercolor/expanded-moves-v1';
let count=0;
for(const dir of await readdir(root)){
 if(!dir.endsWith('-source'))continue;
 const job=JSON.parse(await readFile(`${root}/${dir}/job.json`,'utf8'));const a=job.generationAttempt;
 if(!a?.completedAt)continue;
 const key=`benchmarks/generation-attempts/${a.startedAt.slice(0,10)}/${a.attemptId}-${a.completedAt.replaceAll(':','-').replaceAll('.','-')}.json`;
 await storage.putJson(key,{schemaVersion:1,...a,kind:'video',provider:job.provider,model:job.model,operation:job.mode,characterId:'david',moveId:dir.slice(0,-7),providerTaskId:job.task?.requestId,attemptNumber:job.submissionAttempts,stageTimings:job.timings,estimatedCostUsd:null,benchmarkKey:key,...(job.lastError?{error:job.lastError}:{})});count++;
}
console.log(`Archived ${count} completed attempt records`);
