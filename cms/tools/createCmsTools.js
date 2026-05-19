import { assetApiUrl, writeCharacterAssetUpload } from '../assets/uploadCharacterAsset.js';

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
      execute: async (input) => ({ draft: await pipeline.createCharacterDraft(input) }),
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
      execute: async ({ characterId, prompt }) => {
        const result = await pipeline.generateSpriteSheet({
          characterId,
          prompt,
          targetPath: `source/${characterId}_imagegen_sheet.svg`,
        });
        return withAssetApiUrl(result);
      },
    },
    {
      name: 'normalize_sprite_pack',
      description: 'Normalize a generated sprite sheet into a fighter pack.',
      inputSchema: objectSchema({
        characterId: stringSchema('Character id.'),
        sourceAssetKey: stringSchema('Storage key of the generated source sheet.'),
      }, ['characterId', 'sourceAssetKey']),
      execute: async (input) => ({ normalized: await pipeline.normalizeSpritePack(input) }),
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
