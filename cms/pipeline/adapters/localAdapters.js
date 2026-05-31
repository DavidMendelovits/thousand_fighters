import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

export function createLocalTextModel(overrides = {}) {
  return {
    id: overrides.id ?? 'local-character-drafter',
    provider: overrides.provider ?? 'local',
    capabilities: ['structured-output', 'vision-describe'],
    async healthCheck() {
      return {
        status: 'error',
        message: 'No text model configured. Set TEXT_MODEL_PROVIDER=openai and provide OPENAI_API_KEY.',
      };
    },
    async describeImage() {
      throw new Error(
        'No text model configured. Set TEXT_MODEL_PROVIDER=openai and provide OPENAI_API_KEY.',
      );
    },
    async completeStructured() {
      throw new Error(
        'No text model configured. Set TEXT_MODEL_PROVIDER=openai and provide OPENAI_API_KEY.',
      );
    },
  };
}

export function createLocalPlaceholderImageGenerator(overrides = {}) {
  return {
    id: overrides.id ?? 'local-placeholder-image-generator',
    provider: overrides.provider ?? 'local',
    capabilities: ['fighter-1x6-row', 'arena-background', 'character-concept'],
    async healthCheck() {
      return {
        status: 'error',
        message: 'No image generator configured. Set IMAGE_GENERATOR_PROVIDER=codex or IMAGE_GENERATOR_PROVIDER=openai.',
      };
    },
    async generateImage() {
      throw new Error(
        'No image generator configured. Set IMAGE_GENERATOR_PROVIDER=codex or IMAGE_GENERATOR_PROVIDER=openai.',
      );
    },
  };
}

export function createLocalPlaceholderSoundGenerator(overrides = {}) {
  return {
    id: overrides.id ?? 'local-placeholder-sound-generator',
    provider: overrides.provider ?? 'local',
    capabilities: ['audio-generation', 'sfx', 'bgm'],
    async healthCheck() {
      return {
        status: 'error',
        message: 'No sound generator configured. Set SOUND_GENERATOR_PROVIDER=openai or SOUND_GENERATOR_PROVIDER=elevenlabs.',
      };
    },
    async generateAudio() {
      throw new Error(
        'No sound generator configured. Set SOUND_GENERATOR_PROVIDER=openai or SOUND_GENERATOR_PROVIDER=elevenlabs.',
      );
    },
  };
}

export function createLocalSpriteNormalizer({ storage, fixtureFighterId = 'janitor', fixtureRoot } = {}) {
  const resolvedFixtureRoot = path.resolve(fixtureRoot ?? path.join(REPO_ROOT, 'public', 'fighters', fixtureFighterId));

  return {
    id: 'local-fixture-normalizer',
    provider: 'local',
    capabilities: ['fighter-pack-normalization', 'fixture-pack-copy', 'real-asset-shape'],
    async healthCheck() {
      const files = await collectFiles(resolvedFixtureRoot);
      const missing = ['manifest.json', 'frameData.json', 'normalization-report.json', 'sheets/base.png', 'sprites/base/base_001.png']
        .filter((relativePath) => !files.includes(relativePath));

      return {
        status: missing.length === 0 ? 'warning' : 'error',
        message: missing.length === 0
          ? `Local normalizer copies the ${fixtureFighterId} fixture pack so test output has real fighter assets. Production still needs contour normalization.`
          : `Fixture normalizer is missing required file(s): ${missing.join(', ')}`,
        details: {
          fixtureFighterId,
          fixtureRoot: resolvedFixtureRoot,
          fixtureFileCount: files.length,
          missing,
        },
      };
    },
    async normalizeFighterPack(request) {
      const characterId = required(request.characterId, 'characterId');
      const sourceAssetKey = required(request.sourceAssetKey, 'sourceAssetKey');
      const normalizedRootKey = `characters/${characterId}/assets/fighter-pack`;
      const normalizedKey = `${normalizedRootKey}/manifest.json`;
      const frameDataKey = `${normalizedRootKey}/frameData.json`;
      const reportKey = `${normalizedRootKey}/normalization-report.json`;
      const now = request.requestedAt ?? new Date().toISOString();

      if (!(await storage.exists(sourceAssetKey))) {
        throw new Error(`Cannot normalize missing source asset: ${sourceAssetKey}`);
      }

      const files = await collectFiles(resolvedFixtureRoot);
      const copiedFiles = [];
      for (const relativePath of files) {
        const fixturePath = path.join(resolvedFixtureRoot, relativePath);
        const targetKey = `${normalizedRootKey}/${relativePath}`;
        await storage.putBytes(targetKey, await readFile(fixturePath), {
          contentType: contentTypeFor(relativePath),
          artifactType: 'fixture-normalized-asset',
          sourceFixture: `/fighters/${fixtureFighterId}/${relativePath}`,
        });
        copiedFiles.push(targetKey);
      }

      const manifest = await readJsonIfPresent(path.join(resolvedFixtureRoot, 'manifest.json'));
      if (manifest) {
        await storage.putJson(normalizedKey, {
          ...manifest,
          characterId,
          cms: {
            workflow: 'local-fixture-normalizer',
            sourceAssetKey,
            fixtureFighterId,
            assetRootKey: normalizedRootKey,
            generatedAt: now,
            copiedFileCount: copiedFiles.length,
          },
        }, {
          contentType: 'application/json',
          artifactType: 'normalized-manifest',
          sourceFixture: `/fighters/${fixtureFighterId}/manifest.json`,
        });
      }

      return {
        status: 'pass',
        provider: 'local',
        characterId,
        outputKey: normalizedKey,
        frameDataKey,
        reportKey,
        assetRootKey: normalizedRootKey,
        copiedFileCount: copiedFiles.length,
        fixtureFighterId,
        warnings: [`Copied fixture assets from ${fixtureFighterId}; replace with contour normalizer before production publishing.`],
      };
    },
  };
}

