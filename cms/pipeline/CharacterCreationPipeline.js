import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, readdir, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { PipelinePort } from './ports.js';
import { normalizeManifest } from './manifestSchema.js';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXTRACT_SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'extract_row_frames.py');

export class CharacterCreationPipeline {
  constructor(registry, options = {}) {
    this.registry = registry;
    this.clock = options.clock ?? (() => new Date());
  }

  async createCharacterDraft({ characterId, brief, schemaVersion = 1, context = {} }) {
    const textModel = this.registry.resolve(PipelinePort.TEXT_MODEL);
    const repository = this.registry.resolve(PipelinePort.CHARACTER_REPOSITORY);
    const result = await textModel.completeStructured({
      task: 'character-content-draft',
      schemaName: 'CharacterContentDraft',
      schemaVersion,
      input: {
        characterId,
        brief,
        context,
      },
      onProgress: context.onProgress,
    });

    const content = {
      schemaVersion,
      id: characterId,
      displayName: result.value?.displayName ?? characterId,
      description: result.value?.description ?? brief,
      stats: result.value?.stats ?? {},
      sprite: result.value?.sprite ?? {},
      moves: result.value?.moves ?? [],
      generation: {
        provider: result.provider ?? textModel.provider ?? 'unknown',
        adapterId: textModel.id ?? 'textModel',
        createdAt: this.clock().toISOString(),
        promptRef: result.promptRef ?? null,
      },
    };

    return repository.saveDraft(characterId, content, {
      provider: content.generation.provider,
      adapterId: content.generation.adapterId,
    });
  }

  async generateCharacterConcept({ characterId, prompt, context = {} }) {
    const imageGenerator = this.registry.resolve(PipelinePort.IMAGE_GENERATOR);
    const repository = this.registry.resolve(PipelinePort.CHARACTER_REPOSITORY);
    const result = await imageGenerator.generateImage({
      task: 'character-concept',
      prompt,
      context: { characterId, ...context },
      onProgress: context.onProgress,
    });
    const bytes = result.bytes ? Buffer.from(result.bytes) : Buffer.from(result.base64 ?? '', 'base64');
    const contentType = result.contentType ?? 'image/png';
    const ext = contentType === 'image/svg+xml' ? '.svg' : contentType === 'image/webp' ? '.webp' : '.png';
    const asset = await repository.writeAsset(characterId, `concept/concept_art${ext}`, bytes, {
      contentType,
      provider: result.provider,
      model: result.model,
      prompt,
    });
    return {
      asset,
      provider: result.provider,
      model: result.model,
      promptRef: result.promptRef ?? null,
      revisedPrompt: result.revisedPrompt ?? null,
    };
  }

  async describeImage({ characterId, imageBase64, contentType = 'image/png', context = {} }) {
    const prompt = 'Describe this character for a 2D fighting game sprite sheet in 2-3 sentences. Cover: appearance, build, weapon/prop, and art style. Be specific but brief.';

    const imageGenerator = this.registry.resolve(PipelinePort.IMAGE_GENERATOR);
    if (typeof imageGenerator.describeImage === 'function') {
      return imageGenerator.describeImage({ imageBase64, contentType, prompt, context, onProgress: context.onProgress });
    }

    const textModel = this.registry.resolve(PipelinePort.TEXT_MODEL);
    return textModel.describeImage({ imageBase64, contentType, prompt, context, onProgress: context.onProgress });
  }

