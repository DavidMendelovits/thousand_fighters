import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { rowPromptProfile } from '../rowPromptProfiles.js';
import { pixelArtDirection } from './pixelArtDirection.js';
import { runGenerationAttempt } from '../generationAttemptTelemetry.js';

const execFileAsync = promisify(execFile);
const FRAME_COUNT = 6;

/**
 * Shared fast-image workflow: ask a provider for six independent frames in
 * parallel, normalize them locally, then tile one deterministic PNG sheet.
 * Provider adapters only implement generateFrame().
 */
export class ParallelFrameSpriteGenerator {
  constructor(options = {}) {
    this.frameConcurrency = positiveInteger(
      options.frameConcurrency ?? process.env.FAST_IMAGE_FRAME_CONCURRENCY,
      FRAME_COUNT,
    );
    this.frameRetries = nonNegativeInteger(options.frameRetries ?? process.env.FAST_IMAGE_FRAME_RETRIES, 2);
    this.frameRetryDelayMs = positiveInteger(options.frameRetryDelayMs ?? process.env.FAST_IMAGE_FRAME_RETRY_DELAY_MS, 750);
    this.requireMagentaBackground = booleanOption(
      options.requireMagentaBackground ?? process.env.FAST_IMAGE_REQUIRE_MAGENTA_BACKGROUND,
      true,
    );
    this.ffmpegBin = options.ffmpegBin ?? process.env.FFMPEG_BIN ?? 'ffmpeg';
    this.now = options.now ?? (() => Date.now());
    this.composeFrameSheet = options.composeFrameSheet ?? ((args) => composeFrameSheetWithFfmpeg({
      ...args,
      ffmpegBin: this.ffmpegBin,
    }));
  }

  async generateImage(request = {}) {
    const task = request.task ?? 'fighter-1x6-row';
    if (task !== 'fighter-1x6-row' && task !== 'fighter-2x3-grid') {
      return this.generateSingleImage(request);
    }

    const startedAt = this.now();
    const prompts = Array.from({ length: FRAME_COUNT }, (_, index) => framePromptFor(request, index));
    request.onProgress?.({
      type: 'status',
      stage: 'parallel-frames',
      message: `Generating six ${this.provider} frames with concurrency ${Math.min(this.frameConcurrency, FRAME_COUNT)}.`,
    });

    const frames = await mapWithConcurrency(prompts, this.frameConcurrency, async (prompt, index) => {
      const frameStartedAt = this.now();
      const frameRequest = {
        ...request,
        prompt,
        frameIndex: index,
        frameNumber: index + 1,
        frameCount: FRAME_COUNT,
        aspectRatio: '1:1',
      };
      let result;
      for (let attempt = 0; attempt <= this.frameRetries; attempt += 1) {
        try {
          const attemptRequest = { ...frameRequest, attemptNumber: attempt + 1 };
          result = await runGenerationAttempt(attemptRequest, {
            kind: 'image',
            provider: this.provider,
            model: this.model,
            operation: request.task ?? 'sprite-frame',
            frameNumber: index + 1,
            attemptNumber: attempt + 1,
            now: this.now,
          }, () => this.generateFrame(attemptRequest));
          break;
        } catch (error) {
          if (attempt === this.frameRetries || !isRetryable(error)) throw error;
          request.onProgress?.({
            type: 'warning',
            stage: 'frame-retry',
            frameNumber: index + 1,
            attempt: attempt + 1,
            message: `Frame ${index + 1} hit a transient provider error; retrying.`,
          });
          await new Promise((resolve) => setTimeout(resolve, this.frameRetryDelayMs * (attempt + 1)));
        }
      }
      const bytes = bytesFromResult(result);
      const elapsedMs = result.elapsedMs ?? (this.now() - frameStartedAt);
      request.onProgress?.({
        type: 'status',
        stage: 'frame-complete',
        frameNumber: index + 1,
        elapsedMs,
        message: `Frame ${index + 1}/6 complete in ${elapsedMs}ms.`,
      });
      return {
        ...result,
        bytes,
        contentType: result.contentType ?? 'image/png',
        elapsedMs,
        stageTimings: result.stageTimings ?? null,
        frameNumber: index + 1,
      };
    });
    const generationCompletedAt = this.now();
    const frameTimings = frames.map(({ frameNumber, elapsedMs, taskId, stageTimings, generationAttemptId }) => ({
      frameNumber, elapsedMs, taskId: taskId ?? null, generationAttemptId: generationAttemptId ?? null, stages: stageTimings,
    }));
    const costValues = frames
      .map((frame) => frame.estimatedCostUsd)
      .filter((value) => value !== null && value !== undefined && value !== '')
      .map(Number)
      .filter(Number.isFinite);

    request.onProgress?.({ type: 'status', stage: 'compose', message: 'Aligning and tiling the six frames locally.' });
    let sheetBytes;
    try {
      sheetBytes = await this.composeFrameSheet({
        frames,
        task,
        requireMagentaBackground: this.requireMagentaBackground,
      });
    } catch (error) {
      const failedAt = this.now();
      error.stageTimings = {
        providerBatchMs: generationCompletedAt - startedAt,
        spriteCompositionMs: failedAt - generationCompletedAt,
        totalAdapterMs: failedAt - startedAt,
        frames: frameTimings,
      };
      error.frameTimings = frameTimings;
      error.estimatedCostUsd = costValues.length ? costValues.reduce((sum, value) => sum + value, 0) : null;
      throw error;
    }
    const completedAt = this.now();

    return {
      provider: this.provider,
      model: this.model,
      promptRef: frames.map((frame) => frame.taskId ?? frame.promptRef).filter(Boolean).join(','),
      contentType: 'image/png',
      bytes: sheetBytes,
      base64: sheetBytes.toString('base64'),
      generationMs: generationCompletedAt - startedAt,
      postprocessMs: completedAt - generationCompletedAt,
      elapsedMs: completedAt - startedAt,
      stageTimings: {
        providerBatchMs: generationCompletedAt - startedAt,
        spriteCompositionMs: completedAt - generationCompletedAt,
        totalAdapterMs: completedAt - startedAt,
        frames: frameTimings,
      },
      frameTimings,
      frameImages: frames.map(({ frameNumber, bytes, contentType, taskId }) => ({ frameNumber, bytes, contentType, taskId: taskId ?? null })),
      usage: mergeUsage(frames.map((frame) => frame.usage)),
      estimatedCostUsd: costValues.length ? costValues.reduce((sum, value) => sum + value, 0) : null,
    };
  }

