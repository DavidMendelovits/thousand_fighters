import assert from 'node:assert/strict';
import {createLocalCodexCliCmsModule} from '../cms/codex/createLocalCodexCliCmsModule.js';
import {generateWorkbenchVideoRow} from '../cms/pipeline/adapters/workbenchVideoRow.js';
import {convertDraftToCharacterConfig} from '../cms/export/convertDraftToCharacterConfig.js';
import {readFile} from 'node:fs/promises';

// Exercise the real spawn branch, not the mocked execFile branch: a failed
// process must reject promptly instead of leaving the UI on Thinking forever.
const module = createLocalCodexCliCmsModule({codexBin:'/usr/bin/false', timeoutMs:1000,
  runtime:{tools:{list:()=>[]}}});
await assert.rejects(Promise.race([module.run('Return an error'),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Hung subprocess')),2000))]), /Command failed with code 1/);

// Validation must happen before any paid request.
const previous = process.env.FAL_KEY;
delete process.env.FAL_KEY;
await assert.rejects(generateWorkbenchVideoRow({characterId:'test',moveId:'punch'}), /FAL_KEY is required/);
process.env.FAL_KEY='not-a-real-key';
await assert.rejects(generateWorkbenchVideoRow({characterId:'test',moveId:'punch',storage:{exists:async()=>false}}), /base row/);
if(previous===undefined)delete process.env.FAL_KEY;else process.env.FAL_KEY=previous;

const config=convertDraftToCharacterConfig({draft:{id:'test',stats:{jumpVelocity:-13,jumpBackVelocity:-3.4},moves:[]}});
assert.equal(config.jumpVelocity,13);
assert.equal(config.jumpBackVelocity,3.4);
const app=await readFile('admin/workbenchApplication.js','utf8');
assert.match(app,/data-row-generator/);
assert.match(app,/data-reextract/);
assert.match(app,/data-save-authoring/);
assert.match(app,/runtime export failed/);
console.log('Workbench acceptance regressions passed (no billable calls).');