  async generateSpriteSheet({ characterId, prompt, moveId, spriteProfile, referenceAssetKeys = [], targetPath, context = {} }) {
    const imageGenerator = this.registry.resolve(PipelinePort.IMAGE_GENERATOR);
    const repository = this.registry.resolve(PipelinePort.CHARACTER_REPOSITORY);
    const storage = this.registry.resolve(PipelinePort.ASSET_STORAGE);
    const resolvedMoveId = moveId ?? 'base';
    // 'wide' renders the 6 frames as a 2x3 grid so each cell is ~2x wider —
    // for moves whose limb extends far laterally (tentacle grabs, whips).
    const resolvedProfile = spriteProfile === 'wide' ? 'wide' : 'standard';

    // Reference images keep all rows of one fighter visually consistent.
    // Explicit keys win; otherwise the base row anchors to the concept art,
    // and every other row anchors to the approved base row plus concept art.
    let referenceKeys = referenceAssetKeys;
    if (!referenceKeys.length) {
      referenceKeys = resolvedMoveId === 'base'
        ? [`characters/${characterId}/assets/concept/concept_art.png`]
        : [
            `characters/${characterId}/assets/source/${characterId}_base_sheet.png`,
            `characters/${characterId}/assets/concept/concept_art.png`,
          ];
    }
    const referenceImages = [];
    for (const key of referenceKeys) {
      try {
        if (!(await storage.exists(key))) continue;
        const bytes = await storage.getBytes(key);
        const metadata = await storage.getMetadata?.(key).catch(() => null);
        referenceImages.push({
          base64: Buffer.from(bytes).toString('base64'),
          contentType: metadata?.contentType ?? 'image/png',
          sourceKey: key,
        });
      } catch {
        // missing/unreadable reference — generate without it
      }
    }

    const result = await imageGenerator.generateImage({
      task: resolvedProfile === 'wide' ? 'fighter-2x3-grid' : 'fighter-1x6-row',
      prompt,
      moveId: resolvedMoveId,
      spriteProfile: resolvedProfile,
      referenceAssetKeys: referenceKeys,
      referenceImages,
      context,
      onProgress: context.onProgress,
    });

    const contentType = result.contentType ?? 'image/png';
    const key = targetPath ?? `source/${characterId}_${resolvedMoveId}_sheet${extensionForContentType(contentType)}`;
    const asset = await repository.writeAsset(characterId, key, bytesFromImageResult(result), {
      contentType,
      provider: result.provider ?? imageGenerator.provider ?? 'unknown',
      adapterId: imageGenerator.id ?? 'imageGenerator',
      model: result.model ?? null,
      prompt,
    });

    // Non-base rows generated without the base sheet drift visually — surface
    // that so callers can warn or regenerate once the base row exists.
    const referencesUsed = referenceImages.map((image) => image.sourceKey);
    const baseReferenceAttached = referencesUsed.some((key) => key.endsWith(`${characterId}_base_sheet.png`));

    return {
      asset,
      provider: result.provider ?? imageGenerator.provider ?? 'unknown',
      model: result.model ?? null,
      promptRef: result.promptRef ?? null,
      referencesUsed,
      warnings: resolvedMoveId !== 'base' && !baseReferenceAttached
        ? ['no base sheet was available as a reference — this row may not match the fighter\'s look; regenerate it after the base row exists']
        : [],
    };
  }

