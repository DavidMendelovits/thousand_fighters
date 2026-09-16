import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { rowPromptProfile } from '../rowPromptProfiles.js';
import { pixelArtDirection } from './pixelArtDirection.js';

const execFileAsync = promisify(execFile);

const DEFAULT_BASE_URL = 'https://api.minimax.io';
const DEFAULT_MODEL = 'MiniMax-H3';
const DEFAULT_RESOLUTION = '768P';
const DEFAULT_DURATION_SECONDS = 4;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 15 * 60_000;
const TERMINAL_FAILURE_STATUSES = new Set(['failed', 'cancelled']);

/**
 * Adapts MiniMax H3's motion-video API to the CMS image-generator port.
 *
 * H3 produces a short move clip. We retain that MP4 for review, sample six
 * evenly-spaced frames, and tile them into the same row/grid contract consumed
 * by extract_row_frames.py. The rest of the fighter pipeline does not need to
 * know that the source was video.
 */
export class MinimaxH3SpriteSheetGeneratorAdapter {
  constructor(options = {}) {
    this.apiKey = options.apiKey
      ?? process.env.MINIMAX_API_KEY
      ?? process.env.MINIMAX_API_TOKEN
      ?? '';
    this.baseUrl = options.baseUrl ?? process.env.MINIMAX_API_BASE_URL ?? DEFAULT_BASE_URL;
    this.model = options.model ?? process.env.MINIMAX_H3_MODEL ?? DEFAULT_MODEL;
    this.resolution = options.resolution ?? process.env.MINIMAX_H3_RESOLUTION ?? DEFAULT_RESOLUTION;
    const defaultDuration = this.model === 'MiniMax-H3-Max' ? 5 : DEFAULT_DURATION_SECONDS;
    this.duration = integerOption(options.duration ?? process.env.MINIMAX_H3_DURATION, defaultDuration);
    this.pollIntervalMs = integerOption(
      options.pollIntervalMs ?? process.env.MINIMAX_H3_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS,
    );
    this.timeoutMs = integerOption(options.timeoutMs ?? process.env.MINIMAX_H3_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
    this.ffmpegBin = options.ffmpegBin ?? process.env.FFMPEG_BIN ?? 'ffmpeg';
    this.fetch = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => Date.now());
    this.composeSpriteSheet = options.composeSpriteSheet ?? ((args) => composeSpriteSheetWithFfmpeg({
      ...args,
      ffmpegBin: this.ffmpegBin,
    }));
    this.id = options.id ?? 'minimax-h3-sprite-sheet-generator';
    this.provider = 'minimax-h3';
    this.capabilities = [
      'fighter-1x6-row',
      'fighter-2x3-grid',
      'video-to-sprite-sheet',
      'reference-image',
      'source-video-retention',
    ];

    validateConfiguration(this);
  }

  async healthCheck() {
    let ffmpegStatus = 'ok';
    let ffmpegMessage = this.ffmpegBin;
    try {
      const { stdout } = await execFileAsync(this.ffmpegBin, ['-version'], {
        timeout: 5_000,
        maxBuffer: 1024 * 1024,
      });
      ffmpegMessage = stdout.split('\n')[0]?.trim() || this.ffmpegBin;
    } catch (error) {
      ffmpegStatus = 'error';
      ffmpegMessage = error.message;
    }

    const configured = Boolean(this.apiKey);
    return {
      status: configured && ffmpegStatus === 'ok' ? 'ok' : 'error',
      message: !configured
        ? 'MINIMAX_API_KEY is required for IMAGE_GENERATOR_PROVIDER=minimax-h3.'
        : ffmpegStatus === 'error'
          ? `MiniMax H3 is configured, but ffmpeg is unavailable: ${ffmpegMessage}`
          : `MiniMax H3 sprite generation is configured with ${this.model}; six frames will be sampled from each ${this.duration}s clip.`,
      details: {
        model: this.model,
        resolution: this.resolution,
        durationSeconds: this.duration,
        baseUrl: this.baseUrl,
        ffmpeg: ffmpegMessage,
      },
    };
  }

