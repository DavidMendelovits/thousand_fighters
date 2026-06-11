/**
 * Full-flow CMS smoke test — the whole chain, keyless:
 *
 *   draft → per-move sprite row → SFX → normalize (fixture) → QA → publish
 *   → export to runtime → assets-index discovery
 *
 * Asserts the publish QA gate is satisfied, the exported fighter directory is
 * game-loadable (config.json, canonical manifest, frameData, sprites, sounds),
 * and build_assets_index.mjs flags the fighter for roster discovery.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createLocalCmsRuntime } from '../cms/runtime/createLocalCmsRuntime.js';
import { exportCharacterToRuntime } from '../cms/export/exportCharacterToRuntime.js';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const CHARACTER_ID = 'full_flow_fighter';

const rootDir = await mkdtemp(path.join(os.tmpdir(), 'thousand-fighters-full-flow-'));
const publicDir = path.join(rootDir, 'public');
const fightersDir = path.join(publicDir, 'fighters');

try {
  const runtime = createLocalCmsRuntime({
    storageOptions: { provider: 'file', rootDir: path.join(rootDir, 'cms-data') },
    // Keyless: mock the API-backed adapters; fixture normalizer + real QA are defaults.
    textModelOptions: { provider: 'mock' },
    imageGeneratorOptions: { provider: 'mock' },
    soundGeneratorOptions: { provider: 'mock' },
  });
  const { pipeline, repository, storage } = runtime;

  // 1. Draft
  const draft = await pipeline.createCharacterDraft({
    characterId: CHARACTER_ID,
    brief: 'A fighter that proves the whole pipeline hangs together.',
  });
  assert.equal(draft.id, CHARACTER_ID);

  // 2. Per-move sprite row generation
  const sheet = await pipeline.generateSpriteSheet({
    characterId: CHARACTER_ID,
    moveId: 'punch',
    prompt: '1x6 punch row, magenta background.',
  });
  assert.ok(await storage.exists(sheet.asset.key), 'generated row sheet should be stored');

  // 2b. Row extraction normalizes into the fighter pack with anchors
  const extracted = await pipeline.extractRowFrames({
    characterId: CHARACTER_ID,
    sourceAssetKey: sheet.asset.key,
    moveId: 'punch',
  });
  assert.equal(extracted.frames.length, 6, 'row extraction yields 6 frames');
  const extractedFrameData = await storage.getJson(extracted.frameDataKey);
  assert.ok(extractedFrameData.frames.punch[0].anchor.y > 0, 'extracted frames carry anchors');

  // 3. SFX generation
  const sfx = await pipeline.generateCharacterSfx({
    characterId: CHARACTER_ID,
    prompt: 'a wet slap',
    soundType: 'hit',
  });
  assert.equal(sfx.asset.key, `characters/${CHARACTER_ID}/assets/sounds/hit.wav`);

  // 4. Normalize (fixture normalizer copies a real fighter pack)
  const normalized = await pipeline.normalizeSpritePack({
    characterId: CHARACTER_ID,
    sourceAssetKey: sheet.asset.key,
  });
  assert.equal(normalized.status, 'pass');

  // Canonical manifest schema lands in the pack
  const packManifest = await storage.getJson(normalized.outputKey);
  assert.ok(packManifest.sheets, 'pack manifest must use canonical "sheets" key');
  assert.ok(packManifest.frameCounts, 'pack manifest must use canonical "frameCounts" key');

  // 5. Publish before QA must hit the gate
  await assert.rejects(
    () => pipeline.publishCharacter({ characterId: CHARACTER_ID }),
    /QA gate/,
    'publishing before QA should be blocked',
  );

  // 6. QA
  const qa = await pipeline.validateFighterPack({
    characterId: CHARACTER_ID,
    normalizedKey: normalized.outputKey,
  });
  assert.notEqual(qa.status, 'fail', `QA must not fail: ${JSON.stringify(qa.checks?.filter((c) => c.status === 'error'))}`);

  // 7. Publish (gate now satisfied)
  const published = await pipeline.publishCharacter({
    characterId: CHARACTER_ID,
    releaseId: 'full-flow-release',
  });
  assert.equal(published.status, 'published');
  assert.equal(published.qa.status, qa.status);
  assert.ok(await storage.exists(`releases/latest/characters/${CHARACTER_ID}.json`));

  // 8. Export to runtime layout
  await mkdir(fightersDir, { recursive: true });
  const exported = await exportCharacterToRuntime({
    runtime: { repository, storage },
    characterId: CHARACTER_ID,
    outputDir: fightersDir,
    copyAssets: true,
  });
  const fighterDir = path.join(fightersDir, CHARACTER_ID);

  const config = JSON.parse(await readFile(path.join(fighterDir, 'config.json'), 'utf8'));
  assert.equal(config.id, CHARACTER_ID);
  assert.ok(config.sprite?.frames, 'config.sprite.frames must carry per-frame metadata');
  assert.equal(config.sprite.frameCounts.base, 6, 'frameCounts should come from the canonical manifest');

  const exportedManifest = JSON.parse(await readFile(path.join(fighterDir, 'manifest.json'), 'utf8'));
  assert.ok(exportedManifest.sheets, 'exported manifest must be canonical');
  await readFile(path.join(fighterDir, 'frameData.json'));
  await readFile(path.join(fighterDir, 'sprites', 'base', 'base_001.png'));
  await readFile(path.join(fighterDir, 'sounds', 'hit.wav'));
  assert.ok(exported.filesCopied.length > 30, 'export should copy the full pack');

  // 9. Assets-index discovery
  await execFileAsync('node', [path.join(REPO_ROOT, 'scripts', 'build_assets_index.mjs')], {
    env: { ...process.env, ASSETS_PUBLIC_DIR: publicDir },
  });
  const index = JSON.parse(await readFile(path.join(publicDir, 'assets-index.json'), 'utf8'));
  const entry = index.fighters[CHARACTER_ID];
  assert.ok(entry, 'exported fighter must appear in assets-index');
  assert.equal(entry.config, 'config.json', 'index must flag config.json for roster discovery');
  assert.equal(entry.frameCounts.base, 6);
  assert.equal(entry.sounds.hit, 'sounds/hit.wav');

  console.log(`CMS full-flow smoke test passed: ${rootDir}`);
} finally {
  await rm(rootDir, { force: true, recursive: true });
}
