import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, readdir, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { PipelinePort } from './ports.js';

const execFileAsync = promisify(execFile);

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

  async generateSpriteSheet({ characterId, prompt, moveId, referenceAssetKeys = [], targetPath, context = {} }) {
    const imageGenerator = this.registry.resolve(PipelinePort.IMAGE_GENERATOR);
    const repository = this.registry.resolve(PipelinePort.CHARACTER_REPOSITORY);
    const resolvedMoveId = moveId ?? 'base';
    const result = await imageGenerator.generateImage({
      task: 'fighter-1x6-row',
      prompt,
      moveId: resolvedMoveId,
      referenceAssetKeys,
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

    return {
      asset,
      provider: result.provider ?? imageGenerator.provider ?? 'unknown',
      model: result.model ?? null,
      promptRef: result.promptRef ?? null,
    };
  }

  async extractRowFrames({ characterId, sourceAssetKey, moveId, context = {} }) {
    const storage = this.registry.resolve(PipelinePort.ASSET_STORAGE);
    const repository = this.registry.resolve(PipelinePort.CHARACTER_REPOSITORY);

    const sourceBytes = await storage.getBytes(sourceAssetKey);
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'tf-extract-'));
    const inputPath = path.join(tempDir, 'source.png');
    const outputDir = path.join(tempDir, 'frames');
    await mkdir(outputDir, { recursive: true });
    await writeFile(inputPath, sourceBytes);

    const scriptPath = path.join(process.cwd(), 'scripts', 'extract_row_frames.py');
    await execFileAsync('python3', [scriptPath, inputPath, outputDir, '--move-id', moveId], {
      timeout: 30_000,
    });

    // Read extracted frames and store as character assets
    const frameFiles = (await readdir(outputDir))
      .filter((f) => f.endsWith('.png') && f.startsWith(moveId))
      .sort();

    const frames = [];
    for (const file of frameFiles) {
      const frameBytes = await readFile(path.join(outputDir, file));
      const relativePath = `sprites/${moveId}/${file}`;
      const asset = await repository.writeAsset(characterId, relativePath, frameBytes, {
        contentType: 'image/png',
        extractedFrom: sourceAssetKey,
      });
      frames.push(asset);
    }

    // Clean up temp directory
    await rm(tempDir, { recursive: true, force: true });

    return { frames, moveId };
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
