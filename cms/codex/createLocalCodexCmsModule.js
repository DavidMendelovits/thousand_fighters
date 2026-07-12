import { OpenAiResponsesCmsChatAgent } from '../agent/openAiResponsesCmsChatAgent.js';
import { createLocalCmsRuntime } from '../runtime/createLocalCmsRuntime.js';

const DEFAULT_CODEX_MODEL = 'gpt-5.3-codex';
const DEFAULT_REASONING_EFFORT = 'medium';

export function createLocalCodexCmsModule(options = {}) {
  const runtime = options.runtime ?? createLocalCmsRuntime(options.runtimeOptions ?? {});
  const agent = options.agent ?? new OpenAiResponsesCmsChatAgent({
    tools: runtime.tools,
    apiKey: options.apiKey ?? process.env.OPENAI_API_KEY ?? '',
    model: options.model ?? process.env.OPENAI_CODEX_MODEL ?? process.env.CODEX_MODEL ?? DEFAULT_CODEX_MODEL,
    reasoningEffort: options.reasoningEffort
      ?? process.env.OPENAI_CODEX_REASONING_EFFORT
      ?? DEFAULT_REASONING_EFFORT,
    baseUrl: options.baseUrl ?? process.env.OPENAI_BASE_URL,
    fetch: options.fetch,
    maxToolRounds: options.maxToolRounds,
    id: options.id ?? 'openai-codex-cms-local-agent',
    provider: 'openai-codex',
    capabilities: [
      'responses-api',
      'codex-model',
      'function-calling',
      'cms-tool-routing',
      'local-cms-runtime',
    ],
  });

  return new LocalCodexCmsModule({ runtime, agent });
}

export class LocalCodexCmsModule {
  constructor({ runtime, agent }) {
    this.runtime = runtime;
    this.agent = agent;
    this.id = 'local-codex-cms-module';
    this.provider = 'openai-codex';
    this.capabilities = [
      'chat',
      'tool-invocation',
      'pipeline-health',
      'character-cms',
      'local-usage',
    ];
  }

  listFunctions() {
    return this.runtime.tools.list();
  }

  openAiTools() {
    return this.runtime.tools.openAiTools();
  }

  async invokeFunction(name, input = {}) {
    return this.runtime.tools.invoke(name, input);
  }

  async run(request, context = {}) {
    const normalized = typeof request === 'string'
      ? { message: request, ...context }
      : { ...(request ?? {}), ...context };
    return this.agent.chat(normalized);
  }

  async healthCheck() {
    return {
      id: this.id,
      provider: this.provider,
      capabilities: this.capabilities,
      agent: await this.agentHealth(),
      pipeline: {
        adapters: this.runtime.registry.describe(),
        adapterHealth: await this.runtime.registry.health(),
        gaps: this.runtime.gaps,
      },
      functions: this.listFunctions().map((tool) => ({
        name: tool.name,
        description: tool.description,
      })),
    };
  }

  async agentHealth() {
    if (typeof this.agent.healthCheck !== 'function') {
      return {
        id: this.agent.id ?? 'codex-agent',
        provider: this.agent.provider ?? 'unknown',
        capabilities: this.agent.capabilities ?? [],
        status: 'unknown',
        message: 'Agent does not expose healthCheck().',
      };
    }

    const health = await this.agent.healthCheck();
    return {
      id: this.agent.id ?? 'codex-agent',
      provider: this.agent.provider ?? 'unknown',
      capabilities: this.agent.capabilities ?? [],
      status: health.status ?? 'unknown',
      message: health.message ?? '',
      details: health.details ?? {},
    };
  }
}
