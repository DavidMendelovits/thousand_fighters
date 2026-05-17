import { PipelinePort } from './ports.js';

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

  async generateSpriteSheet({ characterId, prompt, referenceAssetKeys = [], targetPath, context = {} }) {
    const imageGenerator = this.registry.resolve(PipelinePort.IMAGE_GENERATOR);
    const repository = this.registry.resolve(PipelinePort.CHARACTER_REPOSITORY);
    const result = await imageGenerator.generateImage({
      task: 'fighter-5x6-sheet',
      prompt,
      referenceAssetKeys,
      context,
    });

    const key = targetPath ?? `source/${characterId}_imagegen_sheet.png`;
    const asset = await repository.writeAsset(characterId, key, bytesFromImageResult(result), {
      contentType: result.contentType ?? 'image/png',
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