  async generateImage(request = {}) {
    if (!this.apiKey) {
      const error = new Error('MINIMAX_API_KEY is required for MiniMax H3 sprite generation.');
      error.statusCode = 503;
      throw error;
    }

    const task = request.task ?? 'fighter-1x6-row';
    if (task !== 'fighter-1x6-row' && task !== 'fighter-2x3-grid') {
      throw new Error(`MiniMax H3 only supports fighter row generation, not ${task}. Use OpenAI or Codex for still-image tasks.`);
    }

    const startedAt = this.now();
    const referenceImages = this.model === 'MiniMax-H3-Max' ? [] : (request.referenceImages ?? []).slice(0, 9);
    if (this.model === 'MiniMax-H3-Max' && request.referenceImages?.length) {
      request.onProgress?.({
        type: 'warning',
        message: 'MiniMax-H3-Max does not support reference-to-video; identity references were omitted for this speed run.',
      });
    }
    const prompt = h3PromptFor({ ...request, referenceImages });
    const content = [
      { type: 'text', text: prompt },
      ...referenceImages.map(referenceContentItem),
    ];
    const ratio = request.ratio ?? (task === 'fighter-2x3-grid' ? '16:9' : '1:1');
    const payload = {
      model: this.model,
      content,
      resolution: this.resolution,
      duration: this.duration,
      ratio,
    };

    request.onProgress?.({
      type: 'prompt',
      task,
      prompt,
      provider: this.provider,
      model: this.model,
    });
    request.onProgress?.({ type: 'status', stage: 'submit', message: 'Submitting MiniMax H3 video generation.' });

    const createResult = await this.requestJson('/v2/video_generation', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const taskId = createResult.task_id;
    if (!taskId) throw new Error('MiniMax H3 did not return a task_id.');

    request.onProgress?.({ type: 'status', stage: 'queued', taskId, message: `MiniMax H3 task ${taskId} queued.` });
    const completedTask = await this.waitForTask(taskId, request.onProgress);
    const generationCompletedAt = this.now();
    const videoUrl = completedTask.content?.url;
    if (!videoUrl) throw new Error(`MiniMax H3 task ${taskId} succeeded without a video URL.`);

    request.onProgress?.({ type: 'status', stage: 'download', taskId, message: 'Downloading H3 source video.' });
    const videoResponse = await this.fetch(videoUrl);
    if (!videoResponse.ok) {
      throw httpError(`MiniMax H3 video download failed with ${videoResponse.status}`, videoResponse.status);
    }
    const videoBytes = Buffer.from(await videoResponse.arrayBuffer());

    request.onProgress?.({ type: 'status', stage: 'compose', taskId, message: 'Sampling six frames and composing the sprite sheet.' });
    const sheetBytes = await this.composeSpriteSheet({
      videoBytes,
      task,
      duration: completedTask.duration ?? this.duration,
    });
    const completedAt = this.now();

    request.onProgress?.({ type: 'complete', taskId, elapsedMs: completedAt - startedAt });
    return {
      provider: this.provider,
      model: completedTask.model ?? this.model,
      promptRef: taskId,
      taskId,
      contentType: 'image/png',
      base64: sheetBytes.toString('base64'),
      bytes: sheetBytes,
      videoBytes,
      videoContentType: 'video/mp4',
      videoUrl,
      generationMs: generationCompletedAt - startedAt,
      postprocessMs: completedAt - generationCompletedAt,
      elapsedMs: completedAt - startedAt,
      usage: completedTask.usage ?? null,
      ratio: completedTask.ratio ?? ratio,
      resolution: completedTask.resolution ?? this.resolution,
      duration: completedTask.duration ?? this.duration,
    };
  }

  async waitForTask(taskId, onProgress) {
    const startedAt = this.now();
    let lastStatus = '';
    while (this.now() - startedAt <= this.timeoutMs) {
      const result = await this.requestJson(`/v2/query/video_generation/${encodeURIComponent(taskId)}`, {
        method: 'GET',
      });
      const task = result.task;
      if (!task) throw new Error(`MiniMax H3 query for ${taskId} did not return a task.`);

      if (task.status !== lastStatus) {
        lastStatus = task.status;
        onProgress?.({
          type: 'status',
          stage: task.status,
          taskId,
          message: `MiniMax H3 task ${taskId}: ${task.status}.`,
        });
      }

      if (task.status === 'succeeded') return task;
      if (TERMINAL_FAILURE_STATUSES.has(task.status)) {
        const reason = task.error?.message ?? task.failure_reason ?? task.fail_reason ?? 'No failure reason was supplied.';
        throw new Error(`MiniMax H3 task ${taskId} ${task.status}: ${reason}`);
      }

      await this.sleep(this.pollIntervalMs);
    }

    throw new Error(`MiniMax H3 task ${taskId} timed out after ${this.timeoutMs}ms.`);
  }

  async requestJson(relativePath, options) {
    const response = await this.fetch(`${this.baseUrl.replace(/\/$/, '')}${relativePath}`, {
      ...options,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.headers ?? {}),
      },
    });
    const text = await response.text();
    let value = {};
    if (text) {
      try {
        value = JSON.parse(text);
      } catch {
        throw httpError(`MiniMax H3 returned invalid JSON with status ${response.status}.`, response.status);
      }
    }
    if (!response.ok) {
      const message = value.error?.message ?? value.base_resp?.status_msg ?? `MiniMax H3 request failed with ${response.status}`;
      const error = httpError(message, response.status);
      error.details = value;
      throw error;
    }
    return value;
  }
}

function referenceContentItem(image) {
  const contentType = image.contentType ?? 'image/png';
  return {
    type: 'image_url',
    image_url: {
      url: `data:${contentType};base64,${image.base64}`,
    },
    role: 'reference_image',
  };
}

