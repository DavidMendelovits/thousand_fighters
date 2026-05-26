/**
 * Smoke test for the ContourSpriteNormalizerAdapter.
 *
 * Requires Python3 + Pillow to be installed. Skips gracefully if not available.
 *
 * Usage:
 *   node scripts/smoke_cms_contour_normalizer.mjs
 *   SPRITE_NORMALIZER_PROVIDER=contour node scripts/smoke_cms_contour_normalizer.mjs
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// Force contour provider for this smoke test
process.env.SPRITE_NORMALIZER_PROVIDER = 'contour';

// --- Prerequisites check (skip gracefully) ---
async function checkPrerequisite(cmd, args) {
  try {
    await execFileAsync(cmd, args, { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

const hasPython3 = await checkPrerequisite('python3', ['--version']);
if (!hasPython3) {
  console.log('[SKIP] python3 not found — install Python 3 to run the contour normalizer smoke test.');
  process.exit(0);
}

const hasPillow = await checkPrerequisite('python3', ['-c', 'import PIL']);
if (!hasPillow) {
  console.log('[SKIP] Pillow not installed — run: pip3 install Pillow');
  process.exit(0);
}

console.log('Prerequisites: python3 + Pillow available.');

// --- Dynamic import after env var is set ---
const { createLocalCmsRuntime } = await import('../cms/runtime/createLocalCmsRuntime.js');
const { ContourSpriteNormalizerAdapter } = await import('../cms/pipeline/adapters/contourSpriteNormalizerAdapter.js');

const rootDir = await mkdtemp(path.join(os.tmpdir(), 'thousand-fighters-contour-'));

try {
  const runtime = createLocalCmsRuntime({ storageOptions: { rootDir } });
  const { storage, pipeline, registry } = runtime;

  // ---------------------------------------------------------------
  // Test 1: healthCheck returns ok
  // ---------------------------------------------------------------
  const normalizer = registry.resolve('spriteNormalizer');
  const health = await normalizer.healthCheck();
  assert.equal(health.status, 'ok', `healthCheck should be ok, got: ${health.status} — ${health.message}`);
  console.log(`  [PASS] healthCheck: ${health.status} — ${health.message}`);

  // ---------------------------------------------------------------
  // Test 2: Upload a real source image into storage
  // ---------------------------------------------------------------
  const characterId = 'smoke_contour_fighter';
  const sourceImagePath = path.join(REPO_ROOT, 'public', 'fighters', 'janitor', 'source', 'janitor_imagegen_sheet.png');
  const sourceBytes = await readFile(sourceImagePath);
  const sourceAssetKey = `characters/${characterId}/assets/source/${characterId}_imagegen_sheet.png`;
  await storage.putBytes(sourceAssetKey, sourceBytes, {
    contentType: 'image/png',
    artifactType: 'source-sprite-sheet',
  });
  assert.ok(await storage.exists(sourceAssetKey), 'Source image must exist in storage before normalization');
  console.log(`  [PASS] source image uploaded: ${sourceAssetKey}`);

  // ---------------------------------------------------------------
  // Test 3: Run normalization via pipeline
  // ---------------------------------------------------------------
  console.log('  Running normalization (this may take ~10–60s)...');
  const normalized = await pipeline.normalizeSpritePack({
    characterId,
    sourceAssetKey,
    projectileId: 'projectile',
    projectileIndex: 28,
  });

  assert.ok(normalized, 'normalizeSpritePack must return a result');
  assert.ok(['pass', 'warning'].includes(normalized.status), `status must be pass or warning, got: ${normalized.status}`);
  assert.equal(normalized.characterId, characterId, 'characterId must match');
  assert.ok(normalized.outputKey, 'outputKey must be set');
  assert.ok(normalized.frameDataKey, 'frameDataKey must be set');
  assert.ok(normalized.reportKey, 'reportKey must be set');
  assert.ok(normalized.assetRootKey, 'assetRootKey must be set');
  assert.ok(typeof normalized.copiedFileCount === 'number' && normalized.copiedFileCount > 0, 'copiedFileCount must be > 0');
  console.log(`  [PASS] normalizeSpritePack: status=${normalized.status}, files=${normalized.copiedFileCount}`);

  if (normalized.warnings.length > 0) {
    console.log(`  [INFO] warnings: ${normalized.warnings.join('; ')}`);
  }

  // ---------------------------------------------------------------
  // Test 4: Required output files exist in storage
  // ---------------------------------------------------------------
  const requiredKeys = [
    normalized.outputKey,          // manifest.json
    normalized.frameDataKey,       // frameData.json
    normalized.reportKey,          // normalization-report.json
  ];

  for (const key of requiredKeys) {
    assert.ok(await storage.exists(key), `Required output file must exist in storage: ${key}`);
    console.log(`  [PASS] exists in storage: ${key}`);
  }

  // ---------------------------------------------------------------
  // Test 5: Sheets and sprites subdirectories populated
  // ---------------------------------------------------------------
  const SHEET_IDS = ['base', 'punch', 'kick', 'special_1', 'special_2'];
  const assetRoot = normalized.assetRootKey;

  for (const sheetId of SHEET_IDS) {
    const sheetKey = `${assetRoot}/sheets/${sheetId}.png`;
    assert.ok(await storage.exists(sheetKey), `Sheet must exist: ${sheetKey}`);
  }
  console.log(`  [PASS] all 5 sprite sheets exist in storage`);

  // Check at least the first frame of the base animation
  const firstFrameKey = `${assetRoot}/sprites/base/base_001.png`;
  assert.ok(await storage.exists(firstFrameKey), `First sprite frame must exist: ${firstFrameKey}`);
  console.log(`  [PASS] first sprite frame exists: ${firstFrameKey}`);

  // ---------------------------------------------------------------
  // Test 6: manifest.json has CMS metadata
  // ---------------------------------------------------------------
  const manifest = await storage.getJson(normalized.outputKey);
  assert.equal(manifest.characterId, characterId, 'manifest.characterId must match');
  assert.ok(manifest.cms, 'manifest.cms must be present');
  assert.equal(manifest.cms.workflow, 'contour-sprite-normalizer', 'manifest.cms.workflow must be contour-sprite-normalizer');
  assert.ok(manifest.cms.generatedAt, 'manifest.cms.generatedAt must be set');
  assert.ok(manifest.sheet_paths, 'manifest.sheet_paths must be present');
  assert.ok(manifest.sprite_paths, 'manifest.sprite_paths must be present');
  assert.ok(manifest.frame_counts, 'manifest.frame_counts must be present');
  console.log(`  [PASS] manifest.json has correct CMS metadata`);

  // ---------------------------------------------------------------
  // Test 7: frameData.json structure
  // ---------------------------------------------------------------
  const frameData = await storage.getJson(normalized.frameDataKey);
  assert.ok(frameData.frames, 'frameData.frames must be present');
  assert.ok(frameData.frames.base, 'frameData.frames.base must be present');
  assert.equal(frameData.frames.base.length, 6, 'base animation must have 6 frames');
  console.log(`  [PASS] frameData.json has correct frame structure`);

  // ---------------------------------------------------------------
  // Test 8: normalization-report.json
  // ---------------------------------------------------------------
  const report = await storage.getJson(normalized.reportKey);
  assert.ok(typeof report.componentCount === 'number', 'report.componentCount must be a number');
  assert.ok(report.frames, 'report.frames must be present');
  console.log(`  [PASS] normalization-report.json has expected structure (components: ${report.componentCount})`);

  console.log(`\nCMS contour normalizer smoke test PASSED (rootDir: ${rootDir})`);
} finally {
  await rm(rootDir, { force: true, recursive: true });
}
