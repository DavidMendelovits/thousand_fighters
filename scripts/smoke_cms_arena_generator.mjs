import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalCmsRuntime } from '../cms/runtime/createLocalCmsRuntime.js';

const provider = process.env.IMAGE_GENERATOR_PROVIDER ?? process.env.CMS_IMAGE_GENERATOR_PROVIDER;
if (!provider || provider === 'local') {
  console.log('Skipping arena generator smoke test: set IMAGE_GENERATOR_PROVIDER=codex or IMAGE_GENERATOR_PROVIDER=openai to run this test.');
  process.exit(0);
}

const rootDir = await mkdtemp(path.join(os.tmpdir(), 'thousand-fighters-arena-'));

try {
  const runtime = createLocalCmsRuntime({
    storageOptions: { rootDir },
  });

  const { tools, pipeline, registry } = runtime;

  // Test 1: generate_arena_background tool — 2 candidates
  const toolResult = await tools.invoke('generate_arena_background', {
    arenaId: 'test_arena',
    prompt: 'An ancient temple arena',
    candidateCount: 2,
  });

  assert.ok(toolResult, 'generate_arena_background must return a result');
  assert.equal(toolResult.arenaId, 'test_arena', 'arenaId must match');
  assert.equal(toolResult.candidateCount, 2, 'candidateCount must be 2');
  assert.ok(Array.isArray(toolResult.candidates), 'candidates must be an array');
  assert.equal(toolResult.candidates.length, 2, 'must have 2 candidates');

  for (let i = 0; i < toolResult.candidates.length; i += 1) {
    const candidate = toolResult.candidates[i];
    assert.ok(candidate.key, `candidate ${i} must have a key`);
    assert.match(candidate.key, new RegExp(`arenas/test_arena/candidate_${i}`), `candidate ${i} key must include arenas/test_arena/candidate_${i}`);
    console.log(`  [PASS] candidate ${i}: ${candidate.key} (provider: ${candidate.provider})`);
  }

  // Test 2: verify both candidates are stored in asset storage
  const storage = registry.resolve('assetStorage');
  for (let i = 0; i < 2; i += 1) {
    const key = toolResult.candidates[i].key;
    const exists = await storage.exists(key);
    assert.ok(exists, `storage.exists must be true for candidate ${i} key: ${key}`);
    console.log(`  [PASS] storage verified for candidate ${i}: ${key}`);
  }

  // Test 3: pipeline.generateArenaBackground directly (single candidate)
  const directResult = await pipeline.generateArenaBackground({
    arenaId: 'direct_arena',
    prompt: 'A neon cyberpunk rooftop',
    candidateIndex: 0,
  });

  assert.ok(directResult.key, 'direct generateArenaBackground must produce a key');
  assert.match(directResult.key, /arenas\/direct_arena\/candidate_0/, 'direct result key must include arenas/direct_arena/candidate_0');
  console.log(`  [PASS] pipeline.generateArenaBackground: ${directResult.key} (provider: ${directResult.provider})`);

  // Test 4: local image generator reports arena-background capability
  const imageGenerator = registry.resolve('imageGenerator');
  assert.ok(
    Array.isArray(imageGenerator.capabilities) && imageGenerator.capabilities.includes('arena-background'),
    'imageGenerator capabilities must include arena-background',
  );
  console.log(`  [PASS] imageGenerator capabilities include arena-background`);

  console.log(`\nCMS arena generator smoke test PASSED (rootDir: ${rootDir})`);
} finally {
  await rm(rootDir, { force: true, recursive: true });
}
