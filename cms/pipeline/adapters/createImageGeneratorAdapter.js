import { createLocalPlaceholderImageGenerator } from './localAdapters.js';
import { createMockImageGenerator } from './mockAdapters.js';
import { OpenAiResponsesImageGeneratorAdapter } from './openAiResponsesImageGeneratorAdapter.js';
import { CodexImageGeneratorAdapter } from './codexImageGeneratorAdapter.js';
import { MinimaxH3SpriteSheetGeneratorAdapter } from './minimaxH3SpriteSheetGeneratorAdapter.js';
import { MinimaxImage01GeneratorAdapter } from './minimaxImage01GeneratorAdapter.js';
import { GeminiFlashImageGeneratorAdapter } from './geminiFlashImageGeneratorAdapter.js';
import { BflFluxKleinGeneratorAdapter } from './bflFluxKleinGeneratorAdapter.js';
import { FalImageGeneratorAdapter } from './falImageGeneratorAdapter.js';

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

  if (provider === 'minimax-h3' || provider === 'minimax' || provider === 'h3') {
    return new MinimaxH3SpriteSheetGeneratorAdapter(options);
  }

  if (provider === 'minimax-image' || provider === 'minimax-image-01') {
    return new MinimaxImage01GeneratorAdapter(options);
  }

  if (provider === 'gemini-fast' || provider === 'gemini-flash-image') {
    return new GeminiFlashImageGeneratorAdapter(options);
  }

  if (provider === 'bfl-klein' || provider === 'flux-klein') {
    return new BflFluxKleinGeneratorAdapter(options);
  }

  if (provider === 'fal' || provider === 'fal-lab') {
    return new FalImageGeneratorAdapter(options);
  }

  if (provider === 'mock') {
    return createMockImageGenerator(options);
  }

  if (!provider || provider === 'local') {
    return createLocalPlaceholderImageGenerator(options);
  }

  throw new Error(`Unsupported image generator provider: ${provider}`);
}
