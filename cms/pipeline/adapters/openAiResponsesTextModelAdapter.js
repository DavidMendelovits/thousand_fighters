import { characterContentDraftSchema, characterContentDraftGuidance } from './characterContentDraftSchema.js';

const DEFAULT_MODEL = 'gpt-5.5';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export class OpenAiResponsesTextModelAdapter {
  constructor(options = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.model = options.model ?? process.env.OPENAI_TEXT_MODEL ?? process.env.OPENAI_RESPONSES_MODEL ?? DEFAULT_MODEL;
    this.baseUrl = options.baseUrl ?? process.env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.id = options.id ?? 'openai-responses-character-drafter';
    this.provider = 'openai';
    this.capabilities = ['structured-output', 'responses-api', 'json-schema', 'character-drafting', 'vision-describe'];
  }

  async healthCheck() {
    return {
      status: this.apiKey ? 'ok' : 'error',
      message: this.apiKey
        ? `OpenAI Responses text model is configured with ${this.model}.`
        : 'OPENAI_API_KEY is required for TEXT_MODEL_PROVIDER=openai.',
      details: {
        model: this.model,
        baseUrl: this.baseUrl,
      },
    };
  }

  async describeImage({ imageBase64, contentType = 'image/png', prompt, context = {} } = {}) {
    if (!this.apiKey) {
      const error = new Error('OPENAI_API_KEY is required for OpenAI vision requests.');
      error.statusCode = 503;
      throw error;
    }

    const mediaType = contentType === 'image/webp' ? 'image/webp'
      : contentType === 'image/jpeg' ? 'image/jpeg'
      : 'image/png';
    const dataUrl = `data:${mediaType};base64,${imageBase64}`;

    const body = {
      model: this.model,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_image', image_url: dataUrl },
            { type: 'input_text', text: prompt ?? 'Describe this character in detail for a fighting game. Include their appearance, clothing, weapon/props, build, and any distinctive features. Output a concise but complete description suitable for generating sprite sheets.' },
          ],
        },
      ],
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
      const error = new Error(value.error?.message ?? `Vision request failed with ${response.status}`);
      error.statusCode = response.status;
      error.details = value;
      throw error;
    }

    const outputText = (value.output ?? []).find((item) => item.type === 'message')?.content
      ?.find((c) => c.type === 'output_text')?.text ?? '';

    return {
      provider: this.provider,
      model: this.model,
      description: outputText,
      promptRef: value.id ?? null,
    };
  }

  async completeStructured(request = {}) {
    if (!this.apiKey) {
      const error = new Error('OPENAI_API_KEY is required for OpenAI text generation.');
      error.statusCode = 503;
      throw error;
    }

    const schema = schemaFor(request.schemaName);
    const response = await this.createResponse({
      instructions: instructionsFor(request),
      input: inputFor(request),
      schemaName: request.schemaName ?? 'StructuredResult',
      schema,
    });
    const outputText = extractOutputText(response);
    if (!outputText) {
      throw new Error('OpenAI text model returned no structured output text.');
    }

    return {
      provider: this.provider,
      model: response.model ?? this.model,
      promptRef: response.id ?? null,
      value: JSON.parse(outputText),
    };
  }

  async createResponse({ instructions, input, schemaName, schema }) {
    const body = {
      model: this.model,
      instructions,
      input,
      text: {
        format: {
          type: 'json_schema',
          name: sanitizeSchemaName(schemaName),
          schema,
          strict: true,
        },
      },
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
      const error = new Error(value.error?.message ?? `OpenAI Responses request failed with ${response.status}`);
      error.statusCode = response.status;
      error.details = value;
      throw error;
    }
    return value;
  }
}

function instructionsFor(request) {
  if (request.task === 'character-content-draft') {
    return characterContentDraftGuidance().join('\n');
  }

  return 'Return strict JSON matching the supplied schema. Do not include markdown.';
}

function inputFor(request) {
  return [
    {
      role: 'user',
      content: JSON.stringify({
        task: request.task,
        schemaName: request.schemaName,
        schemaVersion: request.schemaVersion,
        input: request.input ?? {},
      }, null, 2),
    },
  ];
}

function schemaFor(schemaName) {
  if (!schemaName || schemaName === 'CharacterContentDraft') return characterContentDraftSchema();
  return {
    type: 'object',
    additionalProperties: true,
    properties: {},
  };
}

function extractOutputText(response) {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const parts = [];
  for (const item of response.output ?? []) {
    if (item.type !== 'message') continue;
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && content.text) parts.push(content.text);
      if (content.type === 'text' && content.text) parts.push(content.text);
      if (content.refusal) throw new Error(`OpenAI text model refused the request: ${content.refusal}`);
    }
  }
  return parts.join('\n').trim();
}

function sanitizeSchemaName(value) {
  return String(value || 'StructuredResult')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .slice(0, 64) || 'StructuredResult';
}
