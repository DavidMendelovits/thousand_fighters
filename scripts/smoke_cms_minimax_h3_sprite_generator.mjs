import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { createImageGeneratorAdapter } from '../cms/pipeline/adapters/createImageGeneratorAdapter.js';
import {
  composeSpriteSheetWithFfmpeg,
  MinimaxH3SpriteSheetGeneratorAdapter,
} from '../cms/pipeline/adapters/minimaxH3SpriteSheetGeneratorAdapter.js';
import { CharacterContentRepository } from '../cms/repositories/CharacterContentRepository.js';
import { CharacterCreationPipeline } from '../cms/pipeline/CharacterCreationPipeline.js';
import { PipelineRegistry } from '../cms/pipeline/PipelineRegistry.js';
import { PipelinePort } from '../cms/pipeline/ports.js';
import { FileCmsStorage } from '../cms/storage/FileCmsStorage.js';

const execFileAsync = promisify(execFile);

const fakeVideoBytes = Buffer.from('fake-h3-video');
const fakeSheetBytes = Buffer.from('fake-h3-sheet');
const requests = [];
const progress = [];
let nowMs = 1_000;
let queryCount = 0;

const adapter = new MinimaxH3SpriteSheetGeneratorAdapter({
  apiKey: 'test-minimax-key',
  baseUrl: 'https://minimax.test',
  duration: 4,
  pollIntervalMs: 1,
  timeoutMs: 1_000,
  now: () => nowMs,
  sleep: async () => { nowMs += 100; },
  composeSpriteSheet: async ({ videoBytes, task, duration }) => {
    assert.deepEqual(videoBytes, fakeVideoBytes);
    assert.equal(task, 'fighter-1x6-row');
    assert.equal(duration, 4);
    nowMs += 25;
    return fakeSheetBytes;
  },
  fetch: async (url, options = {}) => {
    requests.push({ url, options });
    if (url === 'https://minimax.test/v2/video_generation') {
      nowMs += 10;
      return jsonResponse({ task_id: 'h3_task_test' });
    }
    if (url === 'https://minimax.test/v2/query/video_generation/h3_task_test') {
      queryCount += 1;
      nowMs += 20;
      return jsonResponse({
        task: queryCount === 1
          ? { id: 'h3_task_test', status: 'running' }
          : {
              id: 'h3_task_test',
              model: 'MiniMax-H3',
              status: 'succeeded',
              content: { url: 'https://cdn.minimax.test/output.mp4' },
              resolution: '768P',
              duration: 4,
              ratio: '1:1',
              usage: { total_seconds: 4, output_seconds: 4, input_image_count: 1 },
            },
      });
    }
    if (url === 'https://cdn.minimax.test/output.mp4') {
      nowMs += 15;
      return new Response(fakeVideoBytes, { status: 200, headers: { 'content-type': 'video/mp4' } });
    }
    throw new Error(`Unexpected URL: ${url}`);
  },
});

const result = await adapter.generateImage({
  task: 'fighter-1x6-row',
  moveId: 'punch',
  prompt: 'A vaudeville boxer throws one crisp straight punch.',
  referenceImages: [{
    contentType: 'image/png',
    base64: Buffer.from('reference').toString('base64'),
  }],
  onProgress: (event) => progress.push(event),
  onGenerationAttempt: async (event) => progress.push({ type: 'attempt', event }),
});

assert.equal(result.provider, 'minimax-h3');
assert.equal(result.model, 'MiniMax-H3');
assert.equal(result.taskId, 'h3_task_test');
assert.equal(result.promptRef, 'h3_task_test');
assert.equal(result.contentType, 'image/png');
assert.deepEqual(result.bytes, fakeSheetBytes);
assert.deepEqual(result.videoBytes, fakeVideoBytes);
assert.deepEqual(result.usage, { total_seconds: 4, output_seconds: 4, input_image_count: 1 });
assert.ok(result.generationMs > 0);
assert.ok(result.postprocessMs > 0);
assert.ok(result.stageTimings.submissionMs > 0);
assert.ok(result.stageTimings.queueAndGenerationMs > 0);
assert.ok(result.stageTimings.downloadMs > 0);
assert.ok(result.stageTimings.spriteCompositionMs > 0);
assert.equal(queryCount, 2);

