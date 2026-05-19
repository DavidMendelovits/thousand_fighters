import { createLocalPlaceholderImageGenerator } from './localAdapters.js';
import { OpenAiResponsesImageGeneratorAdapter } from './openAiResponsesImageGeneratorAdapter.js';

export function createImageGeneratorAdapter(options = {}) {
  const provider = options.provider
    ?? process.env.IMAGE_GENERATOR_PROVIDER
    ?? process.env.CMS_IMAGE_GENERATOR_PROVIDER
    ?? 'local';

  if (provider === 'openai') {
    return new OpenAiResponsesImageGeneratorAdapter(options);
  }

  if (provider === 'local') {
    return createLocalPlaceholderImageGenerator(options);
  }

  throw new Error(`Unsupported image generator provider: ${provider}`);
}
