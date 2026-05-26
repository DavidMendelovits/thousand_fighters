import { FighterPackQaAdapter } from './fighterPackQaAdapter.js';
import { createLocalFighterQa } from './localAdapters.js';

export function createFighterQaAdapter(options = {}) {
  const provider = options.provider
    ?? process.env.FIGHTER_QA_PROVIDER
    ?? 'real';

  if (provider === 'real') {
    return new FighterPackQaAdapter({
      storage: options.storage,
      repository: options.repository,
    });
  }

  if (provider === 'local') {
    return createLocalFighterQa({ repository: options.repository });
  }

  throw new Error(`Unsupported fighter QA provider: ${provider}`);
}
