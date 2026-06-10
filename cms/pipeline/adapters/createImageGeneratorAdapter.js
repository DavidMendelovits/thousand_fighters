import { createLocalPlaceholderImageGenerator } from './localAdapters.js';
import { createMockImageGenerator } from './mockAdapters.js';
import { OpenAiResponsesImageGeneratorAdapter } from './openAiResponsesImageGeneratorAdapter.js';
import { CodexImageGeneratorAdapter } from './codexImageGeneratorAdapter.js';

export function createImageGeneratorAdapter(options = {}) {
  const provider = options.provider
    ?? process.env.IMAGE_GENERATOR_PROVIDER
    ?? process.env.CMS_IMAGE_GENERATOR_PROVIDER;

  if (provider === 'openai') {
    return new OpenAiResponsesImageGeneratorAdapter(options);
  }

  if (provider === 'codex') {
    return new CodexImageGeneratorAdapter(options);
  }

  if (provider === 'mock') {
    return createMockImageGenerator(options);
  }

  if (!provider || provider === 'local') {
    return createLocalPlaceholderImageGenerator(options);
  }

  throw new Error(`Unsupported image generator provider: ${provider}`);
}