const createRequest = requests[0];
assert.equal(createRequest.options.headers.authorization, 'Bearer test-minimax-key');
const createBody = JSON.parse(createRequest.options.body);
assert.equal(createBody.model, 'MiniMax-H3');
assert.equal(createBody.resolution, '768P');
assert.equal(createBody.duration, 4);
assert.equal(createBody.ratio, '1:1');
assert.equal(createBody.content[0].type, 'text');
assert.match(createBody.content[0].text, /six readable beats/i);
assert.match(createBody.content[0].text, /chroma-magenta #ff00ff/i);
assert.equal(createBody.content[1].type, 'image_url');
assert.equal(createBody.content[1].role, 'reference_image');
assert.match(createBody.content[1].image_url.url, /^data:image\/png;base64,/);
assert.ok(progress.some((event) => event.stage === 'running'));
assert.ok(progress.some((event) => event.type === 'complete'));
assert.equal(progress.filter((event) => event.type === 'attempt').length, 1);
assert.equal(progress.find((event) => event.type === 'attempt').event.status, 'succeeded');

const factoryAdapter = createImageGeneratorAdapter({
  provider: 'minimax-h3',
  apiKey: 'test-key',
  fetch: adapter.fetch,
  composeSpriteSheet: adapter.composeSpriteSheet,
});
assert.equal(factoryAdapter.provider, 'minimax-h3');
assert.equal(factoryAdapter.id, 'minimax-h3-sprite-sheet-generator');

const maxAdapter = new MinimaxH3SpriteSheetGeneratorAdapter({
  apiKey: 'test-key',
  model: 'MiniMax-H3-Max',
  fetch: adapter.fetch,
  composeSpriteSheet: adapter.composeSpriteSheet,
});
assert.equal(maxAdapter.duration, 5, 'H3 Max defaults to its five-second minimum');

await assert.rejects(
  () => adapter.generateImage({ task: 'character-concept', prompt: 'nope' }),
  /only supports fighter row generation/,
);

// Exercise the real ffmpeg bridge with a locally generated four-second clip.
// This proves that the production filter emits one 3072x512 PNG containing six
// cells; the HTTP test above deliberately stubs composition so it remains fast
// and makes timing assertions deterministic.
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'tf-h3-ffmpeg-smoke-'));
try {
  const videoPath = path.join(tempDir, 'source.mp4');
  await execFileAsync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi',
    '-i', 'color=c=magenta:s=512x512:r=24:d=4',
    '-vf', "drawbox=x='40+60*t':y=100:w=100:h=300:color=white:t=fill",
    '-pix_fmt', 'yuv420p',
    videoPath,
  ]);
  const realSheet = await composeSpriteSheetWithFfmpeg({
    videoBytes: await readFile(videoPath),
    task: 'fighter-1x6-row',
    duration: 4,
  });
  const sheetPath = path.join(tempDir, 'sheet.png');
  await writeFile(sheetPath, realSheet);
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=s=x:p=0',
    sheetPath,
  ]);
  assert.equal(stdout.trim(), '3072x512');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

// Confirm the pipeline stores both artifacts and preserves benchmark metadata.
const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'tf-h3-storage-smoke-'));
try {
  const storage = new FileCmsStorage({ rootDir: storageRoot });
  const repository = new CharacterContentRepository(storage);
  const pipeline = new CharacterCreationPipeline(new PipelineRegistry({
    [PipelinePort.ASSET_STORAGE]: storage,
    [PipelinePort.CHARACTER_REPOSITORY]: repository,
    [PipelinePort.IMAGE_GENERATOR]: {
      id: 'h3-storage-test',
      provider: 'minimax-h3',
      capabilities: ['fighter-1x6-row'],
      async generateImage() {
        return {
          provider: 'minimax-h3',
          model: 'MiniMax-H3',
          contentType: 'image/png',
          bytes: fakeSheetBytes,
          videoBytes: fakeVideoBytes,
          videoContentType: 'video/mp4',
          taskId: 'h3_storage_task',
          generationMs: 120_000,
          postprocessMs: 250,
          elapsedMs: 120_250,
          usage: { output_seconds: 4 },
        };
      },
    },
  }));
  const stored = await pipeline.generateSpriteSheet({
    characterId: 'h3_test_fighter',
    moveId: 'base',
    prompt: 'A fighter idles.',
  });
  assert.equal(stored.asset.key, 'characters/h3_test_fighter/assets/source/h3_test_fighter_base_sheet.png');
  assert.equal(stored.videoAsset.key, 'characters/h3_test_fighter/assets/source/h3_test_fighter_base_h3.mp4');
  assert.equal(stored.elapsedMs, 120_250);
  assert.equal(await storage.exists(stored.asset.key), true);
  assert.equal(await storage.exists(stored.videoAsset.key), true);
  const metadata = await storage.getMetadata(stored.asset.key);
  assert.equal(metadata.elapsedMs, 120_250);
  assert.equal(metadata.taskId, 'h3_storage_task');
} finally {
  await rm(storageRoot, { recursive: true, force: true });
}

console.log('MiniMax H3 sprite-sheet generator smoke test passed.');

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
