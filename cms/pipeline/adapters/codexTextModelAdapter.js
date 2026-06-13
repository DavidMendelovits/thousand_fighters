import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_CODEX_BIN = 'codex';
const DEFAULT_TIMEOUT_MS = 180_000;

export class CodexTextModelAdapter {
  constructor(options = {}) {
    this.codexBin = options.codexBin ?? process.env.CODEX_BIN ?? DEFAULT_CODEX_BIN;
    this.timeoutMs = options.timeoutMs ?? Number(process.env.CODEX_TEXT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
    this.id = 'codex-text-model';
    this.provider = 'codex';
    this.capabilities = ['structured-output', 'character-drafting', 'vision-describe'];
  }

  async healthCheck() {
    try {
      const version = await spawnWithStdin(this.codexBin, ['--version'], '', { timeout: 10_000 });
      return {
        status: 'ok',
        message: `Codex text model ready (${version.trim()}).`,
        details: { codexBin: this.codexBin },
      };
    } catch (err) {
      return {
        status: 'error',
        message: `Codex CLI not available: ${err.message}`,
      };
    }
  }

  async completeStructured(request = {}) {
    const onProgress = request.onProgress;
    const prompt = buildStructuredPrompt(request);

    onProgress?.({ type: 'prompt', task: request.task ?? 'structured-output', prompt });

    const output = await spawnWithStdin(
      this.codexBin,
      ['exec', '--sandbox', 'read-only'],
      prompt,
      {
        timeout: this.timeoutMs,
        onData: onProgress ? (chunk) => onProgress({ type: chunk.stream, data: chunk.data }) : undefined,
      },
    );

    const json = extractJson(output);
    if (!json) {
      throw new Error(`Codex did not return valid JSON. Output:\n${output.slice(0, 500)}`);
    }

    onProgress?.({ type: 'complete' });

    return {
      provider: 'codex',
      model: 'codex-text',
      promptRef: null,
      value: json,
    };
  }

  async describeImage({ imageBase64, contentType = 'image/png', prompt, onProgress }) {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'codex-vision-'));
    const ext = contentType === 'image/webp' ? '.webp' : contentType === 'image/jpeg' ? '.jpg' : '.png';
    const imgPath = path.join(tmpDir, `input${ext}`);
    await writeFile(imgPath, Buffer.from(imageBase64, 'base64'));

    try {
      const visionPrompt = prompt
        ?? 'Describe this character for a 2D fighting game sprite sheet in 2-3 sentences. Cover: appearance, build, weapon/prop, and art style. Be specific but brief.';

      onProgress?.({ type: 'prompt', task: 'vision-describe', prompt: visionPrompt });

      const output = await spawnWithStdin(
        this.codexBin,
        ['exec', '--sandbox', 'read-only', '-i', imgPath],
        visionPrompt,
        {
          timeout: this.timeoutMs,
          onData: onProgress ? (chunk) => onProgress({ type: chunk.stream, data: chunk.data }) : undefined,
        },
      );

      const description = extractContent(output);
      return {
        provider: 'codex',
        model: 'codex-vision',
        description,
        promptRef: null,
      };
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function buildStructuredPrompt(request) {
  const task = request.task ?? 'structured-output';
  const input = request.input ?? {};
  const schemaName = request.schemaName ?? 'StructuredResult';

  if (task === 'character-content-draft') {
    return [
      'You draft game-ready Thousand Fighters character content as strict JSON.',
      'Create a playable fighting-game character from the brief.',
      'Keep animation ids aligned with these move rows: punch, kick, special_1, special_2.',
      'Use six-frame generated fighter assumptions unless context explicitly says otherwise.',
      'Moves should be mechanically readable and usable by the runtime config.',
      '',
      'Return ONLY valid JSON matching this schema (no markdown, no explanation):',
      JSON.stringify(characterContentDraftSchema(), null, 2),
      '',
      `Character ID: ${input.characterId ?? 'new_fighter'}`,
      `Brief: ${input.brief ?? 'A fighting game character.'}`,
    ].join('\n');
  }

  return [
    `Return strict JSON matching the ${schemaName} schema. No markdown, no explanation.`,
    '',
    JSON.stringify(input, null, 2),
  ].join('\n');
}

function extractJson(codexOutput) {
  const cleaned = extractContent(codexOutput);
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = fenced ? fenced[1].trim() : cleaned;

  const braceStart = jsonText.indexOf('{');
  if (braceStart === -1) return null;

  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < jsonText.length; i++) {
    if (jsonText[i] === '{') depth++;
    else if (jsonText[i] === '}') depth--;
    if (depth === 0) { end = i + 1; break; }
  }
  if (end === -1) return null;

  try {
    return JSON.parse(jsonText.slice(braceStart, end));
  } catch {
    return null;
  }
}

function extractContent(codexOutput) {
  return codexOutput
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      if (!t) return false;
      if (t.startsWith('Reading additional')) return false;
      if (t.startsWith('OpenAI Codex')) return false;
      if (t.startsWith('--------')) return false;
      if (t.startsWith('workdir:')) return false;
      if (t.startsWith('model:')) return false;
      if (t.startsWith('provider:')) return false;
      if (t.startsWith('approval:')) return false;
      if (t.startsWith('sandbox:')) return false;
      if (t.startsWith('reasoning')) return false;
      if (t.startsWith('session id:')) return false;
      if (t.startsWith('tokens used')) return false;
      if (/^\d[\d,]+$/.test(t)) return false;
      if (t === 'user' || t === 'codex') return false;
      if (/ERROR|WARN/.test(t) && /codex_core|session|rollout/.test(t)) return false;
      return true;
    })
    .join('\n')
    .trim();
}