  async generateSingleImage(request) {
    const startedAt = this.now();
    const singleRequest = {
      ...request,
      prompt: stillPromptFor(request),
      frameIndex: 0,
      frameNumber: 1,
      frameCount: 1,
      aspectRatio: aspectRatioForTask(request.task),
      attemptNumber: 1,
    };
    const result = await runGenerationAttempt(singleRequest, {
      kind: 'image', provider: this.provider, model: this.model,
      operation: request.task ?? 'image-generation', now: this.now,
    }, () => this.generateFrame(singleRequest));
    const bytes = bytesFromResult(result);
    const completedAt = this.now();
    return {
      ...result,
      provider: result.provider ?? this.provider,
      model: result.model ?? this.model,
      contentType: result.contentType ?? 'image/png',
      bytes,
      base64: bytes.toString('base64'),
      generationMs: result.generationMs ?? result.elapsedMs ?? (completedAt - startedAt),
      postprocessMs: 0,
      elapsedMs: result.elapsedMs ?? (completedAt - startedAt),
      stageTimings: result.stageTimings ?? {
        providerRequestMs: result.elapsedMs ?? (completedAt - startedAt),
        totalAdapterMs: result.elapsedMs ?? (completedAt - startedAt),
      },
    };
  }
}

export async function composeFrameSheetWithFfmpeg({ frames, task, ffmpegBin = 'ffmpeg', requireMagentaBackground = true }) {
  if (!Array.isArray(frames) || frames.length !== FRAME_COUNT) {
    throw new Error(`Expected exactly ${FRAME_COUNT} frames, received ${frames?.length ?? 0}.`);
  }
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'thousand-fighters-frames-'));
  const outputPath = path.join(temporaryDirectory, 'sheet.png');
  try {
    const inputPaths = [];
    for (const [index, frame] of frames.entries()) {
      const inputPath = path.join(temporaryDirectory, `frame-${index + 1}${extensionForContentType(frame.contentType)}`);
      await writeFile(inputPath, bytesFromResult(frame));
      if (requireMagentaBackground) {
        const cornerMagentaRatio = await magentaCornerRatio(inputPath, ffmpegBin);
        if (cornerMagentaRatio < 0.75) {
          throw new Error(
            `Frame ${index + 1} rejected before tiling: only ${(cornerMagentaRatio * 100).toFixed(0)}% of corner pixels are chroma magenta. ` +
            'The provider likely invented scenery, lighting, or a non-removable background.',
          );
        }
      }
      inputPaths.push(inputPath);
    }

    const wide = task === 'fighter-2x3-grid';
    const cellWidth = wide ? 640 : 512;
    const cellHeight = wide ? 360 : 512;
    // Force a low native raster before a nearest-neighbor upscale. Even when a
    // provider sneaks in smooth edges, the stored sheet has deliberate square
    // pixel clusters instead of action-figure gloss.
    const pixelWidth = wide ? 160 : 128;
    const pixelHeight = wide ? 90 : 128;
    const filters = frames.map((_, index) =>
      `[${index}:v]scale=${pixelWidth}:${pixelHeight}:force_original_aspect_ratio=decrease:flags=area,` +
      `pad=${pixelWidth}:${pixelHeight}:(ow-iw)/2:oh-ih:color=0xFF00FF,` +
      `scale=${cellWidth}:${cellHeight}:flags=neighbor,setsar=1[f${index}]`,
    );
    if (wide) {
      filters.push('[f0][f1][f2]hstack=inputs=3[top]');
      filters.push('[f3][f4][f5]hstack=inputs=3[bottom]');
      filters.push('[top][bottom]vstack=inputs=2[out]');
    } else {
      filters.push('[f0][f1][f2][f3][f4][f5]hstack=inputs=6[out]');
    }

    await execFileAsync(ffmpegBin, [
      '-hide_banner', '-loglevel', 'error', '-y',
      ...inputPaths.flatMap((inputPath) => ['-i', inputPath]),
      '-filter_complex', filters.join(';'),
      '-map', '[out]', '-frames:v', '1', outputPath,
    ], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
    return await readFile(outputPath);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function magentaCornerRatio(inputPath, ffmpegBin) {
  const { stdout } = await execFileAsync(ffmpegBin, [
    '-hide_banner', '-loglevel', 'error', '-i', inputPath,
    '-vf', 'scale=64:64:flags=area,format=rgb24',
    '-frames:v', '1', '-f', 'rawvideo', 'pipe:1',
  ], { encoding: null, timeout: 15_000, maxBuffer: 64 * 64 * 3 + 1024 });
  let matching = 0;
  let sampled = 0;
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const inCorner = (x < 8 || x >= 56) && (y < 8 || y >= 56);
      if (!inCorner) continue;
      const offset = (y * 64 + x) * 3;
      const red = stdout[offset];
      const green = stdout[offset + 1];
      const blue = stdout[offset + 2];
      sampled += 1;
      if (red >= 200 && green <= 70 && blue >= 200) matching += 1;
    }
  }
  return sampled ? matching / sampled : 0;
}

