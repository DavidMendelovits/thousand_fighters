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
    this.capabilities = ['fighter-1x6-row', 'fighter-2x3-grid', 'arena-background', 'character-concept', 'codex-image-gen', 'vision-describe'];
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
    const referenceImages = request.referenceImages ?? [];
    const codexPrompt = buildCodexPrompt(task, request.prompt, request.context, request.moveId, referenceImages.length);
    const onProgress = request.onProgress;
    const maxAttempts = 2;

    onProgress?.({ type: 'prompt', task, prompt: codexPrompt });

    // Reference images (approved base row, concept art) ride along as -i
    // attachments so codex matches identity, palette, and scale.
    let tmpDir = null;
    const imageArgs = [];
    if (referenceImages.length) {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), 'codex-ref-'));
      for (const [index, image] of referenceImages.entries()) {
        const ext = image.contentType === 'image/webp' ? '.webp' : image.contentType === 'image/jpeg' ? '.jpg' : '.png';
        const refPath = path.join(tmpDir, `reference_${index}${ext}`);
        await writeFile(refPath, Buffer.from(image.base64, 'base64'));
        imageArgs.push('-i', refPath);
      }
    }

    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const beforeTimestamp = Date.now() - 3000;

        const codexOutput = await spawnWithStdin(
          this.codexBin,
          ['exec', '--sandbox', 'workspace-write', ...imageArgs],
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
    } finally {
      if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
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

function buildCodexPrompt(task, userPrompt, context, moveId, referenceCount = 0) {
  const referenceNote = referenceCount
    ? ` ${referenceCount} reference image(s) are attached — match their character identity, proportions, palette, outfit, and on-screen scale exactly; this is the same fighter.`
    : '';

  if (task === 'character-concept') {
    return `Generate an image: a character turnaround sheet, 1x3 grid of three equal square panels. Left=front view, center=3/4 profile, right=back view. Full body, light gray #f0f0f0 background, no text. Character: ${userPrompt ?? 'a fighter'}${referenceNote}`;
  }

  if (task === 'fighter-1x6-row') {
    const resolvedMoveId = moveId ?? context?.moveId ?? 'base';
    const motionNote = resolvedMoveId === 'base'
      ? 'This is an IDLE LOOP: motion between frames must be subtle — a few pixels of breathing and sway, feet planted on the same floor spot, silhouette near-identical across all 6 frames. Frame roles: 1 neutral, 2-3 gentle inhale, 4 peak of breath, 5-6 settle back to neutral.'
      : 'Frame roles: 1-2 startup, 3 reaching, 4 moment of contact, 5 follow-through, 6 recovery.';
    return `Generate an image: a single-row fighting game sprite strip with exactly 6 frames for the "${resolvedMoveId}" move. Magenta #ff00ff background, full body visible, generous gutters, every limb visually connected to the body. Frames must never overlap: leave a wide band of pure magenta between neighbors — not a single pixel of one frame may cross into another frame's cell. ${motionNote} Character: ${userPrompt ?? 'a fighter'}${referenceNote}`;
  }

  if (task === 'fighter-2x3-grid') {
    const resolvedMoveId = moveId ?? context?.moveId ?? 'base';
    return `Generate an image: a fighting game sprite sheet with exactly 2 rows and 3 columns (6 frames, left-to-right then top-to-bottom) for the "${resolvedMoveId}" move — a long-reach extending-limb attack. Wide cells; the extended limb stays connected to the body as one continuous silhouette. Frames must never overlap: leave a wide band of pure magenta between neighbors — not a single pixel of one frame may cross into another frame's cell. Frame roles: 1-2 startup, 3 extending, 4 full extension at maximum reach, 5 retraction, 6 recovery. Magenta #ff00ff background, full body visible, generous gutters, consistent scale and floor line. Character: ${userPrompt ?? 'a fighter'}${referenceNote}`;
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
