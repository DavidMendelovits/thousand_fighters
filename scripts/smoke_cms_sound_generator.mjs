import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalCmsRuntime } from '../cms/runtime/createLocalCmsRuntime.js';

const provider = process.env.SOUND_GENERATOR_PROVIDER;
if (!provider || provider === 'local') {
  console.log('Skipping sound generator smoke test: set SOUND_GENERATOR_PROVIDER=openai or SOUND_GENERATOR_PROVIDER=elevenlabs to run this test.');
  process.exit(0);
}

const rootDir = await mkdtemp(path.join(os.tmpdir(), 'thousand-fighters-sound-'));

try {
  const runtime = createLocalCmsRuntime({
    storageOptions: { rootDir },
  });

  const { tools, pipeline, registry } = runtime;

  // Test 1: generate_character_sfx tool
  const sfxResult = await tools.invoke('generate_character_sfx', {
    characterId: 'test_fighter',
    prompt: 'punch hit sound',
    soundType: 'hit',
  });

  assert.ok(sfxResult, 'generate_character_sfx must return a result');
  assert.ok(sfxResult.asset, 'generate_character_sfx result must include an asset');
  assert.ok(sfxResult.asset.key, 'asset must have a key');
  assert.match(sfxResult.asset.key, /sounds\/hit\.wav/, 'asset key must include sounds/hit.wav');
  console.log(`  [PASS] generate_character_sfx: ${sfxResult.asset.key} (provider: ${sfxResult.provider})`);

  // Test 2: generate_bgm tool
  const bgmResult = await tools.invoke('generate_bgm', {
    name: 'test_bgm',
    prompt: 'epic battle music',
  });

  assert.ok(bgmResult, 'generate_bgm must return a result');
  assert.ok(bgmResult.storageKey, 'generate_bgm result must include a storageKey');
  assert.match(bgmResult.storageKey, /audio\/bgm\/test_bgm\.wav/, 'storageKey must include audio/bgm/test_bgm.wav');
  console.log(`  [PASS] generate_bgm: ${bgmResult.storageKey} (provider: ${bgmResult.provider})`);

  // Test 3: upload_character_sound tool
  const silentWavBase64 = buildMinimalWavBase64();
  const uploadResult = await tools.invoke('upload_character_sound', {
    characterId: 'test_fighter',
    soundName: 'jump',
    contentBase64: silentWavBase64,
    contentType: 'audio/wav',
  });

  assert.ok(uploadResult, 'upload_character_sound must return a result');
  assert.ok(uploadResult.asset, 'upload_character_sound result must include an asset');
  assert.match(uploadResult.asset.key, /sounds\/jump\.wav/, 'asset key must include sounds/jump.wav');
  console.log(`  [PASS] upload_character_sound: ${uploadResult.asset.key}`);

  // Test 4: pipeline.generateCharacterSfx directly
  const directSfx = await pipeline.generateCharacterSfx({
    characterId: 'test_fighter',
    prompt: 'kick impact',
    soundType: 'kick',
  });
  assert.ok(directSfx.asset.key, 'direct generateCharacterSfx must produce an asset key');
  console.log(`  [PASS] pipeline.generateCharacterSfx: ${directSfx.asset.key}`);

  // Test 5: pipeline.generateBgm directly
  const directBgm = await pipeline.generateBgm({
    name: 'menu_theme',
    prompt: 'calm menu music',
  });
  assert.ok(directBgm.storageKey, 'direct generateBgm must produce a storageKey');
  console.log(`  [PASS] pipeline.generateBgm: ${directBgm.storageKey}`);

  // Test 6: healthCheck on the sound generator adapter
  const soundGenerator = registry.resolve('soundGenerator');
  const health = await soundGenerator.healthCheck();
  assert.ok(['ok', 'warning'].includes(health.status), `soundGenerator healthCheck status should be ok or warning, got: ${health.status}`);
  console.log(`  [PASS] soundGenerator.healthCheck: ${health.status} — ${health.message}`);

  console.log(`\nCMS sound generator smoke test PASSED (rootDir: ${rootDir})`);
} finally {
  await rm(rootDir, { force: true, recursive: true });
}

function buildMinimalWavBase64() {
  const sampleRate = 44100;
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = 100;
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const fileSize = 44 + dataSize;
  const buffer = Buffer.alloc(fileSize, 0);
  let offset = 0;
  buffer.write('RIFF', offset, 'ascii'); offset += 4;
  buffer.writeUInt32LE(fileSize - 8, offset); offset += 4;
  buffer.write('WAVE', offset, 'ascii'); offset += 4;
  buffer.write('fmt ', offset, 'ascii'); offset += 4;
  buffer.writeUInt32LE(16, offset); offset += 4;
  buffer.writeUInt16LE(1, offset); offset += 2;
  buffer.writeUInt16LE(numChannels, offset); offset += 2;
  buffer.writeUInt32LE(sampleRate, offset); offset += 4;
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), offset); offset += 4;
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), offset); offset += 2;
  buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;
  buffer.write('data', offset, 'ascii'); offset += 4;
  buffer.writeUInt32LE(dataSize, offset);
  return buffer.toString('base64');
}
