import { ParallelFrameSpriteGenerator } from './parallelFrameSpriteGenerator.js';
import { dataUrlForImage, downloadImage, nonNegativeNumber, positiveInteger, responseJson } from './remoteImageAdapterUtils.js';
import { currentLineage } from '../../storage/LineageStore.js';

const DEFAULT_BASE_URL = 'https://api.bfl.ai';
const DEFAULT_MODEL = 'flux-2-klein-4b';
const TERMINAL_FAILURES = new Set(['Error', 'Failed', 'Request Moderated']);

export class BflFluxKleinGeneratorAdapter extends ParallelFrameSpriteGenerator {
  constructor(options = {}) {
    super(options);
    this.apiKey = options.apiKey ?? process.env.BFL_API_KEY ?? '';
    this.baseUrl = options.baseUrl ?? process.env.BFL_API_BASE_URL ?? DEFAULT_BASE_URL;
    this.model = options.model ?? process.env.BFL_IMAGE_MODEL ?? DEFAULT_MODEL;
    this.pollIntervalMs = positiveInteger(options.pollIntervalMs ?? process.env.BFL_POLL_INTERVAL_MS, 500);
    this.timeoutMs = positiveInteger(options.timeoutMs ?? process.env.BFL_TIMEOUT_MS, 120_000);
    this.costPerImageUsd = nonNegativeNumber(options.costPerImageUsd ?? process.env.BFL_IMAGE_COST_PER_FRAME_USD, this.model===DEFAULT_MODEL?0.014:undefined);
    this.fetch = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.id = options.id ?? 'bfl-flux-klein-generator';
    this.provider = 'bfl-klein';
    this.capabilities = ['fighter-1x6-row', 'fighter-2x3-grid', 'character-concept', 'arena-background', 'projectile-sprite', 'parallel-frame-generation', 'multi-reference-image'];
  }

  async healthCheck() {
    return {
      status: this.apiKey ? 'ok' : 'error',
      message: this.apiKey
        ? `BFL fast image generation is configured with ${this.model}.`
        : 'BFL_API_KEY is required for IMAGE_GENERATOR_PROVIDER=bfl-klein.',
      details: { model: this.model, pollIntervalMs: this.pollIntervalMs, timeoutMs: this.timeoutMs },
    };
  }

  async generateFrame(request) {
    if (!this.apiKey) throw missingKey('BFL_API_KEY is required for FLUX.2 Klein image generation.');
    const startedAt = this.now();
    const wide = request.aspectRatio === '16:9';
    const references = (request.referenceImages ?? []).slice(0, 4);
    const payload = {
      prompt: request.prompt,
      width: wide ? 1024 : 1024,
      height: wide ? 576 : 1024,
      output_format: 'png',
    };
    references.forEach((image, index) => {
      payload[index === 0 ? 'input_image' : `input_image_${index + 1}`] = dataUrlForImage(image);
    });
    const submissionStartedAt = this.now();
    let created;
    try {
      const response = await this.fetch(`${this.baseUrl.replace(/\/$/, '')}/v1/${this.model}`, {
        method: 'POST',
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { 'content-type': 'application/json', 'x-key': this.apiKey },
        body: JSON.stringify(payload),
      });
      created = await responseJson(response, 'BFL');
    } catch (error) {
      // A disconnected POST may already have been accepted and billed.
      error.noRetry = true;
      throw error;
    }
    const submissionMs = this.now() - submissionStartedAt;
    try {
      if (!created.polling_url && !created.id) throw new Error('BFL did not return an id or polling_url.');
      const lineage = request.onGenerationAttempt?.lineage ?? currentLineage();
      // Persist acceptance before polling, so timeouts and process restarts do
      // not erase the ID needed to retrieve an already paid-for result.
      if (lineage) await lineage.event(request.context?.characterId, {
        type: 'provider-job-accepted', provider: this.provider, model: this.model,
        providerTaskId: created.id ?? null, frameNumber: request.frameNumber ?? null,
        operation: request.task ?? 'image',
      });
      const pollingUrl = created.polling_url ?? `${this.baseUrl.replace(/\/$/, '')}/v1/get_result?id=${encodeURIComponent(created.id)}`;
      const queueStartedAt = this.now();
      const completed = await this.waitForResult(pollingUrl);
      const queueAndGenerationMs = this.now() - queueStartedAt;
      const imageUrl = completed.result?.sample ?? completed.sample;
      if (!imageUrl) throw new Error('BFL completed without returning result.sample.');
      const downloadStartedAt = this.now();
      const downloaded = await downloadImage(this.fetch, imageUrl, 'BFL');
      const downloadMs = this.now() - downloadStartedAt;
      return {
        ...downloaded,
        provider: this.provider,
        model: this.model,
        taskId: created.id ?? completed.id ?? null,
        elapsedMs: this.now() - startedAt,
        stageTimings: { submissionMs, queueAndGenerationMs, downloadMs, totalProviderMs: this.now() - startedAt },
        usage: completed.usage ?? null,
        estimatedCostUsd: this.costPerImageUsd,
      };
    } catch (error) {
      error.taskId = created.id ?? null;
      error.noRetry = true;
      error.message += ` BFL job ${created.id ?? '(ID unavailable)'} may already be billed. Recover the existing result; do not regenerate automatically.`;
      throw error;
    }
  }

  async waitForResult(pollingUrl) {
    const startedAt = this.now();
    while (this.now() - startedAt <= this.timeoutMs) {
      const response = await this.fetch(pollingUrl, { headers: { 'x-key': this.apiKey }, signal: AbortSignal.timeout(this.timeoutMs) });
      const value = await responseJson(response, 'BFL');
      if (value.status === 'Ready') return value;
      if (TERMINAL_FAILURES.has(value.status)) {
        throw new Error(`BFL generation ${value.status}: ${value.error ?? value.failure_reason ?? 'No reason supplied.'}`);
      }
      await this.sleep(this.pollIntervalMs);
    }
    throw new Error(`BFL generation timed out after ${this.timeoutMs}ms.`);
  }
}

function missingKey(message) {
  const error = new Error(message);
  error.statusCode = 503;
  return error;
}
