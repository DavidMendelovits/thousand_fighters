import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CodexTextModelAdapter } from '../cms/pipeline/adapters/codexTextModelAdapter.js';

test('Codex text adapter reads the final message rather than an echoed schema', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codex-final-message-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const executable = path.join(directory, 'fake-codex');
  await writeFile(executable, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const output = args[args.indexOf('--output-last-message') + 1];
process.stdin.resume();
process.stdin.on('end', () => {
  console.log('Echoed schema: {"type":"object","properties":{"moves":{"type":"array"}}}');
  fs.writeFileSync(output, JSON.stringify({displayName:'Eventide', moves:[{id:'a'},{id:'b'},{id:'c'},{id:'d'}]}));
});
`);
  await chmod(executable, 0o755);
  const adapter = new CodexTextModelAdapter({ codexBin: executable, timeoutMs: 5000 });
  const result = await adapter.completeStructured({ task: 'character-content-draft', input: { characterId: 'eventide', brief: 'A living observatory' } });
  assert.equal(result.value.displayName, 'Eventide');
  assert.equal(result.value.moves.length, 4);
});
