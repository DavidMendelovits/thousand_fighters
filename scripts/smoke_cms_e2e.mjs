import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCmsServer } from '../cms/server/createCmsServer.js';
import { createLocalCmsRuntime } from '../cms/runtime/createLocalCmsRuntime.js';

const rootDir = await mkdtemp(path.join(os.tmpdir(), 'thousand-fighters-e2e-'));
// Keep the publish->runtime bridge from writing the repo's real public/ dir.
process.env.CMS_RUNTIME_PUBLIC_DIR = path.join(rootDir, 'public');
const runtime = createLocalCmsRuntime({
  storageOptions: {
    provider: 'file',
    rootDir,
  },
  // Keyless run: mock the API-backed adapters so this smoke needs no env vars.
  textModelOptions: { provider: 'mock' },
  imageGeneratorOptions: { provider: 'mock' },
  soundGeneratorOptions: { provider: 'mock' },
});
const server = createCmsServer({ runtime });

try {
  await listen(server);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const health = await getJson(`${baseUrl}/api/health`);
  assert.equal(health.ok, true);

  const draft = await postTool(baseUrl, 'create_character_draft', {
    characterId: 'e2e_fighter',
    brief: 'A local end-to-end validation fighter.',
  });
  assert.equal(draft.result.draft.id, 'e2e_fighter');

  const sheet = await postTool(baseUrl, 'generate_sprite_sheet', {
    characterId: 'e2e_fighter',
    prompt: '5x6 fighter sheet with magenta background.',
  });
  const sourceAssetKey = sheet.result.asset.key;
  assert.equal(sourceAssetKey, 'characters/e2e_fighter/assets/source/e2e_fighter_base_sheet.png');
  assert.equal((await runtime.storage.getMetadata(sourceAssetKey)).contentType, 'image/png');

  const assetResponse = await fetch(`${baseUrl}/api/assets/${encodeURIComponent(sourceAssetKey)}`);
  assert.equal(assetResponse.status, 200);
  assert.equal(assetResponse.headers.get('content-type'), 'image/png');
  assert.ok((await assetResponse.arrayBuffer()).byteLength > 0);

  const normalized = await postTool(baseUrl, 'normalize_sprite_pack', {
    characterId: 'e2e_fighter',
    sourceAssetKey,
  });
  assert.equal(normalized.result.normalized.status, 'pass');
  assert.equal(normalized.result.normalized.assetRootKey, 'characters/e2e_fighter/assets/fighter-pack');
  assert.ok(normalized.result.normalized.copiedFileCount > 30);

  const manifest = await runtime.storage.getJson(normalized.result.normalized.outputKey);
  assert.equal(manifest.cms.workflow, 'local-fixture-normalizer');
  assert.equal(manifest.cms.fixtureFighterId, 'janitor');
  assert.equal(manifest.frameCounts.base, 6);

  const firstSprite = await runtime.storage.getBytes('characters/e2e_fighter/assets/fighter-pack/sprites/base/base_001.png');
  assert.equal(firstSprite.subarray(1, 4).toString('ascii'), 'PNG');

  const uploadedFrame = await postJson(`${baseUrl}/api/characters/e2e_fighter/assets`, {
    relativePath: 'sprites/punch/punch_999.png',
    contentBase64: firstSprite.toString('base64'),
    contentType: 'image/png',
    metadata: {
      source: 'cms-e2e-test',
    },
  });
  assert.equal(uploadedFrame.ok, true);
  assert.equal(uploadedFrame.asset.relativePath, 'sprites/punch/punch_999.png');
  assert.equal(uploadedFrame.asset.metadata.contentType, 'image/png');

  const uploadedFrameResponse = await fetch(`${baseUrl}${uploadedFrame.asset.apiUrl}`);
  assert.equal(uploadedFrameResponse.status, 200);
  assert.equal(uploadedFrameResponse.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await uploadedFrameResponse.arrayBuffer()).subarray(1, 4).toString('ascii'), 'PNG');

  const tools = await getJson(`${baseUrl}/api/tools`);
  assert.ok(tools.tools.some((tool) => tool.name === 'add_character_asset'));

  const uploadedProjectile = await postTool(baseUrl, 'add_character_asset', {
    characterId: 'e2e_fighter',
    relativePath: 'projectiles/e2e_projectile.png',
    contentBase64: firstSprite.toString('base64'),
    contentType: 'image/png',
  });
  assert.equal(uploadedProjectile.result.asset.relativePath, 'projectiles/e2e_projectile.png');

  const assets = await getJson(`${baseUrl}/api/characters/e2e_fighter/assets`);
  assert.ok(assets.assets.some((asset) => asset.relativePath === 'fighter-pack/sprites/base/base_001.png'));
  assert.ok(assets.assets.some((asset) => asset.relativePath === 'fighter-pack/sheets/punch.png'));
  assert.ok(assets.assets.some((asset) => asset.relativePath === 'sprites/punch/punch_999.png'));
  assert.ok(assets.assets.some((asset) => asset.relativePath === 'projectiles/e2e_projectile.png'));

  const qa = await postTool(baseUrl, 'validate_fighter_pack', {
    characterId: 'e2e_fighter',
    normalizedKey: normalized.result.normalized.outputKey,
  });
  assert.equal(qa.result.qa.status, 'pass');

  const published = await postTool(baseUrl, 'publish_character', {
    characterId: 'e2e_fighter',
    releaseId: 'e2e-release',
  });
  assert.equal(published.result.published.status, 'published');

  // The publish tool must bridge to the static artifacts the game roster reads:
  // public/fighters/<id>/config.json + an assets-index entry flagging it.
  assert.ok(published.result.exported?.configPath, 'publish must export a runtime config');
  // Export must consume the release bundle (source of truth), not the live draft.
  assert.ok(published.result.published.bundleKey, 'publish must write a release bundle');
  const bundle = await runtime.storage.getJson(published.result.published.bundleKey);
  assert.ok(bundle?.content?.id === 'e2e_fighter', 'release bundle must hold the published content');
  const index = JSON.parse(await readFile(path.join(rootDir, 'public', 'assets-index.json'), 'utf8'));
  assert.equal(index.fighters?.e2e_fighter?.config, 'config.json', 'published fighter must be roster-discoverable');
  // Exported config must carry real content from the published version, not a
  // silent empty fall-through.
  const exportedConfig = JSON.parse(await readFile(path.join(rootDir, 'public', 'fighters', 'e2e_fighter', 'config.json'), 'utf8'));
  assert.equal(exportedConfig.id, 'e2e_fighter', 'exported config must come from the published version');
  assert.ok(Array.isArray(exportedConfig.moves) && exportedConfig.moves.length > 0, 'exported config must have moves');

  const characters = await getJson(`${baseUrl}/api/characters`);
  assert.deepEqual(characters.characters.map((character) => character.id), ['e2e_fighter']);

  console.log(`CMS HTTP e2e smoke test passed: ${rootDir}`);
} finally {
  await close(server);
  await rm(rootDir, { force: true, recursive: true });
}

async function postTool(baseUrl, toolName, input) {
  const response = await fetch(`${baseUrl}/api/tools/${toolName}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonResponse(response);
}

async function getJson(url) {
  const response = await fetch(url);
  return parseJsonResponse(response);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
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
