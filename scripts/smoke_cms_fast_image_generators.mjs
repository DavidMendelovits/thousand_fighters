import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { createImageGeneratorAdapter } from '../cms/pipeline/adapters/createImageGeneratorAdapter.js';
import { GeminiFlashImageGeneratorAdapter } from '../cms/pipeline/adapters/geminiFlashImageGeneratorAdapter.js';
import { MinimaxImage01GeneratorAdapter } from '../cms/pipeline/adapters/minimaxImage01GeneratorAdapter.js';
import { BflFluxKleinGeneratorAdapter } from '../cms/pipeline/adapters/bflFluxKleinGeneratorAdapter.js';
import { FalImageGeneratorAdapter, payloadForModel } from '../cms/pipeline/adapters/falImageGeneratorAdapter.js';
import {
  composeFrameSheetWithFfmpeg,
  ParallelFrameSpriteGenerator,
} from '../cms/pipeline/adapters/parallelFrameSpriteGenerator.js';

const execFileAsync = promisify(execFile);
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'tf-fast-images-smoke-'));
try {
  const imagePath = path.join(temporaryDirectory, 'frame.png');
  await execFileAsync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', 'color=c=magenta:s=96x128',
    '-vf', 'drawbox=x=30:y=20:w=36:h=100:color=white:t=fill',
    '-frames:v', '1', imagePath,
  ]);
  const imageBytes = await readFile(imagePath);
  const imageBase64 = imageBytes.toString('base64');

  class FakeParallelAdapter extends ParallelFrameSpriteGenerator {
    constructor() {
      super();
      this.provider = 'fake-fast';
      this.model = 'six-at-once';
      this.active = 0;
      this.maxActive = 0;
      this.prompts = [];
    }
    async generateFrame(request) {
      this.active += 1;
      this.maxActive = Math.max(this.maxActive, this.active);
      this.prompts.push(request.prompt);
      await new Promise((resolve) => setTimeout(resolve, 5));
      this.active -= 1;
      return { bytes: imageBytes, contentType: 'image/png', elapsedMs: 5, taskId: `frame-${request.frameNumber}` };
    }
  }
  const parallel = new FakeParallelAdapter();
  const attempts = [];
  const sheet = await parallel.generateImage({
    task: 'fighter-1x6-row', moveId: 'punch', prompt: 'A boxer.',
    onGenerationAttempt: async (event) => { attempts.push(event); },
  });
  assert.equal(parallel.maxActive, 6);
  assert.equal(parallel.prompts.length, 6);
  assert.deepEqual(parallel.prompts.map(prompt => Number(/FRAME (\d) OF 6/.exec(prompt)?.[1])).sort(), [1, 2, 3, 4, 5, 6]);
  parallel.prompts.forEach((prompt) => {
    assert.match(prompt, /Output ONLY frame/i);
    assert.match(prompt, /#FF00FF/);
    assert.match(prompt, /authentic hand-drawn 16-bit 2D arcade pixel art/i);
    assert.match(prompt, /NO 3D, CGI, action figure/i);
  });
  assert.equal(sheet.frameImages.length, 6);
  assert.equal(attempts.length, 6, 'every external frame attempt emits telemetry');
  assert.ok(attempts.every((attempt) => attempt.status === 'succeeded' && attempt.durationMs >= 0));
  assert.ok(sheet.stageTimings.providerBatchMs >= 0);
  assert.ok(sheet.stageTimings.spriteCompositionMs >= 0);
  assert.equal(sheet.stageTimings.frames.length, 6);

  class FailingSingleAdapter extends ParallelFrameSpriteGenerator {
    constructor() { super(); this.provider = 'fake-external'; this.model = 'failure-model'; }
    async generateFrame() { const error = new Error('provider rejected input'); error.statusCode = 422; throw error; }
  }
  const failedAttempts = [];
  await assert.rejects(
    () => new FailingSingleAdapter().generateImage({
      task: 'projectile-sprite', prompt: 'A projectile.',
      onGenerationAttempt: async (event) => { failedAttempts.push(event); },
    }),
    /provider rejected input/,
  );
  assert.equal(failedAttempts.length, 1, 'failed external calls emit telemetry too');
  assert.equal(failedAttempts[0].status, 'failed');

  class RetryingParallelAdapter extends ParallelFrameSpriteGenerator {
    constructor() { super({ frameRetries: 1, frameRetryDelayMs: 1 }); this.provider = 'fake-external'; this.model = 'retry-model'; this.calls = new Map(); }
    async generateFrame(request) {
      const count = (this.calls.get(request.frameNumber) ?? 0) + 1;
      this.calls.set(request.frameNumber, count);
      if (request.frameNumber === 1 && count === 1) {
        const error = new Error('temporary throttle'); error.statusCode = 429; throw error;
      }
      return { bytes: imageBytes, contentType: 'image/png', elapsedMs: 1, taskId: `retry-${request.frameNumber}-${count}` };
    }
  }
  const retryAttempts = [];
  await new RetryingParallelAdapter().generateImage({
    task: 'fighter-1x6-row', moveId: 'punch', prompt: 'A boxer.',
    onGenerationAttempt: async (event) => { retryAttempts.push(event); },
  });
  assert.equal(retryAttempts.length, 7, 'a retried frame creates a second attempt record');
  assert.deepEqual(
    retryAttempts.filter((attempt) => attempt.frameNumber === 1).map((attempt) => [attempt.attemptNumber, attempt.status]),
    [[1, 'failed'], [2, 'succeeded']],
  );
  const sheetPath = path.join(temporaryDirectory, 'sheet.png');
  await import('node:fs/promises').then(({ writeFile }) => writeFile(sheetPath, sheet.bytes));
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', sheetPath]);
  assert.equal(stdout.trim(), '3072x512');

  const badBackgroundPath = path.join(temporaryDirectory, 'bad-background.png');
  await execFileAsync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', 'color=c=navy:s=96x128', '-frames:v', '1', badBackgroundPath,
  ]);
  const badBackgroundBytes = await readFile(badBackgroundPath);
  await assert.rejects(
    () => composeFrameSheetWithFfmpeg({
      frames: Array.from({ length: 6 }, () => ({ bytes: badBackgroundBytes, contentType: 'image/png' })),
      task: 'fighter-1x6-row',
    }),
    /rejected before tiling.*chroma magenta/i,
  );

  const geminiRequests = [];
  const gemini = new GeminiFlashImageGeneratorAdapter({ apiKey: 'test', fetch: async (url, options) => {
    geminiRequests.push({ url, body: JSON.parse(options.body) });
    return jsonResponse({ id: 'gemini-frame', output_image: { mime_type: 'image/png', data: imageBase64 }, usage: { total_tokens: 5 } });
  } });
  const geminiFrame = await gemini.generateFrame({ prompt: 'frame', aspectRatio: '1:1', referenceImages: [{ base64: imageBase64, contentType: 'image/png' }] });
  assert.deepEqual(geminiFrame.bytes, imageBytes);
  assert.equal(geminiRequests[0].body.input[1].mime_type, 'image/png');
  assert.equal(geminiRequests[0].body.response_format.image_size, '1K');

  const minimaxRequests = [];
  const minimax = new MinimaxImage01GeneratorAdapter({ apiKey: 'test', fetch: async (_url, options) => {
    minimaxRequests.push(JSON.parse(options.body));
    return jsonResponse({ data: { image_base64: [imageBase64] }, id: 'minimax-frame' });
  } });
  const minimaxFrame = await minimax.generateFrame({ prompt: 'frame', aspectRatio: '1:1', referenceImages: [{ base64: imageBase64, contentType: 'image/png' }] });
  assert.deepEqual(minimaxFrame.bytes, imageBytes);
  assert.ok(minimaxFrame.stageTimings.apiRequestAndGenerationMs >= 0);
  assert.equal(minimaxRequests[0].model, 'image-01');
  assert.match(minimaxRequests[0].subject_reference[0].image_file, /^data:image\/png;base64,/);

  let bflPolls = 0;
  const bfl = new BflFluxKleinGeneratorAdapter({ apiKey: 'test', sleep: async () => {}, fetch: async (url) => {
    if (url.endsWith('/v1/flux-2-klein-4b')) return jsonResponse({ id: 'bfl-frame', polling_url: 'https://bfl.test/poll' });
    if (url === 'https://bfl.test/poll') { bflPolls += 1; return jsonResponse({ status: 'Ready', result: { sample: 'https://bfl.test/frame.png' } }); }
    if (url === 'https://bfl.test/frame.png') return new Response(imageBytes, { status: 200, headers: { 'content-type': 'image/png' } });
    throw new Error(`Unexpected BFL URL ${url}`);
  } });
  const bflFrame = await bfl.generateFrame({ prompt: 'frame', referenceImages: [] });
  assert.deepEqual(bflFrame.bytes, imageBytes);
  assert.ok(bflFrame.stageTimings.queueAndGenerationMs >= 0);
  assert.equal(bflPolls, 1);

  const fal = new FalImageGeneratorAdapter({ apiKey: 'test', sleep: async () => {}, fetch: async (url) => {
    if (url === 'https://queue.fal.run/fal-ai/flux-2/klein/4b/edit') return jsonResponse({ request_id: 'fal-frame', status_url: 'https://fal.test/status', response_url: 'https://fal.test/result' });
    if (url === 'https://fal.test/status') return jsonResponse({ status: 'COMPLETED' });
    if (url === 'https://fal.test/result') return jsonResponse({ images: [{ url: 'https://fal.test/frame.png' }] });
    if (url === 'https://fal.test/frame.png') return new Response(imageBytes, { status: 200, headers: { 'content-type': 'image/png' } });
    throw new Error(`Unexpected fal URL ${url}`);
  } });
  const falFrame = await fal.generateFrame({ prompt: 'frame', referenceImages: [] });
  assert.deepEqual(falFrame.bytes, imageBytes);
  assert.ok(falFrame.stageTimings.downloadMs >= 0);
  assert.equal(payloadForModel({ model: 'fal-ai/instant-character', prompt: 'x', references: [{ base64: imageBase64, contentType: 'image/png' }] }).image_url.startsWith('data:image/png;base64,'), true);
  assert.equal(payloadForModel({ model: 'fal-ai/flux-2/klein/4b/edit', prompt: 'x', references: [{ base64: imageBase64, contentType: 'image/png' }], inferenceSteps: 4 }).image_urls.length, 1);

  assert.equal(createImageGeneratorAdapter({ provider: 'minimax-image', apiKey: 'x' }).provider, 'minimax-image');
  assert.equal(createImageGeneratorAdapter({ provider: 'gemini-fast', apiKey: 'x' }).provider, 'gemini-fast');
  assert.equal(createImageGeneratorAdapter({ provider: 'bfl-klein', apiKey: 'x' }).provider, 'bfl-klein');
  assert.equal(createImageGeneratorAdapter({ provider: 'fal', apiKey: 'x' }).provider, 'fal');
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log('Fast image generator smoke test passed.');

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}
