import { LocalCmsChatAgent } from './localCmsChatAgent.js';
import { OpenAiResponsesCmsChatAgent } from './openAiResponsesCmsChatAgent.js';

export function createCmsChatAgent(options = {}) {
  const provider = options.provider ?? process.env.CMS_CHAT_PROVIDER ?? (process.env.OPENAI_API_KEY ? 'openai' : 'local');

  if (provider === 'openai') {
    return new OpenAiResponsesCmsChatAgent(options);
  }

  if (provider === 'local') {
    return new LocalCmsChatAgent(options);
  }

  throw new Error(`Unsupported CMS chat provider: ${provider}`);
}
