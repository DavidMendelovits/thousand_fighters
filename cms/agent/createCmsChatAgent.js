import { LocalCmsChatAgent } from './localCmsChatAgent.js';
import { OpenAiResponsesCmsChatAgent } from './openAiResponsesCmsChatAgent.js';
import { createLocalCodexCliCmsModule } from '../codex/createLocalCodexCliCmsModule.js';

export function createCmsChatAgent(options = {}) {
  const provider = options.provider ?? process.env.CMS_CHAT_PROVIDER ?? (process.env.OPENAI_API_KEY ? 'openai' : 'local');

  if (provider === 'openai') {
    return new OpenAiResponsesCmsChatAgent(options);
  }

  if (provider === 'local') {
    return new LocalCmsChatAgent(options);
  }

  if (provider === 'codex') {
    // Wrap LocalCodexCliCmsModule in a chat-agent-compatible adapter.
    // The module exposes run() but the CMS server expects chat().
    //
    // To avoid circular recursion (createCmsChatAgent → createLocalCodexCliCmsModule
    // → createLocalCmsRuntime → createCmsChatAgent), pass the already-built tools
    // object wrapped in a minimal runtime shim. LocalCodexCliCmsModule only calls
    // runtime.tools.list(), runtime.tools.openAiTools(), and runtime.tools.invoke().
    const runtimeShim = options.tools ? { tools: options.tools, registry: options.registry, gaps: options.gaps } : undefined;
    const module = createLocalCodexCliCmsModule(
      runtimeShim ? { runtime: runtimeShim } : {}
    );
    return new CodexChatAgentAdapter(module);
  }

  throw new Error(`Unsupported CMS chat provider: ${provider}`);
}

class CodexChatAgentAdapter {
  constructor(module) {
    this.module = module;
    this.id = 'codex-cms-chat-agent';
    this.provider = 'codex';
    this.capabilities = module.capabilities ?? [];
  }

  async healthCheck() {
    const result = await this.module.healthCheck();
    return {
      status: result.codex?.status ?? 'unknown',
      message: result.codex?.message ?? '',
      details: result,
    };
  }

  async chat(request = {}) {
    const result = await this.module.run(request);
    return {
      provider: this.provider,
      agentId: this.id,
      message: result.message ?? '',
      toolCalls: result.toolCalls ?? [],
      responseId: null,
      rawPlan: result.rawPlan ?? null,
    };
  }
}
