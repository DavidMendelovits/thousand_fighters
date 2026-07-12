const DEFAULT_SOUND_MODEL = 'gpt-4o-audio-preview';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export class OpenAiSoundGeneratorAdapter {
  constructor(options = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.model = options.model ?? process.env.OPENAI_SOUND_MODEL ?? DEFAULT_SOUND_MODEL;
    this.baseUrl = options.baseUrl ?? process.env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.id = options.id ?? 'openai-sound-generator';
    this.provider = 'openai';
    this.capabilities = ['audio-generation', 'sfx', 'bgm'];
  }

  async healthCheck() {
    return {
      status: this.apiKey ? 'ok' : 'error',
      message: this.apiKey
        ? `OpenAI sound generation is configured with ${this.model}.`
        : 'OPENAI_API_KEY is required for SOUND_GENERATOR_PROVIDER=openai.',
      details: {
        model: this.model,
        baseUrl: this.baseUrl,
      },
    };
  }

  async generateAudio({ task, prompt, context } = {}) {
    if (!this.apiKey) {
      const error = new Error('OPENAI_API_KEY is required for OpenAI sound generation.');
      error.statusCode = 503;
      throw error;
    }

    const systemPrompt = buildSystemPromptForTask(task);
    const body = {
      model: this.model,
      modalities: ['audio'],
      audio: { voice: 'alloy', format: 'wav' },
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        {
          role: 'user',
          content: [
            prompt,
            context && Object.keys(context).length > 0
              ? `\nContext:\n${JSON.stringify(context, null, 2)}`
              : '',
          ].join('').trim(),
        },
      ],
    };

    const response = await this.fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
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
      const error = new Error(value.error?.message ?? `OpenAI sound generation request failed with ${response.status}`);
      error.statusCode = response.status;
      error.details = value;
      throw error;
    }

    const audioData = value.choices?.[0]?.message?.audio;
    if (!audioData?.data) {
      throw new Error('OpenAI sound generation returned no audio data.');
    }

    return {
      provider: this.provider,
      model: this.model,
      contentType: 'audio/wav',
      base64: audioData.data,
      promptRef: value.id ?? null,
    };
  }
}

function buildSystemPromptForTask(task) {
  if (task === 'character-sfx') {
    return 'Generate a short sound effect (less than 2 seconds) suitable for a 2D fighting game character action. Return only the audio, no commentary.';
  }
  if (task === 'bgm') {
    return 'Generate background music suitable for a 2D fighting game. Return only the audio, no commentary.';
  }
  return 'Generate audio as requested. Return only the audio, no commentary.';
}
