import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_CODEX_BIN = 'codex';
const DEFAULT_TIMEOUT_MS = 180_000;
const GENERATED_IMAGES_DIR = path.join(os.homedir(), '.codex', 'generated_images');

export class CodexImageGeneratorAdapter {
  constructor(options = {}) {
    this.codexBin = options.codexBin ?? process.env.CODEX_BIN ?? DEFAULT_CODEX_BIN;
    this.timeoutMs = options.timeoutMs ?? Number(process.env.CODEX_IMAGE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
    this.id = 'codex-image-generator';
    this.provider = 'codex';
    this.capabilities = ['fighter-1x6-row', 'arena-background', 'character-concept', 'codex-image-gen', 'vision-describe'];
  }

  async healthCheck() {
    try {
      const version = await spawnWithStdin(this.codexBin, ['--version'], '', { timeout: 10_000 });
      return {
        status: 'ok',
        message: `Codex image generator ready (${version.trim()}). Uses your ChatGPT subscription for image generation.`,
        details: { codexBin: this.codexBin, generatedImagesDir: GENERATED_IMAGES_DIR },
      };
    } catch (err) {
      return {
        status: 'error',
        message: `Codex CLI not available: ${err.message}`,
      };
    }
  }

  async generateImage(request) {
    const task = request.task ?? 'image-generation';
    const codexPrompt = buildCodexPrompt(task, request.prompt, request.context, request.moveId);
    const onProgress = request.onProgress;
    const maxAttempts = 2;

    onProgress?.({ type: 'prompt', task, prompt: codexPrompt });

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const beforeTimestamp = Date.now() - 3000;

      const codexOutput = await spawnWithStdin(
        this.codexBin,
        ['exec', '--sandbox', 'workspace-write'],
        codexPrompt,
        { timeout: this.timeoutMs, onData: onProgress ? (chunk) => onProgress({ type: chunk.stream, data: chunk.data }) : undefined },
      );

      const imageFile = await findNewestImage(GENERATED_IMAGES_DIR, beforeTimestamp);
      if (imageFile) {
        const bytes = await readFile(imageFile);
        onProgress?.({ type: 'complete', imageFound: true });
        return {
          provider: 'codex',
          model: 'codex-image-gen',
          promptRef: null,
          contentType: 'image/png',
          base64: bytes.toString('base64'),
          bytes,
        };
      }

      if (attempt < maxAttempts) continue;
      throw new Error(`Codex did not generate an image after ${maxAttempts} attempts. Last output:\n${codexOutput.slice(0, 300)}`);
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

      onProgress?.({ type: 'prompt', task: 'vision-describe', prompt: visionPrompt });

      const output = await spawnWithStdin(
        this.codexBin,
        ['exec', '--sandbox', 'read-only', '-i', imgPath],
        visionPrompt,
        { timeout: this.timeoutMs, onData: onProgress ? (chunk) => onProgress({ type: chunk.stream, data: chunk.data }) : undefined },
      );

      const description = extractDescription(output);
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

function extractDescription(codexOutput) {
  const lines = codexOutput.split('\n');
  const contentLines = lines.filter((l) => {
    const trimmed = l.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith('Reading additional')) return false;
    if (trimmed.startsWith('OpenAI Codex')) return false;
    if (trimmed.startsWith('--------')) return false;
    if (trimmed.startsWith('workdir:')) return false;
    if (trimmed.startsWith('model:')) return false;
    if (trimmed.startsWith('provider:')) return false;
    if (trimmed.startsWith('approval:')) return false;
    if (trimmed.startsWith('sandbox:')) return false;
    if (trimmed.startsWith('reasoning')) return false;
    if (trimmed.startsWith('session id:')) return false;
    if (trimmed.startsWith('tokens used')) return false;
    if (/^\d[\d,]+$/.test(trimmed)) return false;
    if (trimmed === 'user' || trimmed === 'codex') return false;
    if (/ERROR|WARN/.test(trimmed) && /codex_core|session|rollout/.test(trimmed)) return false;
    return true;
  });
  return contentLines.join('\n').trim();
}

function buildCodexPrompt(task, userPrompt, context, moveId) {
  if (task === 'character-concept') {
    return `Generate an image: a character turnaround sheet, 1x3 grid of three equal square panels. Left=front view, center=3/4 profile, right=back view. Full body, light gray #f0f0f0 background, no text. Character: ${userPrompt ?? 'a fighter'}`;
  }

  if (task === 'fighter-1x6-row') {
    const resolvedMoveId = moveId ?? context?.moveId ?? 'base';
    return `Generate an image: a single-row fighting game sprite strip with exactly 6 frames for the "${resolvedMoveId}" move. Magenta #ff00ff background, full body visible, generous gutters. Show clear animation progression. Character: ${userPrompt ?? 'a fighter'}`;
  }

  if (task === 'arena-background') {
    return [
      'Generate an image using your image generation tool.',
      'Draw a 2D fighting game arena background.',
      'Wide 16:9 composition, flat ground plane, dramatic lighting.',
      'No characters, no UI, no text.',
      '',
      'Arena description:',
      userPrompt ?? '',
    ].join('\n');
  }

  return `Generate an image using your image generation tool.\n\n${userPrompt ?? ''}`;
}

async function findNewestImage(baseDir, afterTimestamp) {
  try {
    const entries = await readdir(baseDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

    let newest = null;
    let newestMtime = 0;

    for (const dir of dirs) {
      const dirPath = path.join(baseDir, dir);
      const dirStat = await stat(dirPath);
      if (dirStat.mtimeMs < afterTimestamp) continue;

      const files = await readdir(dirPath);
      for (const file of files) {
        if (!file.endsWith('.png') && !file.endsWith('.jpg') && !file.endsWith('.webp')) continue;
        const filePath = path.join(dirPath, file);
        const fileStat = await stat(filePath);
        if (fileStat.mtimeMs > newestMtime) {
          newest = filePath;
          newestMtime = fileStat.mtimeMs;
        }
      }
    }

    return newest;
  } catch {
    return null;
  }
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