  async extractRowFrames({ characterId, sourceAssetKey, moveId, spriteProfile, targetHeight, context = {} }) {
    const storage = this.registry.resolve(PipelinePort.ASSET_STORAGE);
    const packRoot = `characters/${characterId}/assets/fighter-pack`;

    // Resolve the silhouette height this row should be normalized to: explicit
    // override, else the fighter's existing base row. The base row defines the
    // fighter's scale; every other row is rescaled to match it. The base row's
    // median reach also defines the body envelope used to carve attack boxes
    // (pixels protruding beyond the idle body are the attacking limb/weapon).
    let resolvedTargetHeight = targetHeight ?? null;
    let bodyHalfWidth = null;
    if (moveId !== 'base') {
      try {
        const existing = await storage.getJson(`${packRoot}/frameData.json`);
        const baseFrames = existing?.frames?.base ?? [];
        const median = (values) => {
          const sorted = values
            .filter((value) => typeof value === 'number' && value > 0)
            .sort((a, b) => a - b);
          return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
        };
        if (!resolvedTargetHeight) {
          resolvedTargetHeight = median(baseFrames.map((frame) => frame.silhouetteHeight));
        }
        bodyHalfWidth = median(baseFrames.map((frame) => frame.reachX));
      } catch {
        // no base row yet — this row sets its own scale and gets no attack boxes
      }
    }

    const sourceBytes = await storage.getBytes(sourceAssetKey);
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'tf-extract-'));
    try {
      const inputPath = path.join(tempDir, 'source.png');
      const outputDir = path.join(tempDir, 'frames');
      await mkdir(outputDir, { recursive: true });
      await writeFile(inputPath, sourceBytes);

      const args = [EXTRACT_SCRIPT_PATH, inputPath, outputDir, '--move-id', moveId];
      if (spriteProfile === 'wide') args.push('--rows', '2', '--cols', '3');
      if (resolvedTargetHeight) args.push('--target-height', String(Math.round(resolvedTargetHeight)));
      if (bodyHalfWidth) args.push('--body-half-width', String(Math.round(bodyHalfWidth)));
      try {
        await execFileAsync('python3', args, {
          timeout: 60_000,
          maxBuffer: 10 * 1024 * 1024,
        });
      } catch (error) {
        const detail = error.killed
          ? 'extract_row_frames.py timed out after 60s'
          : (error.stderr?.trim() || error.message || 'Unknown error');
        throw new Error(`Frame extraction failed for ${characterId}/${moveId}: ${detail}`);
      }

      const report = JSON.parse(await readFile(path.join(outputDir, 'extraction_report.json'), 'utf8'));
      const fragment = report.frameData ?? [];
      if (!fragment.some((frame) => frame.silhouetteHeight > 0)) {
        throw new Error(
          `Frame extraction produced no usable frames for ${characterId}/${moveId}; the source sheet may be empty or fully transparent.`,
        );
      }

      const now = this.clock().toISOString();
      const spritesPrefix = `${packRoot}/sprites/${moveId}`;

      // Replace any stale frames from a previous extraction of this move.
      const staleKeys = await storage.list(spritesPrefix).catch(() => []);
      for (const key of staleKeys ?? []) {
        await storage.delete?.(key)?.catch?.(() => {});
      }

      const frames = [];
      const frameFiles = (await readdir(outputDir))
        .filter((file) => file.endsWith('.png') && file.startsWith(moveId))
        .sort();
      for (const file of frameFiles) {
        const key = `${spritesPrefix}/${file}`;
        await storage.putBytes(key, await readFile(path.join(outputDir, file)), {
          contentType: 'image/png',
          artifactType: 'row-normalized-frame',
          extractedFrom: sourceAssetKey,
        });
        frames.push({ key, url: storage.urlFor?.(key) ?? null });
      }

      const sheetKey = `${packRoot}/sheets/${moveId}.png`;
      await storage.putBytes(sheetKey, await readFile(path.join(outputDir, 'sheet.png')), {
        contentType: 'image/png',
        artifactType: 'row-normalized-sheet',
        extractedFrom: sourceAssetKey,
      });

      const extractionReportKey = `${spritesPrefix}/extraction_report.json`;
      await storage.putJson(extractionReportKey, report, {
        contentType: 'application/json',
        artifactType: 'extraction-report',
      });

      // Merge this move's frames into the pack frameData.
      const frameDataKey = `${packRoot}/frameData.json`;
      let frameData = await storage.getJson(frameDataKey).catch(() => null);
      if (!frameData?.frames || typeof frameData.frames !== 'object') {
        frameData = {
          anchorConvention: 'frame anchor is the character pivot/feet, in pixels from each PNG top-left',
          frames: {},
        };
      }
      frameData.frames[moveId] = fragment;
      await storage.putJson(frameDataKey, frameData, {
        contentType: 'application/json',
        artifactType: 'frame-data',
      });

      // Merge into the canonical manifest.
      const manifestKey = `${packRoot}/manifest.json`;
      let manifest = await storage.getJson(manifestKey).catch(() => null);
      manifest = normalizeManifest(manifest, { id: characterId }) ?? {};
      manifest.id = manifest.id ?? characterId;
      manifest.artSource = manifest.artSource ?? 'image-gen';
      manifest.frameData = 'frameData.json';
      manifest.sheets = { ...(manifest.sheets ?? {}), [moveId]: `sheets/${moveId}.png` };
      manifest.sprites = { ...(manifest.sprites ?? {}), [moveId]: fragment.map((frame) => frame.file) };
      manifest.frameCounts = { ...(manifest.frameCounts ?? {}), [moveId]: fragment.length };
      await storage.putJson(manifestKey, manifest, {
        contentType: 'application/json',
        artifactType: 'normalized-manifest',
      });

      // Merge warnings/measurements into the pack normalization report.
      const reportKey = `${packRoot}/normalization-report.json`;
      let normReport = await storage.getJson(reportKey).catch(() => null);
      if (!normReport || typeof normReport !== 'object') normReport = {};
      normReport.workflow = normReport.workflow ?? 'row-normalizer';
      normReport.moves = {
        ...(normReport.moves ?? {}),
        [moveId]: {
          generatedAt: now,
          sourceAssetKey,
          grid: report.grid,
          medianSilhouetteHeight: report.medianSilhouetteHeight,
          scaleApplied: report.scaleApplied,
          targetHeight: resolvedTargetHeight,
          warnings: report.warnings ?? [],
        },
      };
      normReport.warnings = Object.entries(normReport.moves)
        .flatMap(([move, entry]) => (entry.warnings ?? []).map((warning) => `${move}: ${warning}`));
      await storage.putJson(reportKey, normReport, {
        contentType: 'application/json',
        artifactType: 'normalization-report',
      });

      return {
        frames,
        moveId,
        sheetKey,
        frameDataKey,
        manifestKey,
        reportKey,
        assetRootKey: packRoot,
        targetHeight: resolvedTargetHeight,
        scaleApplied: report.scaleApplied,
        warnings: report.warnings ?? [],
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  async normalizeSpritePack(request) {
    const normalizer = this.registry.resolve(PipelinePort.SPRITE_NORMALIZER);
    return normalizer.normalizeFighterPack({
      requestedAt: this.clock().toISOString(),
      ...request,
    });
  }

  async validateFighterPack(request) {
    const qa = this.registry.resolve(PipelinePort.FIGHTER_QA);
    return qa.validateFighterPack({
      requestedAt: this.clock().toISOString(),
      ...request,
    });
  }

  async publishCharacter(request) {
    const publisher = this.registry.resolve(PipelinePort.PUBLISHER);
    return publisher.publishCharacter({
      requestedAt: this.clock().toISOString(),
      ...request,
    });
  }

  async generateCharacterSfx({ characterId, prompt, soundType = 'hit', context = {} }) {
    const soundGenerator = this.registry.resolve(PipelinePort.SOUND_GENERATOR);
    const repository = this.registry.resolve(PipelinePort.CHARACTER_REPOSITORY);
    const result = await soundGenerator.generateAudio({
      task: 'character-sfx',
      prompt,
      context,
      onProgress: context.onProgress,
    });

    const ext = extensionForContentType(result.contentType ?? 'audio/wav');
    const assetPath = `sounds/${soundType}${ext}`;
    const bytes = Buffer.from(result.base64, 'base64');
    const asset = await repository.writeAsset(characterId, assetPath, bytes, {
      contentType: result.contentType ?? 'audio/wav',
      provider: result.provider ?? soundGenerator.provider ?? 'unknown',
      adapterId: soundGenerator.id ?? 'soundGenerator',
      model: result.model ?? null,
      prompt,
      soundType,
    });

    return {
      asset,
      provider: result.provider ?? soundGenerator.provider ?? 'unknown',
      model: result.model ?? null,
      promptRef: result.promptRef ?? null,
    };
  }

  async generateArenaBackground({ arenaId, prompt, candidateIndex = 0, context = {} }) {
    const imageGenerator = this.registry.resolve(PipelinePort.IMAGE_GENERATOR);
    const storage = this.registry.resolve(PipelinePort.ASSET_STORAGE);
    const result = await imageGenerator.generateImage({
      task: 'arena-background',
      prompt,
      context: { arenaId, ...context },
      onProgress: context.onProgress,
    });
    const ext = result.contentType === 'image/svg+xml' ? '.svg'
      : result.contentType === 'image/webp' ? '.webp'
      : result.contentType === 'image/jpeg' ? '.jpg' : '.png';
    const key = `arenas/${arenaId}/candidate_${candidateIndex}${ext}`;
    const bytes = result.bytes instanceof Uint8Array || Buffer.isBuffer(result.bytes)
      ? Buffer.from(result.bytes)
      : Buffer.from(result.base64 ?? '', 'base64');
    await storage.putBytes(key, bytes, {
      contentType: result.contentType ?? 'image/png',
      provider: result.provider,
      arenaId,
      candidateIndex,
      prompt,
    });
    return { key, provider: result.provider, model: result.model, promptRef: result.promptRef };
  }

  async generateMultipleCandidates({ type, inputs }) {
    const results = await Promise.all(
      inputs.map((input, i) => {
        if (type === 'arena-background') {
          return this.generateArenaBackground({ ...input, candidateIndex: i });
        }
        throw new Error(`Unsupported candidate type: ${type}`);
      })
    );
    return results;
  }

  async generateBgm({ name, prompt, context = {} }) {
    const soundGenerator = this.registry.resolve(PipelinePort.SOUND_GENERATOR);
    const storage = this.registry.resolve(PipelinePort.ASSET_STORAGE);
    const result = await soundGenerator.generateAudio({
      task: 'bgm',
      prompt,
      context,
      onProgress: context.onProgress,
    });

    const ext = extensionForContentType(result.contentType ?? 'audio/wav');
    const storageKey = `audio/bgm/${name}${ext}`;
    const bytes = Buffer.from(result.base64, 'base64');
    await storage.putBytes(storageKey, bytes, {
      contentType: result.contentType ?? 'audio/wav',
      provider: result.provider ?? soundGenerator.provider ?? 'unknown',
      adapterId: soundGenerator.id ?? 'soundGenerator',
      model: result.model ?? null,
      prompt,
    });

    return {
      storageKey,
      provider: result.provider ?? soundGenerator.provider ?? 'unknown',
      model: result.model ?? null,
      promptRef: result.promptRef ?? null,
    };
  }
}

function bytesFromImageResult(result) {
  if (result.bytes instanceof Uint8Array) return result.bytes;
  if (Buffer.isBuffer(result.bytes)) return result.bytes;
  if (typeof result.base64 === 'string') return Buffer.from(result.base64, 'base64');
  if (typeof result.dataUrl === 'string') {
    const [, base64] = result.dataUrl.split(',');
    if (base64) return Buffer.from(base64, 'base64');
  }
  throw new Error('Image generator result must include bytes, base64, or dataUrl.');
}

function extensionForContentType(contentType) {
  if (contentType === 'image/svg+xml') return '.svg';
  if (contentType === 'image/webp') return '.webp';
  if (contentType === 'image/jpeg') return '.jpg';
  if (contentType === 'audio/mpeg') return '.mp3';
  if (contentType === 'audio/ogg') return '.ogg';
  if (contentType === 'audio/wav' || contentType === 'audio/wave') return '.wav';
  if (contentType === 'image/png') return '.png';
  return '.bin';
}
