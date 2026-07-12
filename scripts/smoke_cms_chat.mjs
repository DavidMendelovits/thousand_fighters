import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCmsServer } from '../cms/server/createCmsServer.js';
import { createLocalCmsRuntime } from '../cms/runtime/createLocalCmsRuntime.js';

const rootDir = await mkdtemp(path.join(os.tmpdir(), 'thousand-fighters-chat-'));
const runtime = createLocalCmsRuntime({
  storageOptions: {
    provider: 'file',
    rootDir,
  },
});
const server = createCmsServer({ runtime });

try {
  await listen(server);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const health = await getJson(`${baseUrl}/api/chat/health`);
  assert.equal(health.agent.provider, 'local');
  assert.equal(health.agent.status, 'warning');

  const created = await postChat(baseUrl, {
    message: 'Create a character draft with id chat_fighter. Brief: A quick CMS test fighter with one readable projectile.',
  });
  assert.equal(created.ok, true);
  assert.equal(created.result.toolCalls[0].name, 'create_character_draft');
  assert.equal(created.result.toolCalls[0].status, 'success');
  assert.equal(created.result.toolCalls[0].result.draft.id, 'chat_fighter');

  const updated = await postChat(baseUrl, {
    characterId: 'chat_fighter',
    message: 'Update displayName to Chat Champion. Set health to 1200.',
  });
  assert.equal(updated.result.toolCalls[0].name, 'update_character_draft');
  assert.equal(updated.result.toolCalls[0].status, 'success');
  assert.equal(updated.result.toolCalls[0].result.draft.displayName, 'Chat Champion');
  assert.equal(updated.result.toolCalls[0].result.draft.stats.maxHealth, 1200);

  const assets = await postChat(baseUrl, {
    characterId: 'chat_fighter',
    message: 'List assets for this character.',
  });
  assert.equal(assets.result.toolCalls[0].name, 'get_character_assets');

  const status = await postChat(baseUrl, {
    message: 'Check pipeline status.',
  });
  assert.equal(status.result.toolCalls[0].name, 'get_pipeline_status');

  console.log(`CMS chat smoke test passed: ${rootDir}`);
} finally {
  await close(server);
  await rm(rootDir, { force: true, recursive: true });
}

async function postChat(baseUrl, body) {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseJsonResponse(response);
}

async function getJson(url) {
  const response = await fetch(url);
  return parseJsonResponse(response);
}

async function parseJsonResponse(response) {
  const text = await response.text();
  assert.ok(response.status >= 200 && response.status < 300, text);
  return JSON.parse(text);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
