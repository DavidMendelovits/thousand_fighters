import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalCodexCliCmsModule } from '../cms/codex/createLocalCodexCliCmsModule.js';

const rootDir = await mkdtemp(path.join(os.tmpdir(), 'thousand-fighters-codex-cli-module-'));
const capturedExecs = [];

try {
  const module = createLocalCodexCliCmsModule({
    model: 'gpt-test-codex-cli',
    cwd: process.cwd(),
    runtimeOptions: {
      storageOptions: {
        provider: 'file',
        rootDir,
      },
    },
    execFile: asyncExecFile,
  });

  const health = await module.healthCheck();
  assert.equal(health.codex.status, 'ok');
  assert.equal(health.codex.message, 'Logged in using ChatGPT');
  assert.equal(health.codex.model, 'gpt-test-codex-cli');

  const tools = module.listFunctions();
  assert.equal(tools.some((tool) => tool.name === 'get_pipeline_status'), true);

  const result = await module.run('Check pipeline status.');
  assert.equal(result.provider, 'codex-cli');
  assert.equal(result.moduleId, 'local-codex-cli-cms-module');
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].name, 'get_pipeline_status');
  assert.equal(result.toolCalls[0].status, 'success');
  assert.equal(result.message, 'Pipeline status checked locally.');

  assert.equal(capturedExecs[0].args.join(' '), 'login status');
  const firstPlanner = capturedExecs.find((call) => call.args.includes('exec'));
  assert.ok(firstPlanner);
  assert.equal(firstPlanner.args.includes('--sandbox'), true);
  assert.equal(firstPlanner.args[firstPlanner.args.indexOf('--sandbox') + 1], 'read-only');
  assert.equal(firstPlanner.args.includes('--output-schema'), true);
  assert.equal(firstPlanner.args.at(-1), '-');
  assert.match(firstPlanner.options.input, /Available CMS functions/);

  console.log(`CMS Codex CLI module smoke test passed: ${rootDir}`);
} finally {
  await rm(rootDir, { force: true, recursive: true });
}

function asyncExecFile(_file, args, options, callback) {
  capturedExecs.push({ args, options });

  if (args[0] === 'login' && args[1] === 'status') {
    callback(null, 'Logged in using ChatGPT\n', '');
    return;
  }

  const outputPath = args[args.indexOf('--output-last-message') + 1];
  const prompt = options.input;
  const hasObservation = prompt.includes('adapterHealth');
  const plan = hasObservation
    ? {
        message: 'Pipeline status checked locally.',
        done: true,
        toolCalls: [],
      }
    : {
        message: 'I will inspect the pipeline status.',
        done: false,
        toolCalls: [
          {
            name: 'get_pipeline_status',
            inputJson: '{}',
            reason: 'The user asked for pipeline status.',
          },
        ],
      };

  writeFile(outputPath, JSON.stringify(plan), 'utf8')
    .then(() => callback(null, '', ''))
    .catch((error) => callback(error, '', ''));
}
