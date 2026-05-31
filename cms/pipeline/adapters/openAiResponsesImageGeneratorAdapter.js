const DEFAULT_RESPONSES_MODEL = 'gpt-5.5';
const DEFAULT_IMAGE_MODEL = 'gpt-image-2';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export class OpenAiResponsesImageGeneratorAdapter {
  constructor(options = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.model = options.model
      ?? process.env.OPENAI_IMAGE_RESPONSES_MODEL
      ?? process.env.OPENAI_RESPONSES_MODEL
      ?? DEFAULT_RESPONSES_MODEL;
    this.imageModel = options.imageModel ?? process.env.OPENAI_IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL;
    this.size = options.size ?? process.env.OPENAI_IMAGE_SIZE ?? '1024x1024';
    this.quality = options.quality ?? process.env.OPENAI_IMAGE_QUALITY ?? 'auto';
    this.background = options.background ?? process.env.OPENAI_IMAGE_BACKGROUND ?? 'auto';
    this.outputFormat = options.outputFormat ?? process.env.OPENAI_IMAGE_OUTPUT_FORMAT ?? 'png';
    this.moderation = options.moderation ?? process.env.OPENAI_IMAGE_MODERATION ?? 'auto';
    this.baseUrl = options.baseUrl ?? process.env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.id = options.id ?? 'openai-responses-image-generator';
    this.provider = 'openai';
    this.capabilities = [
      'responses-api',
      'image-generation',
      'fighter-1x6-row',
      'sprite-source-sheet',
      'arena-background',
      'character-concept',
    ];
  }

  async healthCheck() {
    return {
      status: this.apiKey ? 'ok' : 'error',
      message: this.apiKey
        ? `OpenAI image generation is configured with ${this.model} and ${this.imageModel}.`
        : 'OPENAI_API_KEY is required for IMAGE_GENERATOR_PROVIDER=openai.',
      details: {
        model: this.model,
        imageModel: this.imageModel,
        size: this.size,
        quality: this.quality,
        background: this.background,
        outputFormat: this.outputFormat,
        baseUrl: this.baseUrl,
      },
    };
  }

  async generateImage(request = {}) {
    if (!this.apiKey) {
      const error = new Error('OPENAI_API_KEY is required for OpenAI image generation.');
      error.statusCode = 503;
      throw error;
    }

    const response = await this.createResponse({
      prompt: imagePromptFor(request),
    });
    const imageCall = extractImageGenerationCall(response);
    const base64 = base64FromImageCall(imageCall);
    if (!base64) {
      throw new Error('OpenAI image generation returned no base64 image result.');
    }

    return {
      provider: this.provider,
      model: imageCall.model ?? this.imageModel,
      promptRef: response.id ?? imageCall.id ?? null,
      imageGenerationId: imageCall.id ?? null,
      revisedPrompt: imageCall.revised_prompt ?? null,
      contentType: contentTypeForOutputFormat(imageCall.output_format ?? this.outputFormat),
      base64,
    };
  }

  async createResponse({ prompt }) {
    const body = {
      model: this.model,
      input: prompt,
      tools: [stripUndefined({
        type: 'image_generation',
        model: this.imageModel,
        size: this.size,
        quality: this.quality,
        background: this.background,
        output_format: this.outputFormat,
        moderation: this.moderation,
      })],
      tool_choice: { type: 'image_generation' },
      store: true,
    };

    const response = await this.fetch(`${this.baseUrl.replace(/\/$/, '')}/responses`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    const value = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const error = new Error(value.error?.message ?? `OpenAI Responses image request failed with ${response.status}`);
      error.statusCode = response.status;
      error.details = value;
      throw error;
    }
    return value;
  }
}