function h3PromptFor(request) {
  const moveId = request.moveId ?? request.context?.moveId ?? 'base';
  const profile = rowPromptProfile(moveId);
  const idleDirection = profile.idle
    ? 'This is a restrained seamless idle loop: subtle breathing and weight shift only; feet remain planted.'
    : `Stage the move in six readable beats: ${profile.frameRoles}.`;

  return [
    pixelArtDirection(),
    'Create a short source animation for a 2D side-view fighting game sprite.',
    `One fighter performs the ${moveId} animation from beginning through recovery.`,
    idleDirection,
    'Locked orthographic side camera. No zoom, pan, cut, shake, rotation, or perspective change.',
    'The fighter faces right. Keep the full body, feet, hands, hair, clothing, weapons, and attached effects visible at all times.',
    'Exactly one figure. No opponent, duplicate, bystanders, text, UI, ground shadow, or scenery.',
    'Keep character identity, costume, proportions, scale, palette, lighting, and floor position consistent for the entire clip.',
    'Use a perfectly flat, evenly lit chroma-magenta #ff00ff background with a crisp silhouette and no color spill.',
    'Begin in a readable anticipation pose and finish in a readable recovery pose. Motion should be continuous, not a montage.',
    '',
    'Character and move direction:',
    request.prompt ?? '',
    '',
    request.referenceImages?.length
      ? 'Attached images define the fighter identity and visual style. Preserve them exactly while animating the requested move.'
      : '',
  ].filter(Boolean).join('\n');
}

export async function composeSpriteSheetWithFfmpeg({ videoBytes, task, duration, sampleTimes, ffmpegBin = 'ffmpeg' }) {
  if(sampleTimes!==undefined&&(!Array.isArray(sampleTimes)||sampleTimes.length!==6||sampleTimes[0]!==0||sampleTimes.some((t,i)=>!Number.isFinite(t)||t<0||t>Number(duration)-.05||(i>0&&t<=sampleTimes[i-1]))))throw new Error('Choose six increasing sample times, starting at 0 and ending before the video ends.');
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'tf-minimax-h3-'));
  try {
    const inputPath = path.join(tempDir, 'source.mp4');
    const outputPath = path.join(tempDir, 'sheet.png');
    await writeFile(inputPath, videoBytes);

    const wide = task === 'fighter-2x3-grid';
    const cellWidth = wide ? 640 : 512;
    const cellHeight = wide ? 360 : 512;
    const pixelWidth = wide ? 160 : 128;
    const pixelHeight = wide ? 90 : 128;
    const columns = wide ? 3 : 6;
    const rows = wide ? 2 : 1;
    const safeDuration = Math.max(1, Number(duration) || DEFAULT_DURATION_SECONDS);
    const filter = [
      // Keep the actual reference frame at t=0. fps used a midpoint sample,
      // sometimes already crouched, corrupting normalization's scale anchor.
      sampleTimes?`select='${sampleTimes.map((t,i)=>`eq(selected_n,${i})*gte(t,${t})`).join('+')}'`:`select='eq(n,0)+gte(t-prev_selected_t,${safeDuration/6})'`,
      `scale=${pixelWidth}:${pixelHeight}:force_original_aspect_ratio=decrease:flags=area`,
      `pad=${pixelWidth}:${pixelHeight}:(ow-iw)/2:(oh-ih)/2:color=0xFF00FF`,
      `scale=${cellWidth}:${cellHeight}:flags=neighbor`,
      `tile=${columns}x${rows}:nb_frames=6:padding=0:margin=0`,
    ].join(',');

    try {
      await execFileAsync(ffmpegBin, [
        '-hide_banner',
        '-loglevel', 'error',
        '-y',
        '-i', inputPath,
        '-vf', filter,
        '-frames:v', '1',
        outputPath,
      ], {
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (error) {
      const detail = error.stderr?.trim() || error.message;
      throw new Error(`Could not compose the MiniMax H3 sprite sheet with ffmpeg: ${detail}`);
    }

    return await readFile(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function validateConfiguration(adapter) {
  if (!['MiniMax-H3', 'MiniMax-H3-Max'].includes(adapter.model)) {
    throw new Error(`Unsupported MiniMax H3 model: ${adapter.model}`);
  }
  const minimumDuration = adapter.model === 'MiniMax-H3-Max' ? 5 : 4;
  if (adapter.duration < minimumDuration || adapter.duration > 15) {
    throw new Error(`${adapter.model} duration must be an integer from ${minimumDuration} to 15 seconds.`);
  }
  const allowedResolutions = adapter.model === 'MiniMax-H3-Max' ? ['480P', '768P'] : ['768P', '2K'];
  if (!allowedResolutions.includes(adapter.resolution)) {
    throw new Error(`${adapter.model} resolution must be one of: ${allowedResolutions.join(', ')}.`);
  }
}

function integerOption(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`Expected an integer configuration value, received: ${value}`);
  return parsed;
}

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
