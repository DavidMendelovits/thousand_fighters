import { createLocalTextModel } from './localAdapters.js';
import { OpenAiResponsesTextModelAdapter } from './openAiResponsesTextModelAdapter.js';

export function createTextModelAdapter(options = {}) {
  const provider = options.provider
    ?? process.env.TEXT_MODEL_PROVIDER
    ?? process.env.CMS_TEXT_MODEL_PROVIDER
    ?? 'local';

  if (provider === 'openai') {
    return new OpenAiResponsesTextModelAdapter(options);
  }

  if (provider === 'local') {
    return createLocalTextModel(options);
  }

  throw new Error(`Unsupported text model provider: ${provider}`);
}
