import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { historyFixture } from './helpers/historyFixture.js';
import { CharacterCreationPipeline } from '../cms/pipeline/CharacterCreationPipeline.js';
import { PipelinePort } from '../cms/pipeline/ports.js';

test('saved projectile can be reprocessed without a provider request or overwriting its prior sprite', async t => {
  const fixture = await historyFixture();
  t.after(() => fixture.close());
  const { repository, storage } = fixture.runtime;
  const characterId = fixture.characterId;
  const sourceKey = `characters/${characterId}/assets/source/original-projectile.png`;
  const sourceBytes = await readFile('public/fighters/palimpsest/sprites/walk_forward/walk_forward_001.png');
  await storage.putBytes(sourceKey, sourceBytes, { contentType: 'image/png' });
  const initial = await repository.saveDraft(characterId, {
    ...(await repository.getDraft(characterId)),
    projectiles: [{ id: 'bead', animation: `${characterId}_bead`, sourceKey, width: 38, height: 30, speed: 7, lifetime: 72, velocity: { x: 7, y: 0 } }],
  });
  const pipeline = new CharacterCreationPipeline({ resolve(port) {
    if (port === PipelinePort.CHARACTER_REPOSITORY) return repository;
    if (port === PipelinePort.ASSET_STORAGE) return storage;
    throw new Error(`Unexpected port ${port}`);
  } });
  const result = await pipeline.reprocessProjectile({ characterId, projectileId: 'bead' });
  assert.equal(result.providerRequests, 0);
  assert.notEqual(result.projectile.sourceKey, sourceKey);
  assert.equal(result.projectile.sourceImageKey, sourceKey);
  assert.ok(await storage.exists(result.projectile.sourceKey));
  assert.deepEqual(await storage.getBytes(sourceKey), sourceBytes);
  assert.match((await repository.getVersion(characterId, result.safetyVersionId)).projectiles[0].sourceKey, new RegExp(`/versions/[^/]+/assets/source/original-projectile\\.png$`));
  assert.equal((await repository.getDraft(characterId)).projectiles[0].sourceKey, result.projectile.sourceKey);
  assert.notEqual((await repository.getDraft(characterId)).updatedAt, initial.updatedAt);
  const events = (await storage.lineage.events(characterId)).events;
  assert.ok(events.some(event => event.type === 'projectile-reprocessed' && event.providerRequests === 0));
  assert.equal((await storage.list('benchmarks/generation-attempts')).length, 0);
});

test('failed normalization can recover an explicit retained raw source', async t => {
  const fixture = await historyFixture();
  t.after(() => fixture.close());
  const { repository, storage } = fixture.runtime;
  const characterId = fixture.characterId;
  const rawKey = `characters/${characterId}/assets/source/${characterId}_bead_projectile_raw_abcdef123456.png`;
  await storage.putBytes(rawKey, await readFile('public/fighters/palimpsest/sprites/walk_forward/walk_forward_001.png'), { contentType: 'image/png' });
  await repository.saveDraft(characterId, {
    ...(await repository.getDraft(characterId)),
    projectiles: [{ id: 'bead', animation: `${characterId}_bead`, width: 38, height: 30, speed: 7, lifetime: 72, velocity: { x: 7, y: 0 } }],
  });
  const pipeline = new CharacterCreationPipeline({ resolve(port) {
    if (port === PipelinePort.CHARACTER_REPOSITORY) return repository;
    if (port === PipelinePort.ASSET_STORAGE) return storage;
    throw new Error(`Unexpected port ${port}`);
  } });
  await assert.rejects(pipeline.reprocessProjectile({ characterId, projectileId: 'bead', sourceAssetKey: 'characters/other/assets/source/foreign.png' }), /outside this character/);
  const result = await pipeline.reprocessProjectile({ characterId, projectileId: 'bead', sourceAssetKey: rawKey });
  assert.equal(result.projectile.sourceImageKey, rawKey);
  assert.ok(result.projectile.sourceKey);
});
