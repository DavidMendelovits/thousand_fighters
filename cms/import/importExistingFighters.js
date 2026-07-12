import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CharacterContentRepository } from '../repositories/CharacterContentRepository.js';
import { createCmsStorage } from '../storage/createCmsStorage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

export async function importExistingFightersToCms(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? REPO_ROOT);
  const fightersRoot = path.resolve(options.fightersRoot ?? path.join(repoRoot, 'public', 'fighters'));
  const storage = options.storage ?? createCmsStorage({
    provider: 'file',
    rootDir: options.cmsRootDir ?? path.join(repoRoot, 'cms-data'),
  });
  const repository = options.repository ?? new CharacterContentRepository(storage);
  const importedAt = options.importedAt ?? new Date().toISOString();
  const runtimeConfigs = await readRuntimeCharacterConfigs(repoRoot);

  const entries = await readdir(fightersRoot, { withFileTypes: true });
  const fighterDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('_'))
    .sort();

  const imported = [];
  const skipped = [];

  for (const fighterId of fighterDirs) {
    const fighterRoot = path.join(fightersRoot, fighterId);
    const files = await collectFiles(fighterRoot);
    if (files.length === 0) {
      skipped.push({ id: fighterId, reason: 'No files found.' });
      continue;
    }

    imported.push(await importFighterPack({
      fighterId,
      fighterRoot,
      files,
      publicPath: `/fighters/${fighterId}`,
      repository,
      runtimeConfig: runtimeConfigs.get(fighterId),
      importedAt,
    }));
  }

  return {
    importedAt,
    fightersRoot,
    storageRoot: storage.rootDir ?? null,
    imported,
    skipped,
  };
}

async function importFighterPack({ fighterId, fighterRoot, files, publicPath, repository, runtimeConfig, importedAt }) {
  for (const relativePath of files) {
    await repository.writeAsset(fighterId, relativePath, await readFile(path.join(fighterRoot, relativePath)), {
      contentType: contentTypeFor(relativePath),
      source: 'public/fighters',
      sourcePath: `${publicPath}/${relativePath}`,
      importedAt,
    });
  }

  const manifest = await readJsonIfPresent(path.join(fighterRoot, 'manifest.json'));
  const frameData = await readJsonIfPresent(path.join(fighterRoot, 'frameData.json'));
  const normalizationReport = await readJsonIfPresent(path.join(fighterRoot, 'normalization-report.json'));
  const descriptionText = await readTextIfPresent(path.join(fighterRoot, 'description.txt'));
  const movesetText = await readTextIfPresent(path.join(fighterRoot, 'moveset.txt'));
  const actorPacks = await readActorPacks({ fighterId, fighterRoot, publicPath, repository });
  const primaryActor = actorPacks.find((actor) => actor.id === 'lead') ?? actorPacks[0] ?? null;
  const primaryManifest = manifest ?? primaryActor?.manifest ?? null;
  const runtimeStats = runtimeConfig ? pickCharacterStats(runtimeConfig) : null;

  const draft = {
    schemaVersion: 1,
    id: fighterId,
    displayName: runtimeConfig?.displayName ?? titleize(fighterId),
    description: manifest?.character_description ?? descriptionText ?? `${titleize(fighterId)} imported from public fighter assets.`,
    stats: runtimeStats ?? {},
    hurtboxes: runtimeConfig?.hurtboxes ?? {},
    animations: runtimeConfig?.animations ?? {},
    source: {
      type: 'existing-public-fighter',
      publicPath,
      importedAt,
      runtimeConfigSource: 'src/characters/stamptownFighters.ts',
    },
    assets: {
      rootKey: `characters/${repository.safeCharacterId(fighterId)}/assets`,
      publicPath,
      descriptionKey: files.includes('description.txt') ? repository.assetKey(fighterId, 'description.txt') : null,
      movesetKey: files.includes('moveset.txt') ? repository.assetKey(fighterId, 'moveset.txt') : null,
      manifestKey: files.includes('manifest.json') ? repository.assetKey(fighterId, 'manifest.json') : null,
      frameDataKey: files.includes('frameData.json') ? repository.assetKey(fighterId, 'frameData.json') : null,
      normalizationReportKey: files.includes('normalization-report.json') ? repository.assetKey(fighterId, 'normalization-report.json') : null,
      copiedFileCount: files.length,
      actorPacks: actorPacks.map(stripActorManifest),
    },
    sprite: {
      basePath: publicPath,
      frameCounts: primaryManifest?.frame_counts ?? primaryManifest?.frameCounts ?? {},
      sheetPaths: primaryManifest?.sheet_paths ?? primaryManifest?.sheetPaths ?? {},
      spritePaths: primaryManifest?.sprite_paths ?? primaryManifest?.spritePaths ?? {},
      frameDataAvailable: Boolean(frameData ?? primaryActor?.frameData),
      normalizationWarnings: normalizationReport?.warnings ?? primaryActor?.normalizationReport?.warnings ?? [],
      actorPacks: actorPacks.map(stripActorManifest),
      runtime: runtimeConfig?.sprite ?? null,
    },
    moves: runtimeConfig?.moves ?? parseMoveset(movesetText),
    gameplay: {
      stats: runtimeStats ?? {},
      hurtboxes: runtimeConfig?.hurtboxes ?? {},
      animations: runtimeConfig?.animations ?? {},
      actorCount: runtimeConfig?.actors?.length ?? 1,
      actors: runtimeConfig?.actors?.map(summarizeActor) ?? [],
      moveCount: runtimeConfig?.moves?.length ?? parseMoveset(movesetText).length,
      runtimeConfigImported: Boolean(runtimeConfig),
    },
    migration: {
      status: runtimeConfig ? 'runtime-config-imported' : 'imported-assets-only',
      note: runtimeConfig
        ? 'Assets and runtime CharacterConfig data are in the file CMS. Export back to game runtime is still a separate step.'
        : 'Assets and text movesets are in the file CMS. Full runtime CharacterConfig migration/export is still a separate step.',
    },
  };

  const savedDraft = await repository.saveDraft(fighterId, draft, {
    provider: 'file-import',
    source: 'public/fighters',
    copiedFileCount: files.length,
  });

  return {
    id: fighterId,
    displayName: savedDraft.displayName,
    copiedFileCount: files.length,
    hasManifest: Boolean(manifest),
    hasFrameData: Boolean(frameData),
    hasNormalizationReport: Boolean(normalizationReport),
    actorPacks: actorPacks.map(({ id, copiedFileCount }) => ({ id, copiedFileCount })),
  };
}

