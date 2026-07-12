/**
 * smoke_cms_creation_kit.mjs — creation generates the FULL move kit (T-move-kit).
 *
 * Before this, create_character_draft seeded only 4 attack moves and dropped any
 * combos/projectiles the model emitted. This pins the end-to-end contract:
 *
 *   [A] createCharacterDraft persists moves (incl grab/throw), combos, AND
 *       projectiles, and derives each projectile's runtime texture key.
 *   [B] convert turns the generated kit into a PLAYABLE config: the combo cancel
 *       graph (cancelInto + cancelFrom + attack-state + window) is wired, and a
 *       projectileId spawn event resolves to a full inline projectile config.
 *   [C] self-heal: a model slip (unknown combo segment, malformed projectile,
 *       dangling spawn ref) is pruned/warned, never persisted into the draft.
 *
 * Run: node scripts/smoke_cms_creation_kit.mjs
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CharacterContentRepository } from '../cms/repositories/CharacterContentRepository.js';
import { createMockTextModel } from '../cms/pipeline/adapters/mockAdapters.js';
import { CharacterCreationPipeline } from '../cms/pipeline/CharacterCreationPipeline.js';
import { PipelineRegistry } from '../cms/pipeline/PipelineRegistry.js';
import { PipelinePort } from '../cms/pipeline/ports.js';
import { FileCmsStorage } from '../cms/storage/FileCmsStorage.js';
import { convertDraftToCharacterConfig } from '../cms/export/convertDraftToCharacterConfig.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    failed += 1;
  }
}

// A text model that returns whatever value the test wants (for the self-heal case).
function stubTextModel(value) {
  return {
    id: 'stub-text-model',
    provider: 'mock',
    capabilities: ['structured-output'],
    async healthCheck() { return { status: 'ok' }; },
    async completeStructured() { return { provider: 'mock', promptRef: null, value }; },
  };
}

function makePipeline(textModel) {
  return async (rootDir) => {
    const storage = new FileCmsStorage({ rootDir });
    const repository = new CharacterContentRepository(storage, { clock: () => new Date('2026-06-14T00:00:00.000Z') });
    const registry = new PipelineRegistry({
      [PipelinePort.ASSET_STORAGE]: storage,
      [PipelinePort.CHARACTER_REPOSITORY]: repository,
      [PipelinePort.TEXT_MODEL]: textModel,
    });
    const pipeline = new CharacterCreationPipeline(registry, { clock: () => new Date('2026-06-14T00:00:00.000Z') });
    return { pipeline, repository };
  };
}

const rootDir = await mkdtemp(path.join(os.tmpdir(), 'tf-creation-kit-'));
try {
  // ---------------------------------------------------------------------------
  console.log('\n[A] createCharacterDraft persists the full kit (mock adapter parity)');
  const { pipeline, repository } = await makePipeline(createMockTextModel())(rootDir);
  const draft = await pipeline.createCharacterDraft({ characterId: 'kit_fighter', brief: 'A kit test fighter.' });
  const saved = await repository.getDraft('kit_fighter');

  test('moves cover grab + throw rows (not just the 4 attacks)', () => {
    const anims = new Set((saved.moves ?? []).map((m) => m.animation));
    assert.ok(anims.has('grab'), 'a move animates the grab row');
    assert.ok(anims.has('throw'), 'a move animates the throw row');
  });
  test('combos are persisted (no longer dropped)', () => {
    const ids = (saved.combos ?? []).map((c) => c.id).sort();
    assert.deepEqual(ids, ['grab_suplex', 'jab_cross']);
  });
  test('projectiles are persisted with a derived texture key', () => {
    assert.equal(saved.projectiles?.length, 1);
    assert.equal(saved.projectiles[0].id, 'fireball_proj');
    assert.equal(saved.projectiles[0].animation, 'kit_fighter_fireball_proj', 'animation derived as <characterId>_<id>');
  });
  test('a valid kit produces no generation warnings', () => {
    assert.deepEqual(draft.generation?.warnings ?? [], []);
  });

  // ---------------------------------------------------------------------------
  console.log('\n[B] convert turns the generated kit into a playable config');
  const config = convertDraftToCharacterConfig({ draft: saved, frameData: null, manifest: null });
  const byId = new Map(config.moves.map((m) => [m.id, m]));

  test('combo cancel graph is wired so the chain actually fires', () => {
    assert.ok(byId.get('jab').cancelInto.includes('cross'), 'jab cancels into cross');
    const cross = byId.get('cross');
    assert.ok(cross.trigger.cancelFrom.includes('jab'), 'cross cancelFrom jab');
    assert.ok(cross.trigger.allowedStates.includes('attack'), "cross reachable from 'attack'");
    assert.ok(cross.trigger.window >= 14, 'cross has a wide cancel window');
  });
  test('grab → suplex combo wired too', () => {
    assert.ok(byId.get('command_grab').cancelInto.includes('suplex'));
    assert.ok(byId.get('suplex').trigger.cancelFrom.includes('command_grab'));
  });
  test('projectileId spawn event resolves to a full inline projectile config', () => {
    const fireball = byId.get('fireball');
    const events = fireball.phases.flatMap((p) => p.events).map((e) => e.event);
    const spawn = events.find((e) => e.type === 'spawn_projectile');
    assert.ok(spawn, 'fireball has a spawn_projectile event');
    assert.ok(spawn.projectile && typeof spawn.projectile === 'object', 'entity resolved inline');
    assert.equal(spawn.projectile.animation, 'kit_fighter_fireball_proj');
    assert.equal(spawn.projectileId, undefined, 'projectileId stripped after resolution');
    assert.equal(spawn.offsetX, 50);
    assert.equal(spawn.offsetY, -90);
  });

  // ---------------------------------------------------------------------------
  console.log('\n[C] self-heal: model slips are pruned/warned, never persisted');
  const dirty = stubTextModel({
    displayName: 'Dirty', description: 'd',
    stats: {}, sprite: { frameCounts: {} },
    moves: [
      { id: 'a', displayName: 'A', animation: 'punch', trigger: { sequence: ['lp'] }, phases: [
        { name: 'startup', frames: 3, events: [] },
        { name: 'active', frames: 3, events: [{ frame: 0, event: { type: 'spawn_projectile', projectileId: 'ghost', offsetX: 10, offsetY: -10 } }] },
        { name: 'recovery', frames: 4, events: [] },
      ] },
    ],
    combos: [
      { id: 'ok', segments: ['a', 'a'] },           // valid (>=2, known)
      { id: 'bad', segments: ['a', 'nope'] },       // unknown segment → drop
      { id: 'tiny', segments: ['a'] },              // < 2 segments → drop
    ],
    projectiles: [
      { id: 'good', width: 10, height: 10, speed: 5, velocity: { x: 5, y: 0, relativeToFacing: true }, lifetime: 60, hitbox: { damage: 10 } },
      { id: 'broken', width: 0, height: -3, lifetime: 0 },   // malformed → drop
    ],
  });
  const dirtyRoot = await mkdtemp(path.join(os.tmpdir(), 'tf-creation-kit-dirty-'));
  try {
    const built = await makePipeline(dirty)(dirtyRoot);
    const dirtyDraft = await built.pipeline.createCharacterDraft({ characterId: 'dirty', brief: 'x' });
    test('invalid combos dropped, valid kept', () => {
      assert.deepEqual((dirtyDraft.combos ?? []).map((c) => c.id), ['ok']);
    });
    test('malformed projectile dropped, valid kept (with derived animation)', () => {
      assert.deepEqual((dirtyDraft.projectiles ?? []).map((p) => p.id), ['good']);
      assert.equal(dirtyDraft.projectiles[0].animation, 'dirty_good');
    });
    test('dangling spawn ref ("ghost") surfaced as a warning', () => {
      const warnings = dirtyDraft.generation?.warnings ?? [];
      assert.ok(warnings.some((w) => /ghost/.test(w)), `expected a ghost-ref warning, got: ${JSON.stringify(warnings)}`);
      assert.ok(warnings.some((w) => /bad/.test(w)) && warnings.some((w) => /tiny/.test(w)), 'dropped-combo warnings present');
      assert.ok(warnings.some((w) => /broken/.test(w)), 'dropped-projectile warning present');
    });
  } finally {
    await rm(dirtyRoot, { recursive: true, force: true });
  }
} finally {
  await rm(rootDir, { recursive: true, force: true });
}

console.log(`\nCMS creation-kit smoke test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
