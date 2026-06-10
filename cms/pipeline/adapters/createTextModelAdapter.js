import { createLocalTextModel } from './localAdapters.js';
import { createMockTextModel } from './mockAdapters.js';
import { OpenAiResponsesTextModelAdapter } from './openAiResponsesTextModelAdapter.js';
import { CodexTextModelAdapter } from './codexTextModelAdapter.js';

export function createTextModelAdapter(options = {}) {
  const provider = options.provider
    ?? process.env.TEXT_MODEL_PROVIDER
    ?? process.env.CMS_TEXT_MODEL_PROVIDER;

  if (provider === 'openai') {
    return new OpenAiResponsesTextModelAdapter(options);
  }

  if (provider === 'codex') {
    return new CodexTextModelAdapter(options);
  }

  if (provider === 'mock') {
    return createMockTextModel(options);
  }

  if (!provider || provider === 'local') {
    return createLocalTextModel(options);
  }

  throw new Error(`Unsupported text model provider: ${provider}`);
}
