// Default browser tests must never populate the everyday CMS or spend credits.
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createLocalCmsRuntime} from '../../cms/runtime/createLocalCmsRuntime.js';
import {FileCmsStorage} from '../../cms/storage/FileCmsStorage.js';
import {createCmsServer} from '../../cms/server/createCmsServer.js';
import {createMockTextModel} from '../../cms/pipeline/adapters/mockAdapters.js';
// Also stay keyless when Playwright itself is launched under Doppler.
for (const key of Object.keys(process.env)) {
  if (/^(OPENAI|MINIMAX|BFL|FAL|PRUNA|GEMINI|GOOGLE|ELEVENLABS|REPLICATE)_/.test(key)) delete process.env[key];
}
process.env.SOUND_GENERATOR_PROVIDER='local';
process.env.JOB_QUEUE_PROVIDER='memory';
const root=await mkdtemp(path.join(os.tmpdir(),'admin-browser-tests-'));
const runtime=createLocalCmsRuntime({storage:new FileCmsStorage({rootDir:root}),textModel:createMockTextModel(),imageGeneratorOptions:{provider:'mock'}});
const server=createCmsServer({runtime});
server.listen(Number(process.env.TEST_CMS_PORT??8798),'127.0.0.1',()=>console.log('Isolated browser-test CMS ready'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
  server.closeAllConnections();server.close(async()=>{await rm(root,{recursive:true,force:true});process.exit();});
});