function imagePromptFor(request) {
  const task = request.task ?? 'image-generation';
  if (task === 'character-concept') {
    return [
      'Create a character turnaround sheet for a 2D fighting game character.',
      '',
      'Layout — STRICT 1x3 GRID of three equal square panels side by side:',
      '- Left panel: FRONT view (facing the viewer)',
      '- Center panel: 3/4 PROFILE view (turned slightly to the right)',
      '- Right panel: BACK view (facing away from the viewer)',
      '',
      'Each panel must be exactly one-third of the total image width and the full image height — three perfect squares in a row.',
      '',
      'Requirements:',
      '- Full body visible in each panel, head to feet, vertically centered.',
      '- Clean solid-color background (#f0f0f0 light gray) in all three panels.',
      '- Consistent proportions, costume, colors, and details across all three views.',
      '- The character should look like a fighting game character — dynamic pose, distinctive silhouette, readable at small sizes.',
      '- Include their weapon/prop if described, visible in all three views.',
      '- No text, no labels, no panel borders, no annotations.',
      '- Thin vertical gaps between panels are acceptable but not required.',
      '',
      'Character description:',
      request.prompt ?? '',
      '',
      request.context ? `Additional context:\n${JSON.stringify(request.context, null, 2)}` : '',
    ].filter(Boolean).join('\n');
  }
  if (task === 'arena-background') {
    return [
      'Draw a production-ready 2D fighting game arena background.',
      '',
      'Arena format:',
      '- Wide horizontal composition (16:9 aspect ratio).',
      '- A flat ground plane or surface where two fighters will stand.',
      '- Atmospheric depth with foreground elements and background layers.',
      '- Dramatic, moody lighting with high contrast so fighter silhouettes stay readable.',
      '- No characters, no UI elements, no text, no health bars.',
      '- Style: detailed pixel art or digital painting, dark tones, vibrant accent colors.',
      '',
      'Arena concept:',
      request.prompt ?? '',
      '',
      request.context ? `Context:\n${JSON.stringify(request.context, null, 2)}` : '',
    ].filter(Boolean).join('\n');
  }
  if (task === 'fighter-1x6-row') {
    const moveDescriptions = {
      base: 'base idle stance — subtle breathing/sway animation loop, facing right, neutral pose',
      punch: 'punch attack — wind-up, extension, contact, follow-through, recovery frames',
      kick: 'kick attack — chamber, extension, contact, follow-through, recovery frames',
      special_1: 'special move 1 — dramatic startup, active frames with effect/projectile, recovery',
      special_2: 'special move 2 — dramatic startup, active frames with effect/projectile, recovery',
    };
    const moveId = request.moveId ?? 'base';
    const moveDesc = moveDescriptions[moveId] ?? moveId;
    return [
      'Draw a production-ready 2D fighting-game sprite row for Thousand Fighters.',
      '',
      'Sheet format:',
      '- Exactly 1 row and 6 columns (6 frames in a horizontal strip).',
      `- Animation: ${moveDesc}.`,
      '- Each cell contains one full-body character frame, centered on a stable floor anchor.',
      '- Use generous empty gutters between cells so no limb, weapon, projectile, hair, or effect touches a cell edge.',
      '- Keep the entire character visible in every frame. Do not crop feet, head, hands, weapons, capes, or effects.',
      '- Keep the camera, character scale, silhouette size, and facing direction consistent across all 6 frames.',
      '- Show clear animation progression from frame 1 to frame 6 — this must read as a playable move, not random poses.',
      '- Use a solid chroma-magenta background (#ff00ff), not transparency, scenery, gradients, shadows, labels, or text.',
      '',
      'Character prompt:',
      request.prompt ?? '',
      '',
      'Reference asset storage keys:',
      JSON.stringify(request.referenceAssetKeys ?? []),
      '',
      'Additional CMS context:',
      JSON.stringify(request.context ?? {}, null, 2),
    ].join('\n');
  }

  return [
    request.prompt ?? '',
    '',
    'Task:',
    task,
    '',
    'Reference asset storage keys:',
    JSON.stringify(request.referenceAssetKeys ?? []),
    '',
    'Context:',
    JSON.stringify(request.context ?? {}, null, 2),
  ].join('\n').trim();
}

function extractImageGenerationCall(response) {
  for (const item of response.output ?? []) {
    if (item.type === 'image_generation_call') return item;
  }

  const outputTypes = (response.output ?? []).map((item) => item.type ?? 'unknown').join(', ');
  throw new Error(`OpenAI response did not include an image_generation_call. Output types: ${outputTypes || 'none'}`);
}

function base64FromImageCall(imageCall) {
  if (typeof imageCall.result === 'string') return stripDataUrlPrefix(imageCall.result);
  if (typeof imageCall.b64_json === 'string') return stripDataUrlPrefix(imageCall.b64_json);
  if (typeof imageCall.image?.b64_json === 'string') return stripDataUrlPrefix(imageCall.image.b64_json);
  if (typeof imageCall.image?.data === 'string') return stripDataUrlPrefix(imageCall.image.data);
  return '';
}

function stripDataUrlPrefix(value) {
  const marker = ';base64,';
  const markerIndex = value.indexOf(marker);
  if (markerIndex >= 0) return value.slice(markerIndex + marker.length);
  return value;
}

function contentTypeForOutputFormat(outputFormat) {
  if (outputFormat === 'webp') return 'image/webp';
  if (outputFormat === 'jpeg' || outputFormat === 'jpg') return 'image/jpeg';
  return 'image/png';
}

function stripUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== ''));
}
