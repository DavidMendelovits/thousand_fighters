import { createLocalSpriteNormalizer } from './localAdapters.js';
import { ContourSpriteNormalizerAdapter } from './contourSpriteNormalizerAdapter.js';

export function createSpriteNormalizerAdapter(options = {}) {
  const provider = options.provider
    ?? process.env.SPRITE_NORMALIZER_PROVIDER
    ?? 'local';

  if (provider === 'contour') {
    return new ContourSpriteNormalizerAdapter(options);
  }

  if (provider === 'local') {
    return createLocalSpriteNormalizer(options);
  }

  throw new Error(`Unsupported sprite normalizer provider: ${provider}`);
}