function characterContentDraftSchema() {
  return {
    type: 'object',
    required: ['displayName', 'description', 'stats', 'sprite', 'moves'],
    properties: {
      displayName: { type: 'string' },
      description: { type: 'string' },
      stats: {
        type: 'object',
        required: ['walkForwardSpeed', 'walkBackSpeed', 'jumpVelocity', 'jumpForwardVelocity', 'jumpBackVelocity', 'gravity', 'maxFallSpeed', 'maxHealth'],
        properties: {
          walkForwardSpeed: { type: 'number' },
          walkBackSpeed: { type: 'number' },
          jumpVelocity: { type: 'number' },
          jumpForwardVelocity: { type: 'number' },
          jumpBackVelocity: { type: 'number' },
          gravity: { type: 'number' },
          maxFallSpeed: { type: 'number' },
          maxHealth: { type: 'integer' },
        },
      },
      sprite: {
        type: 'object',
        required: ['basePath', 'scale', 'relativeHeight', 'frameCounts'],
        properties: {
          basePath: { type: 'string' },
          scale: { type: 'number' },
          relativeHeight: {
            type: 'number',
            description: 'On-screen height relative to a standard fighter. 1.0 = standard, up to 1.6 for giants, down to 0.5 for tiny fighters.',
          },
          frameCounts: {
            type: 'object',
            required: ['base', 'punch', 'kick', 'special_1', 'special_2'],
            properties: {
              base: { type: 'integer' },
              punch: { type: 'integer' },
              kick: { type: 'integer' },
              special_1: { type: 'integer' },
              special_2: { type: 'integer' },
            },
          },
        },
      },
      moves: {
        type: 'array',
        minItems: 4,
        items: {
          type: 'object',
          required: ['id', 'displayName', 'description', 'animation', 'trigger', 'phases'],
          properties: {
            id: { type: 'string' },
            displayName: { type: 'string' },
            description: { type: 'string' },
            animation: { type: 'string', enum: ['punch', 'kick', 'special_1', 'special_2'] },
            trigger: {
              type: 'object',
              required: ['sequence'],
              properties: { sequence: { type: 'array', items: { type: 'string' } } },
            },
            phases: {
              type: 'array',
              minItems: 3,
              items: {
                type: 'object',
                required: ['name', 'frames', 'events'],
                properties: {
                  name: { type: 'string' },
                  frames: { type: 'integer' },
                  events: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['frame', 'event'],
                      properties: {
                        frame: { type: 'integer' },
                        event: {
                          type: 'object',
                          required: ['type'],
                          properties: {
                            type: { type: 'string' },
                            hitbox: {},
                            projectile: {},
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

function spawnWithStdin(command, args, stdinText, options = {}) {
  return new Promise((resolve, reject) => {
    const { onData, timeout, ...spawnOptions } = options;
    const proc = spawn(command, args, { ...spawnOptions, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    const errChunks = [];
    proc.stdout.on('data', (d) => {
      chunks.push(d);
      if (onData) {
        try { onData({ stream: 'stdout', data: d.toString('utf8') }); } catch {}
      }
    });
    proc.stderr.on('data', (d) => {
      errChunks.push(d);
      if (onData) {
        try { onData({ stream: 'stderr', data: d.toString('utf8') }); } catch {}
      }
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      const stdout = Buffer.concat(chunks).toString('utf8');
      const stderr = Buffer.concat(errChunks).toString('utf8');
      if (code !== 0 && code !== null) {
        reject(new Error([stderr.trim(), stdout.trim(), `exit code ${code}`].filter(Boolean).join('\n')));
      } else {
        resolve(stdout + stderr);
      }
    });
    proc.stdin.write(stdinText);
    proc.stdin.end();

    if (timeout) {
      setTimeout(() => { try { proc.kill(); } catch {} }, timeout);
    }
  });
}
