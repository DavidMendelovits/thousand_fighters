import { ParallelFrameSpriteGenerator } from './parallelFrameSpriteGenerator.js';
import { nonNegativeNumber, responseJson } from './remoteImageAdapterUtils.js';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-3.1-flash-image';

export class GeminiFlashImageGeneratorAdapter extends ParallelFrameSpriteGenerator {
  constructor(options = {}) {
    super(options);
    this.apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? '';
    this.baseUrl = options.baseUrl ?? process.env.GEMINI_API_BASE_URL ?? DEFAULT_BASE_URL;
    this.model = options.model ?? process.env.GEMINI_IMAGE_MODEL ?? DEFAULT_MODEL;
    this.imageSize = options.imageSize ?? process.env.GEMINI_IMAGE_SIZE ?? '1K';
    this.maxReferences = Number.parseInt(options.maxReferences ?? process.env.GEMINI_IMAGE_MAX_REFERENCES ?? '1', 10);
    this.costPerImageUsd = nonNegativeNumber(options.costPerImageUsd ?? process.env.GEMINI_IMAGE_COST_PER_FRAME_USD, 0.0336);
    this.fetch = options.fetch ?? globalThis.fetch;
    this.id = options.id ?? 'gemini-flash-image-generator';
    this.provider = 'gemini-fast';
    this.capabilities = ['fighter-1x6-row', 'fighter-2x3-grid', 'character-concept', 'arena-background', 'projectile-sprite', 'parallel-frame-generation', 'reference-image'];
  }

  async healthCheck() {
    return {
      status: this.apiKey ? 'ok' : 'error',
      message: this.apiKey
        ? `Gemini fast image generation is configured with ${this.model}.`
        : 'GEMINI_API_KEY is required for IMAGE_GENERATOR_PROVIDER=gemini-fast.',
      details: { model: this.model, imageSize: this.imageSize, maxReferences: this.maxReferences },
    };
  }

  async generateFrame(request) {
    if (!this.apiKey) throw missingKey('GEMINI_API_KEY is required for Gemini image generation.');
    const startedAt = this.now();
    const references = (request.referenceImages ?? []).slice(0, Math.max(0, this.maxReferences));
    const input = [
      { type: 'text', text: request.prompt },
      ...references.map((image) => ({
        type: 'image', mime_type: image.contentType ?? 'image/png', data: image.base64,
      })),
    ];
    const payload = {
      model: this.model,
      input,
      response_format: {
        type: 'image',
        mime_type: 'image/png',
        aspect_ratio: request.aspectRatio ?? '1:1',
        image_size: this.imageSize,
      },
    };
    const response = await this.fetch(`${this.baseUrl.replace(/\/$/, '')}/interactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify(payload),
    });
    const value = await responseJson(response, 'Gemini');
    const responseParts = value.candidates?.flatMap((candidate) => candidate.content?.parts ?? []) ?? [];
    const legacyPart = responseParts.find((part) => part.inlineData?.data || part.inline_data?.data);
    const outputPart = value.output_image
      ?? value.output?.find?.((part) => part.type === 'image')
      ?? value.outputs?.find?.((part) => part.type === 'image');
    const inline = outputPart ?? legacyPart?.inlineData ?? legacyPart?.inline_data;
    if (!inline?.data) throw new Error('Gemini completed without returning image data.');
    return {
      provider: this.provider,
      model: value.modelVersion ?? this.model,
      bytes: Buffer.from(inline.data, 'base64'),
      contentType: inline.mimeType ?? inline.mime_type ?? 'image/png',
      elapsedMs: this.now() - startedAt,
      taskId: value.id ?? null,
      usage: value.usage ?? value.usageMetadata ?? null,
      estimatedCostUsd: this.costPerImageUsd,
    };
  }
}

function missingKey(message) {
  const error = new Error(message);
  error.statusCode = 503;
  return error;
}
