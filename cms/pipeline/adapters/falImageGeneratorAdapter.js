import { ParallelFrameSpriteGenerator } from './parallelFrameSpriteGenerator.js';
import { dataUrlForImage, downloadImage, nonNegativeNumber, positiveInteger, responseJson } from './remoteImageAdapterUtils.js';

const DEFAULT_QUEUE_URL = 'https://queue.fal.run';
const DEFAULT_MODEL = 'fal-ai/flux-2/klein/4b/edit';
const TERMINAL_FAILURES = new Set(['FAILED', 'CANCELLED']);

export class FalImageGeneratorAdapter extends ParallelFrameSpriteGenerator {
  constructor(options = {}) {
    super(options);
    this.apiKey = options.apiKey ?? process.env.FAL_KEY ?? '';
    this.queueUrl = options.queueUrl ?? process.env.FAL_QUEUE_BASE_URL ?? DEFAULT_QUEUE_URL;
    this.model = options.model ?? process.env.FAL_IMAGE_MODEL ?? DEFAULT_MODEL;
    this.pollIntervalMs = positiveInteger(options.pollIntervalMs ?? process.env.FAL_POLL_INTERVAL_MS, 500);
    this.timeoutMs = positiveInteger(options.timeoutMs ?? process.env.FAL_TIMEOUT_MS, 120_000);
    this.inferenceSteps = positiveInteger(options.inferenceSteps ?? process.env.FAL_IMAGE_INFERENCE_STEPS, 4);
    this.referenceField = options.referenceField ?? process.env.FAL_IMAGE_REFERENCE_FIELD ?? '';
    this.costPerImageUsd = nonNegativeNumber(options.costPerImageUsd ?? process.env.FAL_IMAGE_COST_PER_FRAME_USD);
    this.fetch = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.id = options.id ?? 'fal-image-laboratory-generator';
    this.provider = 'fal';
    this.capabilities = ['fighter-1x6-row', 'fighter-2x3-grid', 'character-concept', 'arena-background', 'projectile-sprite', 'parallel-frame-generation', 'configurable-model'];
  }

  async healthCheck() {
    return {
      status: this.apiKey ? 'ok' : 'error',
      message: this.apiKey
        ? `fal model laboratory is configured with ${this.model}.`
        : 'FAL_KEY is required for IMAGE_GENERATOR_PROVIDER=fal.',
      details: { model: this.model, referenceField: this.referenceField || inferReferenceField(this.model) || null },
    };
  }

  async generateFrame(request) {
    if (!this.apiKey) throw missingKey('FAL_KEY is required for fal image generation.');
    const startedAt = this.now();
    const payload = payloadForModel({
      model: this.model,
      prompt: request.prompt,
      aspectRatio: request.aspectRatio,
      references: request.referenceImages ?? [],
      inferenceSteps: this.inferenceSteps,
      referenceField: this.referenceField,
    });
    const headers = { authorization: `Key ${this.apiKey}`, 'content-type': 'application/json' };
    const response = await this.fetch(`${this.queueUrl.replace(/\/$/, '')}/${this.model}`, {
      method: 'POST', headers, body: JSON.stringify(payload),
    });
    const created = await responseJson(response, 'fal');
    if (!created.request_id && !created.response_url) throw new Error('fal did not return a request_id or response_url.');
    const statusUrl = created.status_url ?? `${this.queueUrl.replace(/\/$/, '')}/${this.model}/requests/${created.request_id}/status`;
    const responseUrl = created.response_url ?? `${this.queueUrl.replace(/\/$/, '')}/${this.model}/requests/${created.request_id}`;
    await this.waitForResult(statusUrl, headers);
    const resultResponse = await this.fetch(responseUrl, { headers: { authorization: headers.authorization } });
    const result = await responseJson(resultResponse, 'fal');
    const image = result.images?.[0] ?? result.image ?? result.output?.images?.[0];
    const imageUrl = typeof image === 'string' ? image : image?.url;
    const base64 = image?.content ?? image?.base64;
    let downloaded;
    if (base64) {
      downloaded = { bytes: Buffer.from(base64, 'base64'), contentType: image.content_type ?? 'image/png' };
    } else if (imageUrl?.startsWith('data:')) {
      const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/s);
      if (!match) throw new Error('fal returned an unsupported image data URL.');
      downloaded = { bytes: Buffer.from(match[2], 'base64'), contentType: match[1] };
    } else if (imageUrl) {
      downloaded = await downloadImage(this.fetch, imageUrl, 'fal');
    } else {
      throw new Error('fal completed without returning an image URL or base64 payload.');
    }
    return {
      ...downloaded,
      provider: this.provider,
      model: this.model,
      taskId: created.request_id ?? null,
      elapsedMs: this.now() - startedAt,
      usage: result.usage ?? result.timings ?? null,
      estimatedCostUsd: this.costPerImageUsd,
    };
  }

  async waitForResult(statusUrl, headers) {
    const startedAt = this.now();
    while (this.now() - startedAt <= this.timeoutMs) {
      const response = await this.fetch(statusUrl, { headers: { authorization: headers.authorization } });
      const value = await responseJson(response, 'fal');
      if (value.status === 'COMPLETED') return value;
      if (TERMINAL_FAILURES.has(value.status)) {
        throw new Error(`fal generation ${value.status}: ${value.error ?? 'No reason supplied.'}`);
      }
      await this.sleep(this.pollIntervalMs);
    }
    throw new Error(`fal generation timed out after ${this.timeoutMs}ms.`);
  }
}

export function payloadForModel({ model, prompt, aspectRatio, references, inferenceSteps, referenceField }) {
  const wide = aspectRatio === '16:9';
  const payload = {
    prompt,
    image_size: { width: wide ? 1024 : 1024, height: wide ? 576 : 1024 },
    num_images: 1,
    output_format: 'png',
  };
  if (model.includes('/flux/schnell') || model.includes('/flux-2/klein/4b')) {
    payload.num_inference_steps = inferenceSteps;
  }
  if (model.includes('minimax/image-01/subject-reference')) {
    payload.aspect_ratio = aspectRatio ?? '1:1';
    delete payload.image_size;
  }
  const field = referenceField || inferReferenceField(model);
  if (field && references[0]) {
    payload[field] = field.endsWith('_urls')
      ? references.slice(0, 4).map(dataUrlForImage)
      : dataUrlForImage(references[0]);
  }
  return payload;
}

function inferReferenceField(model) {
  if (model.includes('/edit')) return 'image_urls';
  if (model.includes('instant-character')) return 'image_url';
  if (model.includes('subject-reference')) return 'image_url';
  return '';
}

function missingKey(message) {
  const error = new Error(message);
  error.statusCode = 503;
  return error;
}
