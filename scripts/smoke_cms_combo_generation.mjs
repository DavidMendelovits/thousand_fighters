/**
 * smoke_cms_combo_generation.mjs — Phase 4 T22 unit 2 (sequential generation +
 * tools).
 *
 * The testable contract is the THREADING: each combo segment after the first
 * carries the prior segment's source sheet as a reference image (so the model
 * can continue the pose). This proves threading happened — NOT that the poses
 * visually align, which is model-dependent (soft continuity).
 *
 * Also covers the define_combo tool: validates segments against existing moves
 * and persists draft.combos; rejects an unknown segment loudly.
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
async function test_async(name, fn) {
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

const rootDir = await mkdtemp(path.join(os.tmpdir(), 'thousand-fighters-combo-gen-'));

try {
  const storage = new FileCmsStorage({ rootDir });
  const repository = new CharacterContentRepository(storage, {
    clock: () => new Date('2026-06-14T12:00:00.000Z'),
  });

  // Record the reference-image source keys the generator received per call.
  const baseMock = createMockImageGenerator();
  const calls = [];
  const imageGenerator = {
    ...baseMock,
    async generateImage(request) {
      calls.push({
        moveId: request.moveId,
        referenceKeys: (request.referenceImages ?? []).map((image) => image.sourceKey),
      });
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

  const characterId = 'combo_gen_fighter';
  const baseSheetKey = `characters/${characterId}/assets/source/${characterId}_base_sheet.png`;
  const punchSheetKey = `characters/${characterId}/assets/source/${characterId}_punch_sheet.png`;
  const kickSheetKey = `characters/${characterId}/assets/source/${characterId}_kick_sheet.png`;

  // Base row first so it exists as an identity reference for the chain.
  await pipeline.generateSpriteSheet({ characterId, prompt: 'base row', moveId: 'base' });

  console.log('\n[A] generateComboSequence — pose-continuity threading');

  const combo = await pipeline.generateComboSequence({
    characterId,
    basePrompt: 'a snappy fighter',
    segments: [{ moveId: 'punch' }, { moveId: 'kick' }],
  });

  const punchCall = calls.find((c) => c.moveId === 'punch');
  const kickCall = calls.find((c) => c.moveId === 'kick');

  test('first segment (punch) references the base sheet for identity, NOT a prior segment', () => {
    assert.ok(punchCall.referenceKeys.includes(baseSheetKey), 'punch should reference base');
    assert.ok(!punchCall.referenceKeys.includes(kickSheetKey), 'punch must not reference a later segment');
  });

  test('second segment (kick) carries the prior segment (punch) sheet as a continuity reference', () => {
    assert.ok(kickCall.referenceKeys.includes(punchSheetKey), 'kick must reference the punch sheet');
  });

  test('continuity reference does NOT replace the identity references (base still attached)', () => {
    assert.ok(kickCall.referenceKeys.includes(baseSheetKey), 'kick keeps the base identity ref too');
  });

  test('each segment wrote its own source sheet under its move id', () => {
    assert.equal(combo.segments[0].asset.key, punchSheetKey);
    assert.equal(combo.segments[1].asset.key, kickSheetKey);
  });

  await test_async('a combo with < 2 segments is rejected', async () => {
    await assert.rejects(
      pipeline.generateComboSequence({ characterId, segments: [{ moveId: 'punch' }] }),
      /at least 2 segments/,
    );
  });

  console.log('\n[B] define_combo tool — validate + persist');

  const tools = createCmsTools({ pipeline, repository, registry });
  assert.ok(tools.list().some((t) => t.name === 'define_combo'), 'define_combo tool registered');
  assert.ok(tools.list().some((t) => t.name === 'generate_combo'), 'generate_combo tool registered');

  // Seed a draft with two moves so segments resolve.
  await repository.saveDraft(characterId, {
    moves: [{ id: 'punch' }, { id: 'kick' }],
  });

  await test_async('define_combo persists a valid combo to draft.combos', async () => {
    await tools.invoke('define_combo', { characterId, comboId: 'bnb', segments: ['punch', 'kick'] });
    const draft = await repository.getDraft(characterId);
    assert.equal(draft.combos.length, 1);
    assert.deepEqual(draft.combos[0].segments, ['punch', 'kick']);
  });

  await test_async('define_combo rejects an unknown segment loudly', async () => {
    await assert.rejects(
      tools.invoke('define_combo', { characterId, comboId: 'bad', segments: ['punch', 'ghost'] }),
      /unknown move "ghost"/,
    );
  });

  await test_async('re-defining the same combo id replaces, not duplicates', async () => {
    await tools.invoke('define_combo', { characterId, comboId: 'bnb', segments: ['kick', 'punch'] });
    const draft = await repository.getDraft(characterId);
    assert.equal(draft.combos.length, 1, 'still one combo');
    assert.deepEqual(draft.combos[0].segments, ['kick', 'punch']);
  });
} finally {
  await rm(rootDir, { force: true, recursive: true });
}

console.log(`\nCMS combo generation smoke test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
