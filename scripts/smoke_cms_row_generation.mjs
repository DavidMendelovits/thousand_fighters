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

const rootDir = await mkdtemp(path.join(os.tmpdir(), 'thousand-fighters-row-gen-'));

try {
  const storage = new FileCmsStorage({ rootDir });
  const repository = new CharacterContentRepository(storage, {
    clock: () => new Date('2026-05-28T12:00:00.000Z'),
  });

  // Wrap mock image generator to track calls
  const baseMock = createMockImageGenerator();
  const imageCalls = [];
  const imageGenerator = {
    ...baseMock,
    async generateImage(request) {
      imageCalls.push({ task: request.task, moveId: request.moveId });
      return baseMock.generateImage(request);
    },
  };

  const registry = new PipelineRegistry({
    [PipelinePort.ASSET_STORAGE]: storage,
    [PipelinePort.CHARACTER_REPOSITORY]: repository,
    [PipelinePort.IMAGE_GENERATOR]: imageGenerator,
  });

  const pipeline = new CharacterCreationPipeline(registry, {
    clock: () => new Date('2026-05-28T12:00:00.000Z'),
  });

  const characterId = 'row_test_fighter';

  // 1. Generate with moveId: 'punch'
  const punchResult = await pipeline.generateSpriteSheet({
    characterId,
    prompt: '1x6 punch row, magenta background.',
    moveId: 'punch',
  });
  const expectedPunchKey = `characters/${characterId}/assets/source/${characterId}_punch_sheet.png`;
  assert.equal(punchResult.asset.key, expectedPunchKey, 'punch asset key');
  assert.equal(await storage.exists(expectedPunchKey), true, 'punch asset exists in storage');

  // 2. Generate with moveId: 'kick'
  const kickResult = await pipeline.generateSpriteSheet({
    characterId,
    prompt: '1x6 kick row, magenta background.',
    moveId: 'kick',
  });
  const expectedKickKey = `characters/${characterId}/assets/source/${characterId}_kick_sheet.png`;
  assert.equal(kickResult.asset.key, expectedKickKey, 'kick asset key');
  assert.equal(await storage.exists(expectedKickKey), true, 'kick asset exists in storage');

  // 3. Generate WITHOUT moveId -- should default to 'base'
  const baseResult = await pipeline.generateSpriteSheet({
    characterId,
    prompt: '1x6 base row, magenta background.',
  });
  const expectedBaseKey = `characters/${characterId}/assets/source/${characterId}_base_sheet.png`;
  assert.equal(baseResult.asset.key, expectedBaseKey, 'base (default) asset key');
  assert.equal(await storage.exists(expectedBaseKey), true, 'base asset exists in storage');

  // 4. Assert all 3 assets exist
  assert.equal(await storage.exists(expectedPunchKey), true, 'punch still exists');
  assert.equal(await storage.exists(expectedKickKey), true, 'kick still exists');
  assert.equal(await storage.exists(expectedBaseKey), true, 'base still exists');

  // 5. Assert the mock image generator received correct task and moveId for each call
  assert.equal(imageCalls.length, 3, 'image generator called 3 times');

  assert.equal(imageCalls[0].task, 'fighter-1x6-row', 'call 1 task');
  assert.equal(imageCalls[0].moveId, 'punch', 'call 1 moveId');

  assert.equal(imageCalls[1].task, 'fighter-1x6-row', 'call 2 task');
  assert.equal(imageCalls[1].moveId, 'kick', 'call 2 moveId');

  assert.equal(imageCalls[2].task, 'fighter-1x6-row', 'call 3 task');
  assert.equal(imageCalls[2].moveId, 'base', 'call 3 moveId (default)');

  console.log(`CMS row generation smoke test passed: ${rootDir}`);
} finally {
  await rm(rootDir, { force: true, recursive: true });
}
