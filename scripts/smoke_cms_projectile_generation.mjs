/**
 * smoke_cms_projectile_generation.mjs — Phase 4 T23 unit 2 (sprite generation +
 * tools).
 *
 *   - generateProjectile stores a projectile sprite under the projectile's
 *     source key AND upserts the draft.projectiles entity (animation + default
 *     numbers); it uses the 'projectile-sprite' gen task.
 *   - Re-generating an existing id swaps the sprite but PRESERVES authored
 *     numbers (gym tuning isn't clobbered).
 *   - define_projectile validates + persists entity numbers; rejects bad ones.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CharacterContentRepository } from '../cms/repositories/CharacterContentRepository.js';
import { createMockImageGenerator } from '../cms/pipeline/adapters/mockAdapters.js';
import { CharacterCreationPipeline } from '../cms/pipeline/CharacterCreationPipeline.js';
import { PipelineRegistry } from '../cms/pipeline/PipelineRegistry.js';
import { PipelinePort } from '../cms/pipeline/ports.js';
import { FileCmsStorage } from '../cms/storage/FileCmsStorage.js';
import { createCmsTools } from '../cms/tools/createCmsTools.js';

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    failed += 1;
  }
}

const rootDir = await mkdtemp(path.join(os.tmpdir(), 'thousand-fighters-proj-gen-'));

try {
  const storage = new FileCmsStorage({ rootDir });
  const repository = new CharacterContentRepository(storage, {
    clock: () => new Date('2026-06-14T12:00:00.000Z'),
  });

  const baseMock = createMockImageGenerator();
  const tasks = [];
  const imageGenerator = {
    ...baseMock,
    async generateImage(request) {
      tasks.push(request.task);
      return baseMock.generateImage(request);
    },
  };

  const registry = new PipelineRegistry({
    [PipelinePort.ASSET_STORAGE]: storage,
    [PipelinePort.CHARACTER_REPOSITORY]: repository,
    [PipelinePort.IMAGE_GENERATOR]: imageGenerator,
  });
  const pipeline = new CharacterCreationPipeline(registry, {
    clock: () => new Date('2026-06-14T12:00:00.000Z'),
  });

  const characterId = 'proj_gen_fighter';
  await repository.saveDraft(characterId, { moves: [] });

  console.log('\n[A] generateProjectile — sprite + entity upsert');

  let gen;
  await test('generateProjectile stores the sprite and creates the entity', async () => {
    gen = await pipeline.generateProjectile({ characterId, projectileId: 'fireball', prompt: 'a blazing fireball' });
    const expectedKey = `characters/${characterId}/assets/source/${characterId}_fireball_projectile.png`;
    assert.equal(gen.asset.key, expectedKey, 'projectile sprite stored under its source key');
    assert.equal(await storage.exists(expectedKey), true, 'sprite asset exists');
    assert.equal(tasks[tasks.length - 1], 'projectile-sprite', 'used the projectile-sprite gen task');
  });

  await test('the entity is registered on draft.projectiles with animation + defaults', async () => {
    const draft = await repository.getDraft(characterId);
    assert.equal(draft.projectiles.length, 1);
    const entity = draft.projectiles[0];
    assert.equal(entity.id, 'fireball');
    assert.equal(entity.animation, `${characterId}_fireball`, 'animation is the runtime texture key');
    assert.ok(entity.hitbox && entity.hitbox.damage > 0, 'carries a default hitbox');
    assert.ok(entity.lifetime > 0 && entity.width > 0, 'carries default geometry/lifetime');
  });

  await test('re-generating preserves authored numbers, swaps only the sprite reference', async () => {
    // Tune a number first.
    const draft = await repository.getDraft(characterId);
    draft.projectiles[0].hitbox.damage = 999;
    draft.projectiles[0].lifetime = 42;
    await repository.saveDraft(characterId, draft);
    // Regenerate the same id.
    await pipeline.generateProjectile({ characterId, projectileId: 'fireball', prompt: 'a bluer fireball' });
    const after = await repository.getDraft(characterId);
    assert.equal(after.projectiles.length, 1, 'still one entity (replace, not duplicate)');
    assert.equal(after.projectiles[0].hitbox.damage, 999, 'authored damage preserved');
    assert.equal(after.projectiles[0].lifetime, 42, 'authored lifetime preserved');
  });

  console.log('\n[B] define_projectile tool — validate + persist');

  const tools = createCmsTools({ pipeline, repository, registry });
  assert.ok(tools.list().some((t) => t.name === 'define_projectile'), 'define_projectile registered');
  assert.ok(tools.list().some((t) => t.name === 'generate_projectile'), 'generate_projectile registered');

  await test('define_projectile persists a tuned entity', async () => {
    await tools.invoke('define_projectile', {
      characterId,
      projectile: { id: 'fireball', animation: `${characterId}_fireball`, width: 60, height: 30, speed: 9, lifetime: 80, hitbox: { x: -30, y: -15, width: 60, height: 30, damage: 80, hitstun: 20, blockstun: 14, knockback: { x: 6, y: -1 }, level: 'mid' } },
    });
    const draft = await repository.getDraft(characterId);
    assert.equal(draft.projectiles.length, 1, 'replaced, not duplicated');
    assert.equal(draft.projectiles[0].width, 60);
    assert.equal(draft.projectiles[0].hitbox.damage, 80);
  });

  await test('define_projectile rejects a non-positive dimension loudly', async () => {
    await assert.rejects(
      tools.invoke('define_projectile', { characterId, projectile: { id: 'bad', width: 0, height: 10, lifetime: 60 } }),
      /must be a positive number/,
    );
  });

  await test('define_projectile rejects a missing id loudly', async () => {
    await assert.rejects(
      tools.invoke('define_projectile', { characterId, projectile: { width: 10, height: 10 } }),
      /projectile\.id is required/,
    );
  });
} finally {
  await rm(rootDir, { force: true, recursive: true });
}

console.log(`\nCMS projectile generation smoke test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
