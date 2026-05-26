import { createLocalPlaceholderSoundGenerator } from './localAdapters.js';
import { OpenAiSoundGeneratorAdapter } from './openAiSoundGeneratorAdapter.js';
import { ElevenLabsSoundGeneratorAdapter } from './elevenLabsSoundGeneratorAdapter.js';

export function createSoundGeneratorAdapter(options = {}) {
  const provider = options.provider
    ?? process.env.SOUND_GENERATOR_PROVIDER;

  if (provider === 'openai') {
    return new OpenAiSoundGeneratorAdapter(options);
  }

  if (provider === 'elevenlabs') {
    return new ElevenLabsSoundGeneratorAdapter(options);
  }

  if (!provider || provider === 'local') {
    return createLocalPlaceholderSoundGenerator(options);
  }

  throw new Error(`Unsupported sound generator provider: ${provider}`);
}
