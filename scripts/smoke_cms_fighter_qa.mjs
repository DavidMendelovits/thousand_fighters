/**
 * Smoke test for the real FighterPackQaAdapter.
 *
 * Flow:
 *   1. Create a local runtime with the real QA adapter.
 *   2. Normalize a fighter using the fixture normalizer (copies janitor assets).
 *   3. Run QA on the normalized pack — expect status 'pass'.
 *   4. Verify the report is stored in the repository.
 *   5. Delete a sprite file and re-run QA — expect status 'fail'.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalCmsRuntime } from '../cms/runtime/createLocalCmsRuntime.js';

const rootDir = await mkdtemp(path.join(os.tmpdir(), 'thousand-fighters-qa-'));

try {
  // ----------------------------------------------------------------
  // Set up runtime with file storage and the real QA adapter (default)
  // ----------------------------------------------------------------
  const runtime = createLocalCmsRuntime({
    storageOptions: {
      provider: 'file',
      rootDir,
    },
    // Keyless run: mock the API-backed adapters so this smoke needs no env vars.
    textModelOptions: { provider: 'mock' },
    imageGeneratorOptions: { provider: 'mock' },
    soundGeneratorOptions: { provider: 'mock' },
    // fighterQaOptions: { provider: 'real' }  // already the default
  });
  const { storage, repository, pipeline } = runtime;

  // ----------------------------------------------------------------
  // Step 1: Generate a placeholder sprite sheet (needed as source key)
  // ----------------------------------------------------------------
  const sheet = await pipeline.generateSpriteSheet({
    characterId: 'qa_test_fighter',
    prompt: '5x6 fighter sheet, magenta background.',
  });
  const sourceAssetKey = sheet.asset.key;
  assert.ok(await storage.exists(sourceAssetKey), 'Source sheet should exist in storage');

  // ----------------------------------------------------------------
  // Step 2: Normalize (copies janitor fixture assets into CMS storage)
  // ----------------------------------------------------------------
  const normalized = await pipeline.normalizeSpritePack({
    characterId: 'qa_test_fighter',
    sourceAssetKey,
  });

  assert.equal(normalized.status, 'pass', `Normalization should pass, got: ${normalized.status}`);
  assert.ok(normalized.outputKey, 'Normalized output key should be set');
  assert.ok(await storage.exists(normalized.outputKey), 'Normalized manifest should exist in storage');

  // ----------------------------------------------------------------
  // Step 3: Run real QA validation — expect 'pass'
  // ----------------------------------------------------------------
  const qaResult = await pipeline.validateFighterPack({
    characterId: 'qa_test_fighter',
    normalizedKey: normalized.outputKey,
    runId: 'smoke-run-001',
  });

  console.log('QA checks:');
  for (const check of qaResult.checks) {
    const icon = check.status === 'pass' ? 'PASS' : check.status === 'warning' ? 'WARN' : 'FAIL';
    console.log(`  [${icon}] ${check.id}: ${check.message}`);
  }

  assert.ok(
    qaResult.status === 'pass' || qaResult.status === 'warning',
    `QA should pass or warn on fixture pack, got: ${qaResult.status}\n${JSON.stringify(qaResult.checks, null, 2)}`,
  );

  // Verify no errors
  const errorChecks = qaResult.checks.filter((c) => c.status === 'error');
  assert.equal(
    errorChecks.length,
    0,
    `Expected no QA errors on clean fixture pack, got:\n${JSON.stringify(errorChecks, null, 2)}`,
  );

  // Verify report is stored in repository
  assert.ok(qaResult.reportKey, 'QA report key should be set');
  assert.ok(await storage.exists(qaResult.reportKey), 'QA report should be persisted in storage');

  const storedReport = await storage.getJson(qaResult.reportKey);
  assert.equal(storedReport.characterId, 'qa_test_fighter');
  assert.equal(storedReport.status, qaResult.status);
  assert.ok(Array.isArray(storedReport.checks), 'Stored report should have checks array');

  // Verify summary shape
  assert.ok(typeof qaResult.summary.errors === 'number', 'summary.errors should be a number');
  assert.ok(typeof qaResult.summary.warnings === 'number', 'summary.warnings should be a number');
  assert.ok(typeof qaResult.summary.passed === 'number', 'summary.passed should be a number');
  assert.ok(typeof qaResult.summary.sheetsChecked === 'number', 'summary.sheetsChecked should be a number');
  assert.ok(typeof qaResult.summary.framesChecked === 'number', 'summary.framesChecked should be a number');
  assert.ok(qaResult.summary.sheetsChecked >= 5, `Should check at least 5 sheets, got ${qaResult.summary.sheetsChecked}`);
  assert.ok(qaResult.summary.framesChecked >= 30, `Should check at least 30 frames, got ${qaResult.summary.framesChecked}`);

  console.log(`\nQA smoke test (pass path): OK — status=${qaResult.status}, errors=${qaResult.summary.errors}, warnings=${qaResult.summary.warnings}, passed=${qaResult.summary.passed}`);

  // ----------------------------------------------------------------
  // Step 4: Break the pack by deleting a sprite file, re-run QA
  // ----------------------------------------------------------------
  const assetRoot = normalized.outputKey.replace(/\/manifest\.json$/, '');
  const spriteToDelete = `${assetRoot}/sprites/base/base_001.png`;

  assert.ok(await storage.exists(spriteToDelete), `Sprite to delete should exist: ${spriteToDelete}`);
  await storage.delete(spriteToDelete);
  assert.equal(await storage.exists(spriteToDelete), false, 'Sprite should be deleted');

  const brokenQaResult = await pipeline.validateFighterPack({
    characterId: 'qa_test_fighter',
    normalizedKey: normalized.outputKey,
    runId: 'smoke-run-002-broken',
  });

  console.log('\nBroken pack QA checks:');
  for (const check of brokenQaResult.checks) {
    const icon = check.status === 'pass' ? 'PASS' : check.status === 'warning' ? 'WARN' : 'FAIL';
    console.log(`  [${icon}] ${check.id}: ${check.message}`);
  }

  assert.equal(
    brokenQaResult.status,
    'fail',
    `QA should fail when a sprite is missing, got: ${brokenQaResult.status}`,
  );

  const spriteCheck = brokenQaResult.checks.find((c) => c.id === 'sprite-files-exist');
  assert.ok(spriteCheck, 'sprite-files-exist check should be present');
  assert.equal(spriteCheck.status, 'error', `sprite-files-exist should report error, got: ${spriteCheck.status}`);

  // Broken report should also be stored
  assert.ok(await storage.exists(brokenQaResult.reportKey), 'Broken QA report should also be persisted');

  console.log(`\nQA smoke test (fail path): OK — status=${brokenQaResult.status}, errors=${brokenQaResult.summary.errors}`);

  // ----------------------------------------------------------------
  // Step 5: Verify provider identity
  // ----------------------------------------------------------------
  const { registry } = runtime;
  const registryEntries = registry.describe();
  const qaEntry = registryEntries.find((e) => e.port === 'fighterQa');
  assert.ok(qaEntry, 'fighterQa port should be registered');
  assert.equal(qaEntry.provider, 'real', 'Default QA adapter should be the real provider');

  console.log('\nAll fighter QA smoke tests passed.');
} finally {
  await rm(rootDir, { force: true, recursive: true });
}