function framePromptFor(request, frameIndex) {
  const moveId = request.moveId ?? 'base';
  const profile = rowPromptProfile(moveId);
  return [
    pixelArtDirection(),
    request.prompt?.trim(),
    `FRAME ${frameIndex + 1} OF 6 — ${profile.description}.`,
    `Animation timing: ${profile.frameRoles}. Output ONLY frame ${frameIndex + 1}; never a sheet, sequence, collage, or multiple poses.`,
    'Exactly ONE uncropped full-body fighter facing screen-right, centered, feet near the bottom.',
    'The fighter mimes the action alone into empty air. NO opponent, second person, duplicate, target, or extra limb.',
    'The supplied sprite is binding: copy its 2D medium, character, costume, proportions, palette, camera, scale, and floor line.',
    profile.scaleNote,
    'Background: every pixel exactly solid RGB(255,0,255) #FF00FF. No floor, horizon, gradient, shadow, scenery, text, border, or UI.',
  ].filter(Boolean).join('\n\n');
}

function stillPromptFor(request) {
  return [
    pixelArtDirection(),
    request.prompt?.trim(),
    request.task === 'arena-background'
      ? 'Create one clean 16:9 fighting-game arena background. No characters, text, borders, or UI.'
      : 'Create one polished game asset only. No contact sheet, text, border, watermark, or UI.',
  ].filter(Boolean).join('\n\n');
}

function aspectRatioForTask(task) {
  return task === 'arena-background' ? '16:9' : '1:1';
}

async function mapWithConcurrency(values, limit, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, limit), values.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  }));
  return results;
}

function bytesFromResult(result) {
  if (result?.bytes) return Buffer.from(result.bytes);
  if (result?.base64) return Buffer.from(result.base64, 'base64');
  throw new Error('Image provider returned no bytes or base64 image data.');
}

function mergeUsage(usages) {
  const present = usages.filter((usage) => usage && typeof usage === 'object');
  if (!present.length) return null;
  return present.reduce((total, usage) => {
    for (const [key, value] of Object.entries(usage)) {
      if (typeof value === 'number') total[key] = (total[key] ?? 0) + value;
    }
    return total;
  }, {});
}

function extensionForContentType(contentType = '') {
  if (contentType.includes('webp')) return '.webp';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return '.jpg';
  return '.png';
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function isRetryable(error) {
  const status = Number(error?.statusCode);
  return !Number.isFinite(status) || status === 408 || status === 409 || status === 429 || status >= 500;
}

function booleanOption(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || String(value).toLowerCase() === 'true' || String(value) === '1';
}
