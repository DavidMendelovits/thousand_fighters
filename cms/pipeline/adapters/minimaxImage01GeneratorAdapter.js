import { ParallelFrameSpriteGenerator } from './parallelFrameSpriteGenerator.js';
import { dataUrlForImage, nonNegativeNumber, responseJson } from './remoteImageAdapterUtils.js';

const DEFAULT_BASE_URL = 'https://api.minimax.io';
const DEFAULT_MODEL = 'image-01';

export class MinimaxImage01GeneratorAdapter extends ParallelFrameSpriteGenerator {
  constructor(options = {}) {
    super({
      ...options,
      frameConcurrency: options.frameConcurrency
        ?? process.env.MINIMAX_IMAGE_FRAME_CONCURRENCY
        ?? process.env.FAST_IMAGE_FRAME_CONCURRENCY
        ?? 3,
    });
    this.apiKey = options.apiKey ?? process.env.MINIMAX_API_KEY ?? '';
    this.baseUrl = options.baseUrl ?? process.env.MINIMAX_API_BASE_URL ?? DEFAULT_BASE_URL;
    this.model = options.model ?? process.env.MINIMAX_IMAGE_MODEL ?? DEFAULT_MODEL;
    this.promptOptimizer = booleanOption(options.promptOptimizer ?? process.env.MINIMAX_IMAGE_PROMPT_OPTIMIZER, false);
    this.referenceMode = options.referenceMode ?? process.env.MINIMAX_IMAGE_REFERENCE_MODE ?? 'data-url';
    this.costPerImageUsd = nonNegativeNumber(options.costPerImageUsd ?? process.env.MINIMAX_IMAGE_COST_PER_FRAME_USD);
    this.fetch = options.fetch ?? globalThis.fetch;
    this.id = options.id ?? 'minimax-image-01-generator';
    this.provider = 'minimax-image';
    this.capabilities = ['fighter-1x6-row', 'fighter-2x3-grid', 'character-concept', 'arena-background', 'projectile-sprite', 'parallel-frame-generation', 'subject-reference'];
  }

  async healthCheck() {
    return {
      status: this.apiKey ? 'ok' : 'error',
      message: this.apiKey
        ? `MiniMax still-image generation is configured with ${this.model}.`
        : 'MINIMAX_API_KEY is required for IMAGE_GENERATOR_PROVIDER=minimax-image.',
      details: { model: this.model, referenceMode: this.referenceMode },
    };
  }

  async generateFrame(request) {
    if (!this.apiKey) throw missingKey('MINIMAX_API_KEY is required for MiniMax image generation.');
    const startedAt = this.now();
    const reference = this.referenceMode === 'omit' ? null : request.referenceImages?.[0];
    const payload = {
      model: this.model,
      prompt: request.prompt.slice(0, 1500),
      aspect_ratio: request.aspectRatio ?? '1:1',
      response_format: 'base64',
      n: 1,
      prompt_optimizer: this.promptOptimizer,
      ...(reference ? { subject_reference: [{ type: 'character', image_file: dataUrlForImage(reference) }] } : {}),
    };
    const response = await this.fetch(`${this.baseUrl.replace(/\/$/, '')}/v1/image_generation`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const value = await responseJson(response, 'MiniMax Image-01');
    const apiRequestAndGenerationMs = this.now() - startedAt;
    const base64 = Array.isArray(value.data?.image_base64) ? value.data.image_base64[0] : value.data?.image_base64;
    if (base64) {
      return {
        provider: this.provider,
        model: this.model,
        bytes: Buffer.from(base64, 'base64'),
        contentType: 'image/png',
        elapsedMs: this.now() - startedAt,
        stageTimings: { apiRequestAndGenerationMs, downloadMs: 0, totalProviderMs: this.now() - startedAt },
        taskId: value.id ?? value.trace_id ?? null,
        usage: value.usage ?? null,
        estimatedCostUsd: this.costPerImageUsd,
      };
    }
    const imageUrl = value.data?.image_urls?.[0];
    if (!imageUrl) throw new Error('MiniMax Image-01 completed without returning image data.');
    const downloadStartedAt = this.now();
    const imageResponse = await this.fetch(imageUrl);
    if (!imageResponse.ok) throw new Error(`MiniMax Image-01 download failed with status ${imageResponse.status}.`);
    const bytes = Buffer.from(await imageResponse.arrayBuffer());
    const downloadMs = this.now() - downloadStartedAt;
    return {
      provider: this.provider,
      model: this.model,
      bytes,
      contentType: imageResponse.headers.get('content-type')?.split(';')[0] ?? 'image/png',
      elapsedMs: this.now() - startedAt,
      stageTimings: { apiRequestAndGenerationMs, downloadMs, totalProviderMs: this.now() - startedAt },
      taskId: value.id ?? value.trace_id ?? null,
      usage: value.usage ?? null,
      estimatedCostUsd: this.costPerImageUsd,
    };
  }
}

function booleanOption(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true' || String(value) === '1';
}

function missingKey(message) {
  const error = new Error(message);
  error.statusCode = 503;
  return error;
}
