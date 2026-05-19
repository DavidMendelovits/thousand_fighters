#!/usr/bin/env node

import { stdin } from 'node:process';
import { createLocalCodexCliCmsModule } from '../cms/codex/createLocalCodexCliCmsModule.js';
import { createLocalCodexCmsModule } from '../cms/codex/createLocalCodexCmsModule.js';

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const module = createModule(args.provider);

if (args.listFunctions) {
  printJson({ functions: module.listFunctions() });
  process.exit(0);
}

if (args.health) {
  printJson(await module.healthCheck());
  process.exit(0);
}

const stdinMessage = stdin.isTTY ? '' : await readStdin();
const message = [args.message.join(' '), stdinMessage].filter(Boolean).join('\n').trim();

if (!message) {
  printHelp();
  process.exitCode = 1;
} else {
  const result = await module.run({
    message,
    characterId: args.characterId,
    sourceAssetKey: args.sourceAssetKey,
    normalizedKey: args.normalizedKey,
    previousResponseId: args.previousResponseId,
  });

  if (args.json) {
    printJson(result);
  } else {
    printTextResult(result);
  }
}

function parseArgs(rawArgs) {
  const parsed = {
    message: [],
    provider: process.env.CODEX_CMS_PROVIDER ?? (process.env.OPENAI_API_KEY ? 'responses' : 'codex-cli'),
    json: false,
    health: false,
    listFunctions: false,
    help: false,
    characterId: '',
    sourceAssetKey: '',
    normalizedKey: '',
    previousResponseId: '',
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === '--json') parsed.json = true;
    else if (arg === '--provider') parsed.provider = rawArgs[++index] ?? parsed.provider;
    else if (arg.startsWith('--provider=')) parsed.provider = arg.slice('--provider='.length);
    else if (arg === '--health') parsed.health = true;
    else if (arg === '--list-functions') parsed.listFunctions = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--character') parsed.characterId = rawArgs[++index] ?? '';
    else if (arg.startsWith('--character=')) parsed.characterId = arg.slice('--character='.length);
    else if (arg === '--source-asset') parsed.sourceAssetKey = rawArgs[++index] ?? '';
    else if (arg.startsWith('--source-asset=')) parsed.sourceAssetKey = arg.slice('--source-asset='.length);
    else if (arg === '--normalized') parsed.normalizedKey = rawArgs[++index] ?? '';
    else if (arg.startsWith('--normalized=')) parsed.normalizedKey = arg.slice('--normalized='.length);
    else if (arg === '--previous-response') parsed.previousResponseId = rawArgs[++index] ?? '';
    else if (arg.startsWith('--previous-response=')) parsed.previousResponseId = arg.slice('--previous-response='.length);
    else parsed.message.push(arg);
  }

  return parsed;
}

function createModule(provider) {
  if (provider === 'codex-cli') return createLocalCodexCliCmsModule();
  if (provider === 'responses') return createLocalCodexCmsModule();
  throw new Error(`Unsupported Codex CMS provider: ${provider}`);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stdin.setEncoding('utf8');
    stdin.on('data', (chunk) => chunks.push(chunk));
    stdin.on('end', () => resolve(chunks.join('').trim()));
    stdin.on('error', reject);
  });
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printTextResult(result) {
  process.stdout.write(`${result.message ?? 'Done.'}\n`);
  if (result.responseId) process.stdout.write(`responseId: ${result.responseId}\n`);
  if (result.toolCalls?.length) {
    process.stdout.write('\nTool calls:\n');
    for (const call of result.toolCalls) {
      process.stdout.write(`- ${call.name}: ${call.status}\n`);
      if (call.error) process.stdout.write(`  ${call.error}\n`);
    }
  }
}

function printHelp() {
  process.stdout.write(`Usage:
  npm run cms:codex:local -- --health
  npm run cms:codex:local -- --list-functions
  npm run cms:codex:local -- "Check pipeline status"
  npm run cms:codex:local -- --character janitor "List this fighter's assets"
  OPENAI_API_KEY=... npm run cms:codex:local -- --provider responses "Check pipeline status"

Options:
  --provider <name>          codex-cli or responses. Defaults to codex-cli unless OPENAI_API_KEY is set.
  --json                    Print the full result as JSON.
  --health                  Print module, agent, and pipeline health.
  --list-functions          Print the CMS function catalog.
  --character <id>          Provide current character context.
  --source-asset <key>      Provide current source sheet storage key.
  --normalized <key>        Provide current normalized manifest key.
  --previous-response <id>  Continue a prior Responses API conversation.

Env:
  CODEX_CMS_PROVIDER              codex-cli or responses.
  CODEX_CLI_MODEL                 Defaults to gpt-5.3-codex for codex-cli provider.
  OPENAI_API_KEY                  Required only for --provider responses.
  OPENAI_CODEX_MODEL              Defaults to gpt-5.3-codex for responses provider.
  OPENAI_CODEX_REASONING_EFFORT   Defaults to medium for responses provider.
  CMS_STORAGE_PROVIDER            Uses the same CMS storage env as the admin server.
`);
}
