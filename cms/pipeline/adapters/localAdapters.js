import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

export function createLocalTextModel(overrides = {}) {
  return {
    id: overrides.id ?? 'local-character-drafter',
    provider: overrides.provider ?? 'local',
    capabilities: ['structured-output', 'deterministic-drafts'],
    async healthCheck() {
      return {
        status: 'ok',
        message: 'Local deterministic character drafter is available.',
      };
    },
    async completeStructured(request) {
      const characterId = request.input?.characterId ?? 'new_fighter';
      const displayName = titleize(characterId);
      const brief = request.input?.brief ?? '';

      return {
        provider: 'local',
        model: 'deterministic-template',
        promptRef: `local://${request.task}/${characterId}`,
        value: {
          displayName,
          description: brief || `${displayName} is a draft fighter created in the local CMS pipeline.`,
          stats: {
            walkForwardSpeed: 3,
            walkBackSpeed: 2,
            jumpVelocity: 11,
            jumpForwardVelocity: 4,
            jumpBackVelocity: 3.2,
            gravity: 0.55,
            maxFallSpeed: 12,
            maxHealth: 1000,
          },
          sprite: {
            basePath: `/fighters/${characterId}`,
            scale: 0.55,
            frameCounts: {
              base: 6,
              punch: 6,
              kick: 6,
              special_1: 6,
              special_2: 6,
            },
          },
          moves: defaultMoves(),
        },
      };
    },
  };
}

export function createLocalPlaceholderImageGenerator(overrides = {}) {
  return {
    id: overrides.id ?? 'local-placeholder-image-generator',
    provider: overrides.provider ?? 'local',
    capabilities: ['fighter-5x6-sheet', 'placeholder-assets'],
    async healthCheck() {
      return {
        status: 'warning',
        message: 'Using local SVG image generator. This verifies the pipeline but is not production image generation.',
      };
    },
    async generateImage(request) {
      const svg = createSpriteSheetSvg(request.prompt);
      return {
        provider: 'local',
        model: 'deterministic-svg-sheet',
        promptRef: `local://${request.task}`,
        contentType: 'image/svg+xml',
        bytes: Buffer.from(svg, 'utf8'),
      };
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

function defaultMoves() {
  return [
    { id: 'light_punch', displayName: 'Light Punch', animation: 'punch', phases: defaultStrikePhases(3, 3, 8) },
    { id: 'heavy_punch', displayName: 'Heavy Punch', animation: 'punch', phases: defaultStrikePhases(8, 4, 18) },
    { id: 'crouch_low_kick', displayName: 'Low Kick', animation: 'kick', phases: defaultStrikePhases(4, 4, 10) },
    { id: 'dash_punch', displayName: 'Dash Strike', animation: 'punch', phases: defaultStrikePhases(7, 5, 16) },
    { id: 'uppercut', displayName: 'Uppercut', animation: 'special_2', phases: defaultStrikePhases(5, 8, 24) },
    { id: 'fireball', displayName: 'Projectile Special', animation: 'special_1', phases: defaultStrikePhases(12, 4, 22) },
  ];
}

function defaultStrikePhases(startup, active, recovery) {
  return [
    { name: 'startup', frames: startup, events: [] },
    { name: 'active', frames: active, events: [] },
    { name: 'recovery', frames: recovery, events: [] },
  ];
}

function titleize(value) {
  return String(value)
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function createSpriteSheetSvg(prompt) {
  const cols = 6;
  const rows = 5;
  const cellWidth = 150;
  const cellHeight = 150;
  const labels = ['base', 'punch', 'kick', 'special 1', 'special 2'];
  const safePrompt = escapeXml(prompt ?? 'Draft fighter sheet');
  const cells = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = col * cellWidth;
      const y = row * cellHeight;
      const hue = (row * 70 + col * 18) % 360;
      cells.push(`
        <rect x="${x + 8}" y="${y + 8}" width="${cellWidth - 16}" height="${cellHeight - 16}" rx="6" fill="hsl(${hue} 55% 24%)" stroke="hsl(${hue} 75% 62%)" stroke-width="2"/>
        <ellipse cx="${x + 75}" cy="${y + 98}" rx="${26 + col * 2}" ry="10" fill="rgba(0,0,0,0.35)"/>
        <path d="M${x + 74} ${y + 36} C${x + 45} ${y + 44}, ${x + 46 + col * 4} ${y + 104}, ${x + 76} ${y + 112} C${x + 106} ${y + 102}, ${x + 104 - row * 3} ${y + 44}, ${x + 74} ${y + 36} Z" fill="hsl(${(hue + 38) % 360} 70% 64%)"/>
        <circle cx="${x + 75}" cy="${y + 30}" r="18" fill="hsl(${(hue + 92) % 360} 62% 72%)"/>
        <path d="M${x + 76} ${y + 62} L${x + 42 + col * 4} ${y + 84}" stroke="#f7efe2" stroke-width="8" stroke-linecap="round"/>
        <path d="M${x + 78} ${y + 64} L${x + 111 - row * 3} ${y + 82}" stroke="#f7efe2" stroke-width="8" stroke-linecap="round"/>
        <text x="${x + 14}" y="${y + 132}" fill="#f4f7ff" font-family="monospace" font-size="12">${labels[row]} ${col + 1}</text>
      `);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cellWidth}" height="${rows * cellHeight}" viewBox="0 0 ${cols * cellWidth} ${rows * cellHeight}">
  <rect width="100%" height="100%" fill="#ff00ff"/>
  <rect x="0" y="0" width="100%" height="34" fill="#111827" opacity="0.9"/>
  <text x="16" y="23" fill="#f4f7ff" font-family="monospace" font-size="14">${safePrompt}</text>
  ${cells.join('\n')}
</svg>`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
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
