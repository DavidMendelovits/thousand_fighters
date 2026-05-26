import { assetApiUrl, writeCharacterAssetUpload } from '../assets/uploadCharacterAsset.js';
import { exportCharacterToRuntime } from '../export/exportCharacterToRuntime.js';

export function createCmsTools({ pipeline, repository, registry }) {
  const tools = [
    {
      name: 'list_characters',
      description: 'List character records known to the CMS.',
      inputSchema: objectSchema({}),
      execute: async () => ({ characters: await repository.listCharacters() }),
    },
    {
      name: 'get_character_draft',
      description: 'Read a character draft by id.',
      inputSchema: objectSchema({
        characterId: stringSchema('Character id.'),
      }, ['characterId']),
      execute: async ({ characterId }) => ({ draft: await repository.getDraft(characterId) }),
    },
    {
      name: 'get_character_assets',
      description: 'List a character asset inventory with CMS URLs and metadata.',
      inputSchema: objectSchema({
        characterId: stringSchema('Character id.'),
      }, ['characterId']),
      execute: async ({ characterId }) => {
        const keys = await repository.listCharacterAssets(characterId);
        const assets = await Promise.all(keys.map((key) => assetRecordForKey({
          repository,
          storage: repository.storage,
          characterId,
          key,
        })));
        return { characterId, assets };
      },
    },
    {
      name: 'create_character_draft',
      description: 'Create or replace a character draft from a text brief.',
      inputSchema: objectSchema({
        characterId: stringSchema('Stable character id, such as janitor or new_fighter.'),
        brief: stringSchema('Character design and gameplay brief.'),
      }, ['characterId', 'brief']),
      execute: async ({ characterId, brief, context }) => ({
        draft: await pipeline.createCharacterDraft({ characterId, brief, context: context ?? {} }),
      }),
    },
    {
      name: 'update_character_draft',
      description: 'Patch a character draft. Use this for targeted edits to displayName, description, stats, gameplay, sprite, animations, or moves.',
      inputSchema: objectSchema({
        characterId: stringSchema('Character id.'),
        patch: {
          type: 'object',
          description: 'Partial character draft object to merge into the current draft. Arrays replace existing arrays.',
          additionalProperties: true,
        },
        note: stringSchema('Optional short reason for the edit.'),
      }, ['characterId', 'patch']),
      execute: async ({ characterId, patch, note }) => {
        const current = await repository.getDraft(characterId);
        const draft = await repository.saveDraft(characterId, deepMerge(current, patch ?? {}), {
          provider: 'cms-tool',
          adapterId: 'update-character-draft',
          note: note ?? null,
        });
        return { draft };
      },
    },
    {
      name: 'generate_sprite_sheet',
      description: 'Generate a draft 5x6 fighter sprite sheet asset.',
      inputSchema: objectSchema({
        characterId: stringSchema('Character id.'),
        prompt: stringSchema('Sprite generation prompt.'),
      }, ['characterId', 'prompt']),
      execute: async ({ characterId, prompt, context }) => {
        const result = await pipeline.generateSpriteSheet({
          characterId,
          prompt,
          context: context ?? {},
        });
        return withAssetApiUrl(result);
      },
    },
    {
      name: 'generate_character_concept',
      description: 'Generate character concept art showing front, profile, and back views.',
      inputSchema: objectSchema({
        characterId: stringSchema('Character id.'),
        prompt: stringSchema('Character description for concept art generation.'),
      }, ['characterId', 'prompt']),
      execute: async ({ characterId, prompt, context }) => {
        const result = await pipeline.generateCharacterConcept({ characterId, prompt, context: context ?? {} });
        return withAssetApiUrl(result);
      },
    },
    {
      name: 'describe_character_image',
      description: 'Analyze an uploaded character image and generate a text description for sprite generation.',
      inputSchema: objectSchema({
        characterId: stringSchema('Character id.'),
        imageBase64: stringSchema('Base64-encoded image data.'),
        contentType: stringSchema('Image MIME type (image/png, image/jpeg, image/webp).'),
      }, ['characterId', 'imageBase64']),
      execute: async ({ characterId, imageBase64, contentType, context }) => {
        const result = await pipeline.describeImage({ characterId, imageBase64, contentType, context: context ?? {} });
        return result;
      },
    },
    {
      name: 'normalize_sprite_pack',
      description: 'Normalize a generated sprite sheet into a fighter pack.',
      inputSchema: objectSchema({
        characterId: stringSchema('Character id.'),
        sourceAssetKey: stringSchema('Storage key of the generated source sheet.'),
        projectileId: stringSchema('Optional projectile/VFX id to export, such as bucket_wave. Defaults to projectile.'),
        projectileIndex: numberSchema('Optional 0-based source-sheet slot index for the projectile/VFX component. Defaults to 28.'),
        special2Indices: stringSchema('Optional comma-separated source-sheet slot indices for special_2 runtime frames.'),
      }, ['characterId', 'sourceAssetKey']),
      execute: async ({ context, ...input }) => ({ normalized: await pipeline.normalizeSpritePack({ ...input, context: context ?? {} }) }),
    },
    {
      name: 'add_character_asset',
      description: 'Write an uploaded character asset, such as a sprite frame, sheet, projectile, source image, or manifest file.',
      inputSchema: objectSchema({
        characterId: stringSchema('Character id.'),
        relativePath: stringSchema('Asset path under the character assets root, such as sprites/punch/punch_001.png.'),
        contentBase64: stringSchema('Base64-encoded asset bytes. Data URLs are also accepted.'),
        contentType: stringSchema('MIME type, such as image/png or application/json.'),
        metadata: {
          type: 'object',
          description: 'Optional asset metadata to store with the object.',
          additionalProperties: true,
        },
      }, ['characterId', 'relativePath', 'contentBase64']),
      execute: async ({ characterId, ...input }) => ({
        asset: await writeCharacterAssetUpload({
          repository,
          storage: repository.storage,
          characterId,
          input,
          source: 'tool-call',
        }),
      }),
    },
    {
      name: 'validate_fighter_pack',
      description: 'Run fighter pack QA and persist the report.',
      inputSchema: objectSchema({
        characterId: stringSchema('Character id.'),
        normalizedKey: stringSchema('Storage key for normalized manifest.'),
      }, ['characterId', 'normalizedKey']),
      execute: async (input) => ({ qa: await pipeline.validateFighterPack(input) }),
    },
    {
      name: 'publish_character',
      description: 'Publish a validated character draft to a release bundle.',
      inputSchema: objectSchema({
        characterId: stringSchema('Character id.'),
        releaseId: stringSchema('Release id.'),
      }, ['characterId', 'releaseId']),
      execute: async (input) => ({ published: await pipeline.publishCharacter(input) }),
    },
    {
      name: 'generate_character_sfx',
      description: 'Generate a sound effect for a character action and store it as a character asset.',
      inputSchema: objectSchema({
        characterId: stringSchema('Character id.'),
        prompt: stringSchema('Sound effect generation prompt describing the desired sound.'),
        soundType: stringSchema('Sound type identifier, such as hit, jump, or special. Defaults to hit.'),
      }, ['characterId', 'prompt']),
      execute: async ({ characterId, prompt, soundType = 'hit', context }) => {
        const result = await pipeline.generateCharacterSfx({ characterId, prompt, soundType, context: context ?? {} });
        return result;
      },
    },
    {
      name: 'generate_bgm',
      description: 'Generate background music and store it in asset storage.',
      inputSchema: objectSchema({
        name: stringSchema('Unique name for the BGM track, such as battle_theme or credits.'),
        prompt: stringSchema('Background music generation prompt describing mood, genre, and feel.'),
      }, ['name', 'prompt']),
      execute: async ({ name, prompt, context }) => {
        const result = await pipeline.generateBgm({ name, prompt, context: context ?? {} });
        return result;
      },
    },
    {
      name: 'upload_character_sound',
      description: 'Upload a sound file directly as a character asset.',
      inputSchema: objectSchema({
        characterId: stringSchema('Character id.'),
        soundName: stringSchema('Sound name without extension, such as hit or jump.'),
        contentBase64: stringSchema('Base64-encoded audio bytes. Data URLs are also accepted.'),
        contentType: stringSchema('MIME type of the audio, such as audio/wav or audio/mpeg. Defaults to audio/wav.'),
      }, ['characterId', 'soundName', 'contentBase64']),
      execute: async ({ characterId, soundName, contentBase64, contentType = 'audio/wav' }) => {
        const dataUrl = contentBase64.includes(',') ? contentBase64 : null;
        const base64 = dataUrl ? dataUrl.split(',')[1] : contentBase64;
        const ext = extForContentType(contentType);
        const relativePath = `sounds/${soundName}${ext}`;
        const bytes = Buffer.from(base64, 'base64');
        const asset = await repository.writeAsset(characterId, relativePath, bytes, {
          contentType,
          source: 'tool-upload',
        });
        return { asset };
      },
    },
    {
      name: 'generate_arena_background',
      description: 'Generate a fighting game arena background image.',
      inputSchema: objectSchema({
        arenaId: stringSchema('Unique arena identifier, such as ancient_temple or neon_city.'),
        prompt: stringSchema('Arena concept and visual style prompt.'),
        candidateCount: {
          type: 'number',
          description: 'Number of candidate images to generate. Defaults to 1.',
        },
      }, ['arenaId', 'prompt']),
      execute: async ({ arenaId, prompt, candidateCount = 1 }) => {
        if (candidateCount > 1) {
          const inputs = Array.from({ length: candidateCount }, () => ({ arenaId, prompt }));
          const candidates = await pipeline.generateMultipleCandidates({ type: 'arena-background', inputs });
          return { arenaId, candidateCount, candidates };
        }
        const result = await pipeline.generateArenaBackground({ arenaId, prompt, candidateIndex: 0 });
        return { arenaId, candidateCount: 1, candidates: [result] };
      },
    },
    {
      name: 'export_character_config',
      description: 'Convert a CMS character draft to a runtime CharacterConfig and write it to public/fighters/<characterId>/config.json.',
      inputSchema: objectSchema({
        characterId: stringSchema('Character id to export.'),
        outputDir: {
          type: 'string',
          description: 'Optional output directory root. Defaults to public/fighters.',
        },
        copyAssets: {
          type: 'boolean',
          description: 'Whether to copy fighter pack assets (sheets, sprites, projectiles) to the output directory. Defaults to true.',
        },
      }, ['characterId']),
      execute: async ({ characterId, outputDir, copyAssets }) => {
        const result = await exportCharacterToRuntime({
          runtime: { repository, storage: repository.storage },
          characterId,
          outputDir,
          copyAssets: copyAssets ?? true,
        });
        return {
          characterId: result.characterId,
          configPath: result.configPath,
          filesCopied: result.filesCopied.length,
          config: result.config,
        };
      },
    },
    {
      name: 'get_pipeline_status',
      description: 'Describe registered pipeline adapters.',
      inputSchema: objectSchema({}),
      execute: async () => ({ adapters: registry.describe(), adapterHealth: await registry.health() }),
    },
  ];

  return {
    list() {
      return tools.map(({ execute: _execute, ...tool }) => tool);
    },
    openAiTools() {
      return tools.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      }));
    },
    async invoke(name, input = {}) {
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) {
        const error = new Error(`Unknown CMS tool: ${name}`);
        error.statusCode = 404;
        throw error;
      }
      return tool.execute(input);
    },
  };
}

function deepMerge(target, patch) {
  if (!isPlainObject(target) || !isPlainObject(patch)) return patch;

  const next = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    next[key] = isPlainObject(value) && isPlainObject(next[key])
      ? deepMerge(next[key], value)
      : value;
  }
  return next;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function withAssetApiUrl(result) {
  if (!result.asset) return result;
  return {
    ...result,
    asset: {
      ...result.asset,
      apiUrl: assetApiUrl(result.asset.key),
    },
  };
}

function objectSchema(properties, required = []) {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required,
  };
}

function stringSchema(description) {
  return {
    type: 'string',
    description,
  };
}

function numberSchema(description) {
  return {
    type: 'number',
    description,
  };
}

function extForContentType(contentType) {
  if (contentType === 'audio/mpeg') return '.mp3';
  if (contentType === 'audio/ogg') return '.ogg';
  return '.wav';
}