async function readActorPacks({ fighterId, fighterRoot, publicPath, repository }) {
  const entries = await readdir(fighterRoot, { withFileTypes: true });
  const actors = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const actorRoot = path.join(fighterRoot, entry.name);
    const manifest = await readJsonIfPresent(path.join(actorRoot, 'manifest.json'));
    if (!manifest) continue;

    const actorFiles = (await collectFiles(actorRoot)).map((relativePath) => `${entry.name}/${relativePath}`);
    const frameData = await readJsonIfPresent(path.join(actorRoot, 'frameData.json'));
    const normalizationReport = await readJsonIfPresent(path.join(actorRoot, 'normalization-report.json'));

    actors.push({
      id: entry.name,
      publicPath: `${publicPath}/${entry.name}`,
      manifest,
      frameData,
      normalizationReport,
      manifestKey: repository.assetKey(fighterId, `${entry.name}/manifest.json`),
      frameDataKey: actorFiles.includes(`${entry.name}/frameData.json`) ? repository.assetKey(fighterId, `${entry.name}/frameData.json`) : null,
      normalizationReportKey: actorFiles.includes(`${entry.name}/normalization-report.json`)
        ? repository.assetKey(fighterId, `${entry.name}/normalization-report.json`)
        : null,
      copiedFileCount: actorFiles.length,
      frameCounts: manifest.frame_counts ?? manifest.frameCounts ?? {},
      sheetPaths: manifest.sheet_paths ?? manifest.sheetPaths ?? {},
      spritePaths: manifest.sprite_paths ?? manifest.spritePaths ?? {},
    });
  }

  return actors.sort((left, right) => left.id.localeCompare(right.id));
}

function stripActorManifest(actor) {
  return {
    id: actor.id,
    publicPath: actor.publicPath,
    manifestKey: actor.manifestKey,
    frameDataKey: actor.frameDataKey,
    normalizationReportKey: actor.normalizationReportKey,
    copiedFileCount: actor.copiedFileCount,
    frameCounts: actor.frameCounts,
    sheetPaths: actor.sheetPaths,
    spritePaths: actor.spritePaths,
  };
}

async function readRuntimeCharacterConfigs(repoRoot) {
  const sourcePath = path.join(repoRoot, 'src', 'characters', 'stamptownFighters.ts');
  const configs = new Map();
  let tempDir = null;

  try {
    const tsModule = await import('typescript');
    const ts = tsModule.default ?? tsModule;
    const source = await readFile(sourcePath, 'utf8');
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
        importsNotUsedAsValues: ts.ImportsNotUsedAsValues?.Remove,
      },
    }).outputText;
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'thousand-fighters-runtime-config-'));
    const modulePath = path.join(tempDir, 'stamptownFighters.mjs');
    await writeFile(modulePath, transpiled, 'utf8');
    const module = await import(pathToFileURL(modulePath).href);

    for (const character of module.playableCharacters ?? []) {
      configs.set(character.id, character);
    }
  } catch (error) {
    if (!error || (error.code !== 'ENOENT' && error.code !== 'ERR_MODULE_NOT_FOUND')) throw error;
  } finally {
    if (tempDir) await rm(tempDir, { force: true, recursive: true });
  }

  return configs;
}

function pickCharacterStats(config) {
  return {
    walkForwardSpeed: config.walkForwardSpeed,
    walkBackSpeed: config.walkBackSpeed,
    jumpVelocity: config.jumpVelocity,
    jumpForwardVelocity: config.jumpForwardVelocity,
    jumpBackVelocity: config.jumpBackVelocity,
    gravity: config.gravity,
    maxFallSpeed: config.maxFallSpeed,
    maxHealth: config.maxHealth,
    pivotOffsetY: config.pivotOffsetY,
  };
}

function summarizeActor(actor) {
  return {
    id: actor.id,
    offsetX: actor.offsetX ?? 0,
    offsetY: actor.offsetY ?? 0,
    followDelay: actor.followDelay ?? 0,
    visualDelay: actor.visualDelay ?? 0,
    defaultVisible: actor.defaultVisible ?? false,
    visibleInFusion: actor.visibleInFusion ?? false,
    sprite: actor.sprite ?? null,
    hurtboxes: actor.hurtboxes ?? {},
  };
}

function parseMoveset(text) {
  if (!text) return [];

  const moves = [];
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      current = { id: header[1] };
      moves.push(current);
      continue;
    }

    const field = line.match(/^([^=]+)=(.*)$/);
    if (field && current) {
      current[field[1].trim()] = field[2].trim();
    }
  }

  return moves;
}

async function collectFiles(rootDir, currentDir = rootDir) {
  const currentStat = await stat(currentDir);
  if (currentStat.isFile()) return [toPosixPath(path.relative(rootDir, currentDir))];

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

async function readTextIfPresent(filePath) {
  try {
    return readFile(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function titleize(value) {
  return String(value)
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
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
