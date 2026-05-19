import { execFile as execFileCallback, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalCmsRuntime } from '../runtime/createLocalCmsRuntime.js';

const DEFAULT_CODEX_MODEL = 'gpt-5.3-codex';
const DEFAULT_MAX_TOOL_ROUNDS = 4;

export function createLocalCodexCliCmsModule(options = {}) {
  const runtime = options.runtime ?? createLocalCmsRuntime(options.runtimeOptions ?? {});
  return new LocalCodexCliCmsModule({
    runtime,
    codexBin: options.codexBin ?? process.env.CODEX_BIN ?? 'codex',
    model: options.model ?? process.env.CODEX_CLI_MODEL ?? process.env.OPENAI_CODEX_MODEL ?? DEFAULT_CODEX_MODEL,
    cwd: options.cwd ?? process.cwd(),
    sandbox: options.sandbox ?? process.env.CODEX_CMS_SANDBOX ?? 'read-only',
    maxToolRounds: options.maxToolRounds ?? Number(process.env.CODEX_CMS_MAX_TOOL_ROUNDS ?? DEFAULT_MAX_TOOL_ROUNDS),
    timeoutMs: options.timeoutMs ?? Number(process.env.CODEX_CMS_TIMEOUT_MS ?? 120_000),
    execFile: options.execFile ?? execFileCallback,
  });
}

export class LocalCodexCliCmsModule {
  constructor({
    runtime,
    codexBin,
    model,
    cwd,
    sandbox,
    maxToolRounds,
    timeoutMs,
    execFile,
  }) {
    this.runtime = runtime;
    this.codexBin = codexBin;
    this.model = model;
    this.cwd = cwd;
    this.sandbox = sandbox;
    this.maxToolRounds = maxToolRounds;
    this.timeoutMs = timeoutMs;
    this.execFile = execFile;
    this.id = 'local-codex-cli-cms-module';
    this.provider = 'codex-cli';
    this.capabilities = [
      'codex-cli',
      'chatgpt-login',
      'tool-planning',
      'tool-invocation',
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

  async healthCheck() {
    const login = await this.codexLoginStatus();
    return {
      id: this.id,
      provider: this.provider,
      capabilities: this.capabilities,
      codex: {
        status: login.ok ? 'ok' : 'error',
        message: login.message,
        model: this.model,
        sandbox: this.sandbox,
      },
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

  async run(request, context = {}) {
    const normalized = typeof request === 'string'
      ? { message: request, ...context }
      : { ...(request ?? {}), ...context };

    const message = String(normalized.message ?? '').trim();
    if (!message) {
      const error = new Error('Codex CMS request message is required.');
      error.statusCode = 400;
      throw error;
    }

    const toolCalls = [];
    const observations = [];
    let latestPlan = null;

    for (let round = 0; round < this.maxToolRounds; round += 1) {
      latestPlan = await this.planWithCodex({
        request: normalized,
        observations,
        toolCalls,
      });

      const plannedCalls = sanitizePlannedCalls(latestPlan.toolCalls ?? [], this.listFunctions());
      if (plannedCalls.length === 0) {
        return resultFromPlan({ module: this, plan: latestPlan, toolCalls });
      }

      for (const plannedCall of plannedCalls) {
        const toolCall = await this.invokePlannedCall(plannedCall);
        toolCalls.push(toolCall);
        observations.push({
          name: toolCall.name,
          status: toolCall.status,
          result: toolCall.status === 'success' ? summarizeToolResult(toolCall.result) : undefined,
          error: toolCall.error,
        });
      }
    }

    return {
      provider: this.provider,
      moduleId: this.id,
      message: latestPlan?.message || 'Stopped after the maximum Codex CLI planning rounds.',
      toolCalls,
      rawPlan: latestPlan,
    };
  }

  async invokePlannedCall(plannedCall) {
    try {
      return {
        name: plannedCall.name,
        input: plannedCall.input ?? {},
        reason: plannedCall.reason ?? '',
        status: 'success',
        result: await this.invokeFunction(plannedCall.name, plannedCall.input ?? {}),
      };
    } catch (error) {
      return {
        name: plannedCall.name,
        input: plannedCall.input ?? {},
        reason: plannedCall.reason ?? '',
        status: 'error',
        error: error.message ?? 'Tool call failed.',
      };
    }
  }

  async planWithCodex({ request, observations, toolCalls }) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'thousand-fighters-codex-cli-'));
    const schemaPath = path.join(tempDir, 'codex-cms-plan.schema.json');
    const outputPath = path.join(tempDir, 'codex-cms-plan.json');

    try {
      const prompt = buildPlannerPrompt({
        request,
        observations,
        toolCalls,
        functions: this.listFunctions(),
      });
      await writeFile(schemaPath, JSON.stringify(codexPlanSchema(), null, 2), 'utf8');
      const execResult = await runExecFile(this.execFile, this.codexBin, [
        'exec',
        '--cd',
        this.cwd,
        '--sandbox',
        this.sandbox,
        '--model',
        this.model,
        '--ignore-user-config',
        '--output-schema',
        schemaPath,
        '--output-last-message',
        outputPath,
        '--skip-git-repo-check',
        '-',
      ], {
        cwd: this.cwd,
        timeout: this.timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        input: prompt,
      });

      return await readPlanOutput({ outputPath, execResult });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  }

  async codexLoginStatus() {
    try {
      const { stdout } = await runExecFile(this.execFile, this.codexBin, ['login', 'status'], {
        cwd: this.cwd,
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
      });
      return {
        ok: true,
        message: String(stdout || 'Codex login is available.').trim(),
      };
    } catch (error) {
      return {
        ok: false,
        message: error.stderr || error.message || 'Codex login status failed.',
      };
    }
  }
}

function buildPlannerPrompt({ request, observations, toolCalls, functions }) {
  return [
    'You are the Thousand Fighters local CMS planner running through Codex CLI.',
    'You do not directly edit files, run CMS mutations, or call external vendor APIs.',
    'Return only a JSON object matching the supplied output schema.',
    'Choose from the provided CMS functions when a local CMS action is needed.',
    'For every tool call, put the tool input object in inputJson as compact valid JSON.',
    'Set done=true and return no toolCalls when you can answer from observations or need missing information.',
    'Never invent a tool name. Never request shell commands. Keep planned calls minimal and explicit.',
    '',
    'Important provider boundary:',
    '- Codex CLI is only planning CMS function calls here.',
    '- Image bytes are produced by the configured CMS imageGenerator adapter.',
    '- If IMAGE_GENERATOR_PROVIDER=local, generate_sprite_sheet creates the local placeholder SVG.',
    '- If IMAGE_GENERATOR_PROVIDER=openai, generate_sprite_sheet needs OPENAI_API_KEY in this process.',
    '',
    'Current request:',
    JSON.stringify(request, null, 2),
    '',
    'Available CMS functions:',
    JSON.stringify(functions.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })), null, 2),
    '',
    'Prior tool calls this run:',
    JSON.stringify(toolCalls.map(({ name, input, status, error }) => ({
      name,
      input,
      status,
      error,
    })), null, 2),
    '',
    'Tool observations this run:',
    JSON.stringify(observations, null, 2),
  ].join('\n');
}

function codexPlanSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['message', 'done', 'toolCalls'],
    properties: {
      message: {
        type: 'string',
        description: 'Short user-facing status, final answer, or missing-information question.',
      },
      done: {
        type: 'boolean',
        description: 'True when no more CMS function calls are needed.',
      },
      toolCalls: {
        type: 'array',
        maxItems: 5,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'inputJson', 'reason'],
          properties: {
            name: { type: 'string' },
            inputJson: {
              type: 'string',
              description: 'Compact JSON object string to pass to the CMS function.',
            },
            reason: { type: 'string' },
          },
        },
      },
    },
  };
}

async function readPlanOutput({ outputPath, execResult }) {
  try {
    const output = await readFile(outputPath, 'utf8');
    if (output.trim()) return JSON.parse(output);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const extracted = extractJsonObject(execResult.stdout) || extractJsonObject(execResult.stderr);
  if (extracted) return JSON.parse(extracted);

  throw new Error([
    'Codex CLI did not write a structured CMS plan.',
    `stdout: ${preview(execResult.stdout)}`,
    `stderr: ${preview(execResult.stderr)}`,
  ].join('\n'));
}

function extractJsonObject(text = '') {
  const trimmed = String(text).trim();
  if (!trimmed) return '';
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Continue and look for a JSON object embedded in the CLI transcript.
  }

  const lastStart = trimmed.lastIndexOf('{');
  if (lastStart < 0) return '';
  for (let end = trimmed.length; end > lastStart; end -= 1) {
    const candidate = trimmed.slice(lastStart, end).trim();
    if (!candidate.endsWith('}')) continue;
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Keep walking back to find a parseable object.
    }
  }
  return '';
}

function preview(text = '') {
  const value = String(text).trim();
  return value.length > 4000 ? `${value.slice(0, 4000)}...` : value;
}

function sanitizePlannedCalls(plannedCalls, availableFunctions) {
  const allowed = new Set(availableFunctions.map((tool) => tool.name));
  return plannedCalls
    .filter((call) => allowed.has(call.name))
    .map((call) => ({
      name: call.name,
      input: parseToolInput(call),
      reason: call.reason ?? '',
    }));
}

function parseToolInput(call) {
  if (isPlainObject(call.input)) return call.input;
  if (typeof call.inputJson !== 'string' || !call.inputJson.trim()) return {};
  try {
    const parsed = JSON.parse(call.inputJson);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function resultFromPlan({ module, plan, toolCalls }) {
  return {
    provider: module.provider,
    moduleId: module.id,
    message: plan.message || 'Done.',
    toolCalls,
    rawPlan: plan,
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function runExecFile(execFile, file, args, options) {
  if (options.input !== undefined && execFile === execFileCallback) {
    return runSpawnFile(file, args, options);
  }

  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function runSpawnFile(file, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      const error = new Error(`Command timed out after ${options.timeout}ms: ${file} ${args.join(' ')}`);
      error.stdout = Buffer.concat(stdoutChunks).toString('utf8');
      error.stderr = Buffer.concat(stderrChunks).toString('utf8');
      rejectOnce(error);
    }, options.timeout);

    child.stdout.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));
    child.on('error', rejectOnce);
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(`Command failed with code ${code}${signal ? ` and signal ${signal}` : ''}: ${file} ${args.join(' ')}`);
      error.code = code;
      error.signal = signal;
      error.stdout = stdout;
      error.stderr = stderr;
      rejectOnce(error);
    });

    child.stdin.end(options.input);

    function rejectOnce(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    }
  });
}
