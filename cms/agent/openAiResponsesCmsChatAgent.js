const DEFAULT_MODEL = 'gpt-5.5';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MAX_TOOL_ROUNDS = 5;

export class OpenAiResponsesCmsChatAgent {
  constructor(options = {}) {
    if (!options.tools) throw new Error('OpenAiResponsesCmsChatAgent requires CMS tools.');
    this.tools = options.tools;
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.model = options.model ?? process.env.OPENAI_RESPONSES_MODEL ?? DEFAULT_MODEL;
    this.baseUrl = options.baseUrl ?? process.env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.maxToolRounds = options.maxToolRounds ?? Number(process.env.CMS_CHAT_MAX_TOOL_ROUNDS ?? DEFAULT_MAX_TOOL_ROUNDS);
    this.id = 'openai-responses-cms-chat-agent';
    this.provider = 'openai';
    this.capabilities = ['responses-api', 'function-calling', 'cms-tool-routing'];
  }

  async healthCheck() {
    return {
      status: this.apiKey ? 'ok' : 'error',
      message: this.apiKey
        ? `OpenAI Responses chat adapter is configured with ${this.model}.`
        : 'OPENAI_API_KEY is required for CMS_CHAT_PROVIDER=openai.',
      details: {
        model: this.model,
        baseUrl: this.baseUrl,
      },
    };
  }

  async chat(request = {}) {
    if (!this.apiKey) {
      const error = new Error('OPENAI_API_KEY is required for OpenAI CMS chat.');
      error.statusCode = 503;
      throw error;
    }

    const message = String(request.message ?? '').trim();
    if (!message) {
      const error = new Error('Chat message is required.');
      error.statusCode = 400;
      throw error;
    }

    const toolCalls = [];
    let response = await this.createResponse({
      input: buildInitialInput(request),
      previousResponseId: request.previousResponseId,
    });

    for (let round = 0; round < this.maxToolRounds; round += 1) {
      const functionCalls = response.output?.filter((item) => item.type === 'function_call') ?? [];
      if (functionCalls.length === 0) {
        return {
          provider: this.provider,
          agentId: this.id,
          responseId: response.id ?? null,
          message: extractOutputText(response) || 'Done.',
          toolCalls,
          rawStatus: response.status ?? null,
        };
      }

      const outputs = [];
      for (const functionCall of functionCalls) {
        const toolCall = await this.invokeFunctionCall(functionCall);
        toolCalls.push(toolCall);
        outputs.push({
          type: 'function_call_output',
          call_id: functionCall.call_id,
          output: JSON.stringify(toolOutputForModel(toolCall)),
        });
      }

      response = await this.createResponse({
        input: outputs,
        previousResponseId: response.id,
      });
    }

    return {
      provider: this.provider,
      agentId: this.id,
      responseId: response.id ?? null,
      message: extractOutputText(response) || 'I stopped after the maximum tool-call rounds.',
      toolCalls,
      rawStatus: response.status ?? null,
    };
  }

  async invokeFunctionCall(functionCall) {
    const input = parseArguments(functionCall.arguments);
    try {
      return {
        name: functionCall.name,
        callId: functionCall.call_id,
        input,
        status: 'success',
        result: await this.tools.invoke(functionCall.name, input),
      };
    } catch (error) {
      return {
        name: functionCall.name,
        callId: functionCall.call_id,
        input,
        status: 'error',
        error: error.message ?? 'Tool call failed.',
      };
    }
  }

  async createResponse({ input, previousResponseId }) {
    const body = {
      model: this.model,
      instructions: agentInstructions(),
      input,
      tools: this.tools.openAiTools(),
      tool_choice: 'auto',
      parallel_tool_calls: false,
      store: true,
    };
    if (previousResponseId) body.previous_response_id = previousResponseId;

    const response = await this.fetch(`${this.baseUrl.replace(/\/$/, '')}/responses`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    const value = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const error = new Error(value.error?.message ?? `OpenAI Responses request failed with ${response.status}`);
      error.statusCode = response.status;
      error.details = value;
      throw error;
    }
    return value;
  }
}

function buildInitialInput(request) {
  const context = [
    request.characterId ? `Current character id: ${request.characterId}` : '',
    request.sourceAssetKey ? `Current source asset key: ${request.sourceAssetKey}` : '',
    request.normalizedKey ? `Current normalized manifest key: ${request.normalizedKey}` : '',
  ].filter(Boolean).join('\n');

  return [
    ...(context ? [{ role: 'user', content: `CMS context:\n${context}` }] : []),
    { role: 'user', content: String(request.message ?? '') },
  ];
}

function agentInstructions() {
  return [
    'You are the Thousand Fighters CMS admin assistant.',
    'Use CMS tools to inspect and mutate character content. Do not claim a CMS change happened unless a tool call succeeded.',
    'Prefer targeted draft updates over regenerating a whole character when the user asks for stats, moveset, name, description, or animation binding changes.',
    'Use get_character_draft, get_character_assets, list_characters, and get_pipeline_status before making ambiguous changes.',
    'Do not publish, delete, or overwrite important assets unless the user explicitly asks for that action.',
    'If required information is missing, ask for the missing character id, asset key, normalized manifest key, or upload bytes instead of guessing.',
    'Keep responses concise and summarize which tools ran and what changed.',
  ].join('\n');
}

function parseArguments(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    const wrapped = new Error(`Invalid tool arguments JSON: ${value}`);
    wrapped.cause = error;
    throw wrapped;
  }
}

function extractOutputText(response) {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const parts = [];
  for (const item of response.output ?? []) {
    if (item.type !== 'message') continue;
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && content.text) parts.push(content.text);
      if (content.type === 'text' && content.text) parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

function toolOutputForModel(toolCall) {
  if (toolCall.status === 'success') {
    return {
      ok: true,
      result: summarizeToolResult(toolCall.result),
    };
  }
  return {
    ok: false,
    error: toolCall.error,
  };
}

function summarizeToolResult(result) {
  const text = JSON.stringify(result);
  if (text.length <= 6000) return result;
  return {
    truncated: true,
    preview: text.slice(0, 6000),
  };
}
