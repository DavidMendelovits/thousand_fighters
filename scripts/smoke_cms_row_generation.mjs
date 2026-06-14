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
      imageCalls.push({ task: request.task, moveId: request.moveId, referenceImages: request.referenceImages?.length ?? 0 });
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

  // 5b. Once the base row exists, non-base generations attach it as a real
  //     reference image for identity/scale consistency.
  await pipeline.generateSpriteSheet({
    characterId,
    prompt: '1x6 punch row, magenta background.',
    moveId: 'punch',
  });
  const lastCall = imageCalls[imageCalls.length - 1];
  assert.equal(lastCall.referenceImages, 1, 'punch regen carries the base row as a reference image');
  assert.equal(imageCalls[0].referenceImages, 0, 'first punch had no base row to reference yet');

  // 6. Extract the base row into the fighter pack — frames, anchors, manifest,
  //    and frameData must all land under fighter-pack/ and merge per move.
  const baseExtract = await pipeline.extractRowFrames({
    characterId,
    sourceAssetKey: expectedBaseKey,
    moveId: 'base',
  });
  assert.equal(baseExtract.assetRootKey, `characters/${characterId}/assets/fighter-pack`);
  assert.equal(baseExtract.frames.length, 6, 'six base frames extracted');
  assert.equal(await storage.exists(baseExtract.sheetKey), true, 'assembled base sheet stored');

  const frameDataAfterBase = await storage.getJson(baseExtract.frameDataKey);
  assert.equal(frameDataAfterBase.frames.base.length, 6, 'base frameData merged');
  const baseFrame = frameDataAfterBase.frames.base[0];
  assert.ok(baseFrame.anchor.x > 0 && baseFrame.anchor.y > 0, 'base frames carry anchors');
  assert.ok(baseFrame.silhouetteHeight > 0, 'base frames carry silhouette height');
  assert.equal(baseFrame.anchor.y, baseFrame.height - 6, 'anchor sits on the floor padding');

  // 7. Extract punch — must merge alongside base (not replace it) and be
  //    rescaled to the base row's silhouette height.
  const punchExtract = await pipeline.extractRowFrames({
    characterId,
    sourceAssetKey: expectedPunchKey,
    moveId: 'punch',
  });
  assert.ok(punchExtract.targetHeight > 0, 'punch derived target height from base row');

  const mergedFrameData = await storage.getJson(punchExtract.frameDataKey);
  assert.equal(mergedFrameData.frames.base.length, 6, 'base survives punch merge');
  assert.equal(mergedFrameData.frames.punch.length, 6, 'punch frameData merged');

  const manifest = await storage.getJson(punchExtract.manifestKey);
  assert.equal(manifest.sheets.base, 'sheets/base.png');
  assert.equal(manifest.sheets.punch, 'sheets/punch.png');
  assert.equal(manifest.frameCounts.punch, 6);
  assert.equal(manifest.sprites.punch.length, 6);

  const normReport = await storage.getJson(punchExtract.reportKey);
  assert.equal(normReport.workflow, 'row-normalizer');
  assert.ok(normReport.moves.base && normReport.moves.punch, 'per-move report sections merged');

  // 8. Re-extracting the same move replaces frames idempotently.
  const reExtract = await pipeline.extractRowFrames({
    characterId,
    sourceAssetKey: expectedPunchKey,
    moveId: 'punch',
  });
  assert.equal(reExtract.frames.length, 6, 're-extraction yields six frames');
  const packSprites = await storage.list(`characters/${characterId}/assets/fighter-pack/sprites/punch`);
  const pngCount = packSprites.filter((key) => key.endsWith('.png')).length;
  assert.equal(pngCount, 6, 'no stale frames after re-extraction');

  // 9. A T21 row (`block`) generates + extracts through the same moveId-agnostic
  //    path — proving new rows need no per-row pipeline plumbing. Asserts the
  //    source sheet, assembled sheet, per-row frameData, and manifest all land
  //    under the new id.
  const blockGen = await pipeline.generateSpriteSheet({
    characterId,
    prompt: '1x6 block row, magenta background.',
    moveId: 'block',
  });
  const expectedBlockKey = `characters/${characterId}/assets/source/${characterId}_block_sheet.png`;
  assert.equal(blockGen.asset.key, expectedBlockKey, 'block asset key uses the new row id');
  assert.equal(await storage.exists(expectedBlockKey), true, 'block source sheet stored');
  assert.equal(imageCalls[imageCalls.length - 1].moveId, 'block', 'image generator saw moveId=block');

  const blockExtract = await pipeline.extractRowFrames({
    characterId,
    sourceAssetKey: expectedBlockKey,
    moveId: 'block',
  });
  assert.equal(blockExtract.frames.length, 6, 'six block frames extracted');
  assert.equal(await storage.exists(blockExtract.sheetKey), true, 'assembled block sheet stored');

  const frameDataAfterBlock = await storage.getJson(blockExtract.frameDataKey);
  assert.equal(frameDataAfterBlock.frames.block.length, 6, 'block frameData merged under the new id');
  assert.equal(frameDataAfterBlock.frames.base.length, 6, 'base survives the block merge');

  const manifestAfterBlock = await storage.getJson(blockExtract.manifestKey);
  assert.equal(manifestAfterBlock.sheets.block, 'sheets/block.png', 'manifest carries the block sheet');
  assert.equal(manifestAfterBlock.frameCounts.block, 6, 'manifest frameCount for block');

  // 10. The generate/extract tools reject a row id outside the registry (codex
  //     P2) — a typo would otherwise produce assets the runtime never loads.
  const { createCmsTools } = await import('../cms/tools/createCmsTools.js');
  const tools = createCmsTools({ pipeline, repository, registry });
  await assert.rejects(
    tools.invoke('generate_sprite_sheet', { characterId, prompt: 'x', moveId: 'dash_forwad' }),
    /unknown row id "dash_forwad"/,
    'generate_sprite_sheet must reject a typo row id',
  );
  await assert.rejects(
    tools.invoke('extract_row_frames', { characterId, sourceAssetKey: expectedBaseKey, moveId: 'kik' }),
    /unknown row id "kik"/,
    'extract_row_frames must reject a typo row id',
  );

  console.log(`CMS row generation smoke test passed: ${rootDir}`);
} finally {
  await rm(rootDir, { force: true, recursive: true });
}