export function createLocalFighterQa({ repository } = {}) {
  return {
    id: 'local-placeholder-fighter-qa',
    provider: 'local',
    capabilities: ['fighter-pack-validation', 'placeholder-qa'],
    async healthCheck() {
      return {
        status: 'warning',
        message: 'Placeholder QA is active. Real sprite/image validation is still required before production publishing.',
      };
    },
    async validateFighterPack(request) {
      const characterId = required(request.characterId, 'characterId');
      const runId = request.runId ?? `run-${new Date().toISOString().replaceAll(':', '-')}`;
      const report = {
        status: request.normalizedKey ? 'pass' : 'warning',
        characterId,
        normalizedKey: request.normalizedKey ?? null,
        generatedAt: request.requestedAt ?? new Date().toISOString(),
        checks: [
          {
            id: 'pipeline-connected',
            status: 'pass',
            message: 'CMS pipeline, repository, and tool invocation are connected.',
          },
          {
            id: 'real-qa-adapter',
            status: 'warning',
            message: 'Placeholder QA is active. Implement fighter-pack image validation before production publishing.',
          },
        ],
      };
      const artifact = await repository.writeQaReport(characterId, runId, report);
      return {
        ...report,
        provider: 'local',
        reportKey: artifact.key,
        reportUrl: artifact.url,
      };
    },
  };
}

export function createLocalPublisher({ repository, storage } = {}) {
  return {
    id: 'local-release-publisher',
    provider: 'local',
    capabilities: ['character-publish', 'local-release-bundle'],
    async healthCheck() {
      return {
        status: 'warning',
        message: 'Local publisher writes release JSON, but publish gates are not enforcing real QA yet.',
      };
    },
    async publishCharacter(request) {
      const characterId = required(request.characterId, 'characterId');
      const releaseId = request.releaseId ?? `local-${new Date().toISOString().replaceAll(':', '-')}`;
      const draft = await repository.getDraft(characterId);
      const version = await repository.createVersion(characterId, draft, {
        versionId: releaseId,
        metadata: {
          releaseId,
          publishedBy: 'local-release-publisher',
        },
      });
      const bundleKey = `releases/${releaseId}/characters/${characterId}.json`;
      const latestKey = `releases/latest/characters/${characterId}.json`;
      const bundle = {
        releaseId,
        characterId,
        publishedAt: request.requestedAt ?? new Date().toISOString(),
        content: version,
      };

      await storage.putJson(bundleKey, bundle, { contentType: 'application/json', releaseId });
      await storage.putJson(latestKey, bundle, { contentType: 'application/json', releaseId, alias: 'latest' });

      return {
        status: 'published',
        provider: 'local',
        characterId,
        releaseId,
        versionId: version.versionId,
        bundleKey,
        latestKey,
      };
    },
  };
}

function required(value, name) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required field: ${name}`);
  }
  return value;
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

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
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
