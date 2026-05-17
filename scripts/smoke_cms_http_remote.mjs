import assert from 'node:assert/strict';

const baseUrl = (process.env.CMS_BASE_URL ?? process.argv[2] ?? '').replace(/\/$/, '');
if (!baseUrl) {
  throw new Error('Set CMS_BASE_URL or pass the deployed/local CMS URL as the first argument.');
}

const runId = process.env.CMS_SMOKE_RUN_ID ?? `remote_${Date.now()}`;
const characterId = `cms_${runId}`.replace(/[^a-z0-9_-]+/gi, '_').toLowerCase();
const releaseId = `${characterId}_release`;

const health = await getJson('/api/health');
assert.equal(health.ok, true);
assert.equal(health.service, 'thousand-fighters-cms');
assert.ok(Array.isArray(health.adapterHealth));

const pipeline = await getJson('/api/pipeline');
assert.ok(pipeline.adapters.some((adapter) => adapter.port === 'imageGenerator'));
assert.ok(pipeline.adapters.some((adapter) => adapter.port === 'spriteNormalizer'));

const draft = await postTool('create_character_draft', {
  characterId,
  brief: 'A deployed CMS smoke fighter with visible animation frames, a projectile, and publishable config.',
});
assert.equal(draft.result.draft.id, characterId);

const sheet = await postTool('generate_sprite_sheet', {
  characterId,
  prompt: '5x6 fighting-game sprite sheet with magenta background, full-body frames, and clean gutters.',
});
const sourceAssetKey = sheet.result.asset.key;
assert.match(sourceAssetKey, /source\/.+_imagegen_sheet\.svg$/);

const sourceResponse = await fetch(assetUrl(sourceAssetKey));
assert.equal(sourceResponse.status, 200);
assert.match(await sourceResponse.text(), /<svg/);

const normalized = await postTool('normalize_sprite_pack', {
  characterId,
  sourceAssetKey,
});
assert.equal(normalized.result.normalized.status, 'pass');
assert.ok(normalized.result.normalized.copiedFileCount > 30);

const manifestResponse = await fetch(assetUrl(normalized.result.normalized.outputKey));
assert.equal(manifestResponse.status, 200);
const manifest = await manifestResponse.json();
assert.equal(manifest.cms.workflow, 'local-fixture-normalizer');
assert.equal(manifest.cms.fixtureFighterId, 'janitor');

const firstSpriteKey = `characters/${characterId}/assets/fighter-pack/sprites/base/base_001.png`;
const firstSprite = Buffer.from(await (await fetch(assetUrl(firstSpriteKey))).arrayBuffer());
assert.equal(firstSprite.subarray(1, 4).toString('ascii'), 'PNG');

const upload = await postJson(`/api/characters/${encodeURIComponent(characterId)}/assets`, {
  relativePath: 'projectiles/deployed_smoke_projectile.png',
  contentBase64: firstSprite.toString('base64'),
  contentType: 'image/png',
  metadata: {
    source: 'cms-remote-smoke-test',
  },
});
assert.equal(upload.ok, true);
assert.equal(upload.asset.relativePath, 'projectiles/deployed_smoke_projectile.png');

const assets = await getJson(`/api/characters/${encodeURIComponent(characterId)}/assets`);
assert.ok(assets.assets.some((asset) => asset.relativePath === 'fighter-pack/sprites/base/base_001.png'));
assert.ok(assets.assets.some((asset) => asset.relativePath === 'fighter-pack/sheets/base.png'));
assert.ok(assets.assets.some((asset) => asset.relativePath === 'projectiles/deployed_smoke_projectile.png'));

const qa = await postTool('validate_fighter_pack', {
  characterId,
  normalizedKey: normalized.result.normalized.outputKey,
});
assert.equal(qa.result.qa.status, 'pass');

const published = await postTool('publish_character', {
  characterId,
  releaseId,
});
assert.equal(published.result.published.status, 'published');
assert.equal(published.result.published.releaseId, releaseId);

const characters = await getJson('/api/characters');
assert.ok(characters.characters.some((character) => character.id === characterId));

console.log(`CMS remote HTTP e2e smoke test passed against ${baseUrl} with ${characterId}.`);

async function postTool(toolName, input) {
  return postJson(`/api/tools/${toolName}`, input);
}

async function getJson(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  return parseJsonResponse(response);
}

async function postJson(pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
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

function assetUrl(key) {
  return `${baseUrl}/api/assets/${key.split('/').map(encodeURIComponent).join('/')}`;
}
