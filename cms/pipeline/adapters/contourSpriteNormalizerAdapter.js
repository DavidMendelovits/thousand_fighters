import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'normalize_fighter_sheet_contours.py');

const EXEC_TIMEOUT_MS = 60_000;

export class ContourSpriteNormalizerAdapter {
  constructor(options = {}) {
    this.storage = options.storage;
    this.repository = options.repository;
    this.id = 'contour-sprite-normalizer';
    this.provider = 'local';
    this.capabilities = ['fighter-pack-normalization', 'contour-detection', 'background-removal'];
  }

  async healthCheck() {
    const results = await Promise.allSettled([
      checkPython3(),
      checkPillow(),
      checkScriptExists(),
    ]);

    const [python3Result, pillowResult, scriptResult] = results;

    const details = {
      python3: resultToDetail(python3Result),
      pillow: resultToDetail(pillowResult),
      script: resultToDetail(scriptResult),
    };

    const errors = [];
    const warnings = [];

    if (python3Result.status === 'rejected' || details.python3.status === 'error') {
      errors.push(details.python3.message ?? 'Python3 is not available.');
    }
    if (pillowResult.status === 'rejected' || details.pillow.status === 'error') {
      errors.push(details.pillow.message ?? 'Pillow (PIL) is not installed.');
    }
    if (scriptResult.status === 'rejected' || details.script.status === 'error') {
      errors.push(details.script.message ?? `Script not found: ${SCRIPT_PATH}`);
    }

    if (errors.length > 0) {
      return {
        status: 'error',
        message: errors.join(' '),
        details,
      };
    }

    return {
      status: 'ok',
      message: 'Contour sprite normalizer is ready (Python3, Pillow, and script all available).',
      details,
    };
  }

  async normalizeFighterPack(request) {
    const characterId = required(request.characterId, 'characterId');
    const sourceAssetKey = required(request.sourceAssetKey, 'sourceAssetKey');
    const projectileId = request.projectileId ?? 'projectile';
    const projectileIndex = request.projectileIndex ?? 28;
    const now = request.requestedAt ?? new Date().toISOString();

    // Pre-flight: check prerequisites before spawning
    await assertPrerequisites();

    if (!(await this.storage.exists(sourceAssetKey))) {
      throw new Error(`Cannot normalize missing source asset: ${sourceAssetKey}`);
    }

    // Read source image bytes from storage
    const sourceBytes = await this.storage.getBytes(sourceAssetKey);

    const normalizedRootKey = `characters/${characterId}/assets/fighter-pack`;
    const normalizedKey = `${normalizedRootKey}/manifest.json`;
    const frameDataKey = `${normalizedRootKey}/frameData.json`;
    const reportKey = `${normalizedRootKey}/normalization-report.json`;

    // Create temp directory. The Python script will create output_dir itself;
    // we must NOT pre-create it or the script will delete it.
    const tmpParent = await mkdtemp(path.join(os.tmpdir(), 'thousand-fighters-normalizer-'));

    try {
      // Write source image to temp dir
      const sourceFileName = path.basename(sourceAssetKey);
      const tmpSourcePath = path.join(tmpParent, sourceFileName.endsWith('.png') ? sourceFileName : `${characterId}_imagegen_sheet.png`);
      await writeFile(tmpSourcePath, sourceBytes);

      // Write description.txt to temp dir (from CMS storage if available, else placeholder)
      const descriptionKey = `characters/${characterId}/assets/description.txt`;
      const movesetKey = `characters/${characterId}/assets/moveset.txt`;

      const descriptionText = await readTextFromStorage(this.storage, descriptionKey)
        ?? `${titleize(characterId)} — fighter description placeholder.`;
      const movesetText = await readTextFromStorage(this.storage, movesetKey)
        ?? `${titleize(characterId)} — moveset placeholder.`;

      const tmpDescriptionPath = path.join(tmpParent, 'description.txt');
      const tmpMovesetPath = path.join(tmpParent, 'moveset.txt');
      await writeFile(tmpDescriptionPath, descriptionText, 'utf8');
      await writeFile(tmpMovesetPath, movesetText, 'utf8');

      // Output dir must NOT exist before Python script runs (script wipes it if it does)
      const tmpOutputDir = path.join(tmpParent, 'output');

      // Build CLI args
      const args = [
        SCRIPT_PATH,
        tmpSourcePath,
        tmpOutputDir,
        '--character-id', characterId,
        '--projectile-id', projectileId,
        '--projectile-index', String(projectileIndex),
        '--description', tmpDescriptionPath,
        '--moveset', tmpMovesetPath,
      ];

      // Only pass --special2-indices if provided
      if (request.special2Indices !== undefined && request.special2Indices !== null) {
        const special2Value = Array.isArray(request.special2Indices)
          ? request.special2Indices.join(',')
          : String(request.special2Indices);
        args.push('--special2-indices', special2Value);
      }

      // Run the Python script
      let stdout;
      let stderr;
      try {
        const result = await execFileAsync('python3', args, {
          timeout: EXEC_TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024, // 10 MB
        });
        stdout = result.stdout;
        stderr = result.stderr;
      } catch (error) {
        const detail = error.killed
          ? `Script timed out after ${EXEC_TIMEOUT_MS / 1000}s`
          : (error.stderr ?? error.message ?? 'Unknown error');
        throw new Error(`Contour normalizer script failed for ${characterId}: ${detail}`);
      }

      // The script must have produced the core pack files; fail loudly with
      // stderr context instead of uploading a partial pack.
      const outputFiles = await collectFiles(tmpOutputDir);
      const missingOutputs = ['manifest.json', 'frameData.json', 'normalization-report.json']
        .filter((file) => !outputFiles.includes(file));
      if (missingOutputs.length > 0) {
        const stderrTail = (stderr ?? '').trim().split('\n').slice(-5).join('\n');
        throw new Error(
          `Contour normalizer did not produce ${missingOutputs.join(', ')} for ${characterId}.`
          + (stderrTail ? ` stderr: ${stderrTail}` : ''),
        );
      }

      // Walk output directory and upload all files to CMS storage
      for (const relativePath of outputFiles) {
        const absoluteFilePath = path.join(tmpOutputDir, relativePath.split('/').join(path.sep));
        const targetKey = `${normalizedRootKey}/${relativePath}`;
        const fileBytes = await readFile(absoluteFilePath);
        await this.storage.putBytes(targetKey, fileBytes, {
          contentType: contentTypeFor(relativePath),
          artifactType: 'contour-normalized-asset',
          sourceAssetKey,
          characterId,
        });
      }

      // Read the generated JSON files from temp output
      const rawManifest = await readJsonFromFile(path.join(tmpOutputDir, 'manifest.json'));
      const report = await readJsonFromFile(path.join(tmpOutputDir, 'normalization-report.json'));

      // Enrich manifest with CMS metadata and overwrite the already-uploaded copy
      const enrichedManifest = {
        ...rawManifest,
        characterId,
        cms: {
          workflow: 'contour-sprite-normalizer',
          sourceAssetKey,
          assetRootKey: normalizedRootKey,
          generatedAt: now,
          copiedFileCount: outputFiles.length,
        },
      };
      await this.storage.putJson(normalizedKey, enrichedManifest, {
        contentType: 'application/json',
        artifactType: 'normalized-manifest',
        sourceAssetKey,
      });

      return {
        status: report.warnings?.length > 0 ? 'warning' : 'pass',
        provider: 'local',
        characterId,
        outputKey: normalizedKey,
        frameDataKey,
        reportKey,
        assetRootKey: normalizedRootKey,
        copiedFileCount: outputFiles.length,
        warnings: report.warnings ?? [],
      };
    } finally {
      await rm(tmpParent, { force: true, recursive: true });
    }
  }
}

