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
    this.capabilities = ['structured-output', 'responses-api', 'json-schema', 'character-drafting'];
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
    return [
      'You draft game-ready Thousand Fighters character content as strict JSON.',
      'Create a playable fighting-game character from the brief.',
      'Keep animation ids aligned with these move rows: punch, kick, special_1, special_2.',
      'Use six-frame generated fighter assumptions unless context explicitly says otherwise.',
      'Moves should be mechanically readable and usable by the runtime config.',
      'Do not include markdown. Return only JSON matching the supplied schema.',
    ].join('\n');
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

function characterContentDraftSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['displayName', 'description', 'stats', 'sprite', 'moves'],
    properties: {
      displayName: { type: 'string' },
      description: { type: 'string' },
      stats: {
        type: 'object',
        additionalProperties: false,
        required: [
          'walkForwardSpeed',
          'walkBackSpeed',
          'jumpVelocity',
          'jumpForwardVelocity',
          'jumpBackVelocity',
          'gravity',
          'maxFallSpeed',
          'maxHealth',
        ],
        properties: {
          walkForwardSpeed: { type: 'number' },
          walkBackSpeed: { type: 'number' },
          jumpVelocity: { type: 'number' },
          jumpForwardVelocity: { type: 'number' },
          jumpBackVelocity: { type: 'number' },
          gravity: { type: 'number' },
          maxFallSpeed: { type: 'number' },
          maxHealth: { type: 'integer' },
        },
      },
      sprite: {
        type: 'object',
        additionalProperties: false,
        required: ['basePath', 'scale', 'frameCounts'],
        properties: {
          basePath: { type: 'string' },
          scale: { type: 'number' },
          frameCounts: {
            type: 'object',
            additionalProperties: false,
            required: ['base', 'punch', 'kick', 'special_1', 'special_2'],
            properties: {
              base: { type: 'integer' },
              punch: { type: 'integer' },
              kick: { type: 'integer' },
              special_1: { type: 'integer' },
              special_2: { type: 'integer' },
            },
          },
        },
      },
      moves: {
        type: 'array',
        minItems: 4,
        items: moveSchema(),
      },
    },
  };
}

function moveSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'displayName', 'description', 'animation', 'trigger', 'phases'],
    properties: {
      id: { type: 'string' },
      displayName: { type: 'string' },
      description: { type: 'string' },
      animation: {
        type: 'string',
        enum: ['punch', 'kick', 'special_1', 'special_2'],
      },
      trigger: {
        type: 'object',
        additionalProperties: false,
        required: ['sequence'],
        properties: {
          sequence: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
      phases: {
        type: 'array',
        minItems: 3,
        items: phaseSchema(),
      },
    },
  };
}

function phaseSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'frames', 'events'],
    properties: {
      name: { type: 'string' },
      frames: { type: 'integer' },
      events: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['frame', 'event'],
          properties: {
            frame: { type: 'integer' },
            event: eventSchema(),
          },
        },
      },
    },
  };
}

function eventSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'hitbox', 'projectile'],
    properties: {
      type: { type: 'string' },
      hitbox: {
        anyOf: [
          hitboxSchema(),
          { type: 'null' },
        ],
      },
      projectile: {
        anyOf: [
          projectileSchema(),
          { type: 'null' },
        ],
      },
    },
  };
}

function hitboxSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['x', 'y', 'width', 'height', 'damage', 'knockbackX', 'knockbackY', 'hitstun'],
    properties: {
      x: { type: 'number' },
      y: { type: 'number' },
      width: { type: 'number' },
      height: { type: 'number' },
      damage: { type: 'integer' },
      knockbackX: { type: 'number' },
      knockbackY: { type: 'number' },
      hitstun: { type: 'integer' },
    },
  };
}

function projectileSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'assetPath', 'speedX', 'speedY', 'damage'],
    properties: {
      id: { type: 'string' },
      assetPath: { type: 'string' },
      speedX: { type: 'number' },
      speedY: { type: 'number' },
      damage: { type: 'integer' },
    },
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
