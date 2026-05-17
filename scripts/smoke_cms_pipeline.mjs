import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CharacterContentRepository } from '../cms/repositories/CharacterContentRepository.js';
import {
  createMockImageGenerator,
  createMockNormalizer,
  createMockPublisher,
  createMockQa,
  createMockTextModel,
} from '../cms/pipeline/adapters/mockAdapters.js';
import { CharacterCreationPipeline } from '../cms/pipeline/CharacterCreationPipeline.js';
import { PipelineRegistry } from '../cms/pipeline/PipelineRegistry.js';
import { PipelinePort } from '../cms/pipeline/ports.js';
import { FileCmsStorage } from '../cms/storage/FileCmsStorage.js';

const rootDir = await mkdtemp(path.join(os.tmpdir(), 'thousand-fighters-pipeline-'));

try {
  const storage = new FileCmsStorage({ rootDir });
  const repository = new CharacterContentRepository(storage, {
    clock: () => new Date('2026-05-17T12:00:00.000Z'),
  });
  const registry = new PipelineRegistry({
    [PipelinePort.ASSET_STORAGE]: storage,
    [PipelinePort.CHARACTER_REPOSITORY]: repository,
    [PipelinePort.TEXT_MODEL]: createMockTextModel(),
    [PipelinePort.IMAGE_GENERATOR]: createMockImageGenerator(),
    [PipelinePort.SPRITE_NORMALIZER]: createMockNormalizer(),
    [PipelinePort.FIGHTER_QA]: createMockQa(),
    [PipelinePort.PUBLISHER]: createMockPublisher(),
  });
  const pipeline = new CharacterCreationPipeline(registry, {
    clock: () => new Date('2026-05-17T12:00:00.000Z'),
  });

  const draft = await pipeline.createCharacterDraft({
    characterId: 'pluggable_fighter',
    brief: 'A test fighter for adapter swap validation.',
  });
  assert.equal(draft.id, 'pluggable_fighter');
  assert.equal(draft.generation.provider, 'mock');

  const spriteSheet = await pipeline.generateSpriteSheet({
    characterId: 'pluggable_fighter',
    prompt: '5x6 fighter sheet, magenta background.',
  });
  assert.equal(spriteSheet.asset.key, 'characters/pluggable_fighter/assets/source/pluggable_fighter_imagegen_sheet.png');
  assert.equal(await storage.exists(spriteSheet.asset.key), true);

  const normalized = await pipeline.normalizeSpritePack({
    characterId: 'pluggable_fighter',
    sourceAssetKey: spriteSheet.asset.key,
  });
  assert.equal(normalized.status, 'pass');

  const qa = await pipeline.validateFighterPack({
    characterId: 'pluggable_fighter',
    normalizedKey: normalized.outputKey,
  });
  assert.equal(qa.status, 'pass');

  const published = await pipeline.publishCharacter({
    characterId: 'pluggable_fighter',
    releaseId: 'test-release',
  });
  assert.equal(published.status, 'published');
  assert.equal(published.releaseId, 'test-release');

  const ports = registry.describe().map((entry) => entry.port).sort();
  assert.deepEqual(ports, [
    PipelinePort.ASSET_STORAGE,
    PipelinePort.CHARACTER_REPOSITORY,
    PipelinePort.FIGHTER_QA,
    PipelinePort.IMAGE_GENERATOR,
    PipelinePort.PUBLISHER,
    PipelinePort.SPRITE_NORMALIZER,
    PipelinePort.TEXT_MODEL,
  ].sort());

  console.log(`CMS pipeline smoke test passed: ${rootDir}`);
} finally {
  await rm(rootDir, { force: true, recursive: true });
}
