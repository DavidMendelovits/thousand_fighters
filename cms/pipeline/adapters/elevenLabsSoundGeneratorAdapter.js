const DEFAULT_SFX_MODEL = 'sound-effects';
const DEFAULT_MUSIC_MODEL = 'music-generation';
const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';

export class ElevenLabsSoundGeneratorAdapter {
  constructor(options = {}) {
    this.apiKey = options.apiKey ?? process.env.ELEVENLABS_API_KEY ?? '';
    this.sfxModel = options.sfxModel ?? process.env.ELEVENLABS_SFX_MODEL ?? DEFAULT_SFX_MODEL;
    this.musicModel = options.musicModel ?? process.env.ELEVENLABS_MUSIC_MODEL ?? DEFAULT_MUSIC_MODEL;
    this.baseUrl = options.baseUrl ?? ELEVENLABS_BASE_URL;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.id = options.id ?? 'elevenlabs-sound-generator';
    this.provider = 'elevenlabs';
    this.capabilities = ['audio-generation', 'sfx', 'bgm'];
  }

  async healthCheck() {
    return {
      status: this.apiKey ? 'ok' : 'error',
      message: this.apiKey
        ? `ElevenLabs sound generation is configured (sfx: ${this.sfxModel}, music: ${this.musicModel}).`
        : 'ELEVENLABS_API_KEY is required for SOUND_GENERATOR_PROVIDER=elevenlabs.',
      details: {
        sfxModel: this.sfxModel,
        musicModel: this.musicModel,
        baseUrl: this.baseUrl,
      },
    };
  }

  async generateAudio({ task, prompt, context } = {}) {
    if (!this.apiKey) {
      const error = new Error('ELEVENLABS_API_KEY is required for ElevenLabs sound generation.');
      error.statusCode = 503;
      throw error;
    }

    if (task === 'bgm') {
      return this._generateMusic({ prompt, context });
    }
    return this._generateSfx({ prompt, context });
  }

  async _generateSfx({ prompt, context } = {}) {
    const durationSeconds = context?.durationSeconds ?? 2;
    const promptInfluence = context?.promptInfluence ?? 0.3;

    const body = {
      text: prompt ?? '',
      duration_seconds: durationSeconds,
      prompt_influence: promptInfluence,
    };

    const response = await this.fetch(`${this.baseUrl.replace(/\/$/, '')}/sound-generation`, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      const value = text ? tryParseJson(text) : {};
      const error = new Error(value?.detail?.message ?? value?.error ?? `ElevenLabs SFX request failed with ${response.status}`);
      error.statusCode = response.status;
      error.details = value;
      throw error;
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    return {
      provider: this.provider,
      model: this.sfxModel,
      contentType: 'audio/mpeg',
      base64: audioBuffer.toString('base64'),
      promptRef: null,
    };
  }

  async _generateMusic({ prompt, context } = {}) {
    const durationSeconds = context?.durationSeconds ?? 30;
    const instrumental = context?.instrumental ?? true;

    const body = {
      prompt: prompt ?? '',
      duration_seconds: durationSeconds,
      instrumental,
    };

    const response = await this.fetch(`${this.baseUrl.replace(/\/$/, '')}/music-generation`, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      const value = text ? tryParseJson(text) : {};
      const error = new Error(value?.detail?.message ?? value?.error ?? `ElevenLabs music generation request failed with ${response.status}`);
      error.statusCode = response.status;
      error.details = value;
      throw error;
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    return {
      provider: this.provider,
      model: this.musicModel,
      contentType: 'audio/mpeg',
      base64: audioBuffer.toString('base64'),
      promptRef: null,
    };
  }
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
