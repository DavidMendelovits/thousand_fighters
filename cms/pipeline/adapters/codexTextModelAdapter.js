import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  characterContentDraftSchema,
  characterContentDraftGuidance,
  comboAuthoringSchema,
  comboAuthoringGuidance,
} from './characterContentDraftSchema.js';

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

    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'codex-structured-'));
    try {
      const finalMessagePath = path.join(tmpDir, 'final.json');
      await spawnWithStdin(
        this.codexBin,
        ['exec', '--sandbox', 'read-only', '--output-last-message', finalMessagePath],
        prompt,
        {
          timeout: this.timeoutMs,
          onData: onProgress ? (chunk) => onProgress({ type: chunk.stream, data: chunk.data }) : undefined,
        },
      );
      // CLI stderr may echo the entire prompt, including the JSON schema. Its
      // first brace is not the answer. Read only the dedicated final message.
      const finalMessage = await readFile(finalMessagePath, 'utf8');
      const json = extractJson(finalMessage);
      if (!json) throw new Error('Codex did not return a valid JSON final message.');
      if (request.task === 'character-content-draft' &&
        (typeof json.displayName !== 'string' || !Array.isArray(json.moves) || json.moves.length < 4)) {
        throw new Error('Codex returned an incomplete character kit. Draft was not saved.');
      }

      onProgress?.({ type: 'complete' });

      return {
        provider: 'codex',
        model: 'codex-text',
        promptRef: null,
        value: json,
      };
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async describeImage({ imageBase64, contentType = 'image/png', prompt, onProgress }) {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'codex-vision-'));
    const ext = contentType === 'image/webp' ? '.webp' : contentType === 'image/jpeg' ? '.jpg' : '.png';
    const imgPath = path.join(tmpDir, `input${ext}`);
    await writeFile(imgPath, Buffer.from(imageBase64, 'base64'));

    try {
      const visionPrompt = prompt
        ?? 'Describe this character for a 2D fighting game sprite sheet in 2-3 sentences. Cover: appearance, build, weapon/prop, and art style. Be specific but brief.';
      const finalMessagePath = path.join(tmpDir, 'final.txt');

      onProgress?.({ type: 'prompt', task: 'vision-describe', prompt: visionPrompt });

      await spawnWithStdin(
        this.codexBin,
        ['exec', '--sandbox', 'read-only', '-i', imgPath, '--output-last-message', finalMessagePath],
        visionPrompt,
        {
          timeout: this.timeoutMs,
          onData: onProgress ? (chunk) => onProgress({ type: chunk.stream, data: chunk.data }) : undefined,
        },
      );

      const description = (await readFile(finalMessagePath, 'utf8')).trim();
      if (!description) throw new Error('Codex returned an empty image description.');
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
      ...characterContentDraftGuidance(),
      '',
      'Return ONLY valid JSON matching this schema (no markdown, no explanation):',
      JSON.stringify(characterContentDraftSchema(), null, 2),
      '',
      `Character ID: ${input.characterId ?? 'new_fighter'}`,
      `Brief: ${input.brief ?? 'A fighting game character.'}`,
    ].join('\n');
  }

  if (task === 'combo-authoring') {
    return [
      ...comboAuthoringGuidance(),
      '',
      'Return ONLY valid JSON matching this schema (no markdown, no explanation):',
      JSON.stringify(comboAuthoringSchema(), null, 2),
      '',
      'Combo authoring input (segments to create, with their assigned animation row, plus existing-move inputs to avoid):',
      JSON.stringify(input, null, 2),
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

function spawnWithStdin(command, args, stdinText, options = {}) {
  return new Promise((resolve, reject) => {
    const { onData, timeout, ...spawnOptions } = options;
    const proc = spawn(command, args, { ...spawnOptions, stdio: ['pipe', 'pipe', 'pipe'] });
    let timedOut = false;
    const timer = timeout ? setTimeout(() => { timedOut = true; try { proc.kill(); } catch {} }, timeout) : null;
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
      if (timer) clearTimeout(timer);
      const stdout = Buffer.concat(chunks).toString('utf8');
      const stderr = Buffer.concat(errChunks).toString('utf8');
      if (timedOut) { reject(new Error(`Codex CLI timed out after ${timeout} ms.`)); return; }
      if (code !== 0 && code !== null) {
        reject(new Error([stderr.trim(), stdout.trim(), `exit code ${code}`].filter(Boolean).join('\n')));
      } else {
        resolve(stdout + stderr);
      }
    });
    proc.stdin.write(stdinText);
    proc.stdin.end();
  });
}
