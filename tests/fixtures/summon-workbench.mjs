// Isolated, keyless workbench fixture for manual/browser regression. Not a
// production character installer. All data lives in a disposable temp root.
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createLocalCmsRuntime} from '../../cms/runtime/createLocalCmsRuntime.js';
import {FileCmsStorage} from '../../cms/storage/FileCmsStorage.js';
import {createCmsServer} from '../../cms/server/createCmsServer.js';
import {createMockTextModel} from '../../cms/pipeline/adapters/mockAdapters.js';
delete process.env.FAL_KEY;
delete process.env.PRUNA_API_KEY;
const root=await mkdtemp(path.join(os.tmpdir(),'summon-workbench-'));
const runtime=createLocalCmsRuntime({storage:new FileCmsStorage({rootDir:root}),
  textModel:createMockTextModel(),imageGeneratorOptions:{provider:'mock'}});
const draft=await runtime.pipeline.createCharacterDraft({characterId:'summon_contract_test',brief:'A paint creature with independent floating hands.'});
draft.actors=[{id:'hands',summon:true,idleAnimation:'hands_idle',description:'Two floating painted hands and a needle; no body'}];
await runtime.repository.saveDraft(draft.id,draft);
const server=createCmsServer({runtime});
server.listen(8796,'127.0.0.1',()=>console.log('Keyless fixture: http://127.0.0.1:8796/roster/summon_contract_test?standalone=1'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
  server.closeAllConnections();
  server.close(async()=>{await rm(root,{recursive:true,force:true});process.exit();});
});