// --- helpers ---

async function checkPython3() {
  try {
    const { stdout } = await execFileAsync('python3', ['--version'], { timeout: 10_000 });
    return { status: 'ok', message: stdout.trim() };
  } catch (error) {
    return { status: 'error', message: `python3 not found: ${error.message}` };
  }
}

async function checkPillow() {
  try {
    const { stdout } = await execFileAsync('python3', ['-c', 'import PIL; print(PIL.__version__)'], { timeout: 10_000 });
    return { status: 'ok', message: `Pillow ${stdout.trim()}` };
  } catch (error) {
    return { status: 'error', message: `Pillow not installed: ${error.message}` };
  }
}

async function checkScriptExists() {
  try {
    await stat(SCRIPT_PATH);
    return { status: 'ok', message: `Script found: ${SCRIPT_PATH}` };
  } catch {
    return { status: 'error', message: `Script not found: ${SCRIPT_PATH}` };
  }
}

function resultToDetail(settled) {
  if (settled.status === 'fulfilled') return settled.value;
  return { status: 'error', message: settled.reason?.message ?? String(settled.reason) };
}

async function assertPrerequisites() {
  const [python3Result, pillowResult] = await Promise.all([checkPython3(), checkPillow()]);
  const errors = [];
  if (python3Result.status === 'error') errors.push('Python3 is not available.');
  if (pillowResult.status === 'error') errors.push('Pillow (PIL) is not installed. Run: pip3 install Pillow');
  if (errors.length > 0) {
    throw new Error(`Contour normalizer prerequisites missing: ${errors.join(' ')}`);
  }
}

async function readTextFromStorage(storage, key) {
  try {
    if (!(await storage.exists(key))) return null;
    const bytes = await storage.getBytes(key);
    return bytes.toString('utf8');
  } catch {
    return null;
  }
}

async function collectFiles(rootDir, currentDir = rootDir) {
  const currentStat = await stat(currentDir);
  if (currentStat.isFile()) {
    return [toPosixPath(path.relative(rootDir, currentDir))];
  }

  const entries = await readdir(currentDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(rootDir, absolutePath));
    } else if (entry.isFile()) {
      files.push(toPosixPath(path.relative(rootDir, absolutePath)));
    }
  }
  return files.sort();
}

async function readJsonFromFile(filePath) {
  const content = await readFile(filePath, 'utf8');
  return JSON.parse(content);
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function contentTypeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.json':
      return 'application/json';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.svg':
      return 'image/svg+xml';
    case '.txt':
      return 'text/plain; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function required(value, name) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required field: ${name}`);
  }
  return value;
}

function titleize(value) {
  return String(value)
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}
