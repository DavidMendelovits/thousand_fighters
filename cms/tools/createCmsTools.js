import { assetApiUrl, writeCharacterAssetUpload } from '../assets/uploadCharacterAsset.js';
import { exportCharacterToRuntime } from '../export/exportCharacterToRuntime.js';
import { SHEET_IDS } from '../../shared/animationRows.js';
import { validateCombos } from '../export/convertDraftToCharacterConfig.js';

// Row ids an agent can generate, sourced from the registry so the tool schema
// can't drift from the engine's row set (T20/T21).
const ROW_ID_LIST = SHEET_IDS.join(', ');

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
      description: `Generate a sprite sheet for a single row (${ROW_ID_LIST}). Generate the base row FIRST: it is automatically attached as a reference image to every other row so the fighter stays visually consistent. Each row has canonical frame roles (e.g. attacks: 1-2 startup, 3 reaching/extending, 4 moment of contact / full extension, 5 follow-through, 6 recovery; state rows like crouch/block/jump end on the held pose) — author visualTimeline and hitbox keyframes against these roles.`,
      inputSchema: objectSchema({
        characterId: stringSchema('Character id.'),
        prompt: stringSchema('Sprite generation prompt.'),
        moveId: stringSchema(`Row id (one of: ${ROW_ID_LIST}). Defaults to base.`),
        spriteProfile: stringSchema('Sprite profile: standard (1x6 row) or wide (2x3 grid with ~2x wider cells, for long-reach extending-limb moves). Defaults to standard.'),
        referenceAssetKeys: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional storage keys of reference images. Defaults to the concept art for the base row, and to the base sheet plus concept art for every other row.',
        },
      }, ['characterId', 'prompt']),
      execute: async ({ characterId, prompt, moveId, spriteProfile, referenceAssetKeys, context }) => {
        const result = await pipeline.generateSpriteSheet({
          characterId,
          prompt,
          moveId: moveId || undefined,
          spriteProfile: spriteProfile || undefined,
          referenceAssetKeys: referenceAssetKeys ?? [],
          context: context ?? {},
        });
        return withAssetApiUrl(result);
      },
    },
    {
      name: 'define_combo',
      description: 'Define (or replace) a combo on the draft: an ordered list of existing move ids that chain. Convert wires each move to cancelInto the next, so the chain is playable once the moves have cancellable phases (author the cancel windows separately). Validates that every segment is an existing move and the combo has >= 2 segments — fails loudly on a bad reference.',
      inputSchema: objectSchema({
        characterId: stringSchema('Character id.'),
        comboId: stringSchema('Combo id (stable key; re-defining the same id replaces it).'),
        displayName: stringSchema('Optional human-readable combo name.'),
        segments: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ordered move ids that make up the combo (>= 2). Each must be an existing draft move id.',
        },
      }, ['characterId', 'comboId', 'segments']),
      execute: async ({ characterId, comboId, displayName, segments }) => {
        const current = await repository.getDraft(characterId);
        const moveIds = (current.moves ?? []).map((move) => move.id);
        const combo = { id: comboId, segments: segments ?? [], ...(displayName ? { displayName } : {}) };
        const others = (current.combos ?? []).filter((existing) => existing.id !== comboId);
        const combos = [...others, combo];
        const errors = validateCombos(combos, moveIds);
        if (errors.length) {
          throw new Error(`define_combo rejected: ${errors.join('; ')}`);
        }
        await repository.saveDraft(characterId, { ...current, combos }, {
          provider: 'cms-tool',
          adapterId: 'define-combo',
        });
        return { comboId, segments: combo.segments, combos };
      },
    },
    {
      name: 'generate_combo',
      description: 'Generate the rows of a combo SEQUENTIALLY so the poses overlap: each segment after the first carries the prior segment\'s sheet as a reference and is prompted to begin from its final pose. Generate the base row first (it anchors identity). This is soft pose continuity — a visual nudge, not a pixel-exact frame match.',
      inputSchema: objectSchema({
        characterId: stringSchema('Character id.'),
        basePrompt: stringSchema('Fallback generation prompt applied to segments without their own prompt.'),
        segments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              moveId: { type: 'string', description: 'Row id to generate for this segment.' },
              prompt: { type: 'string', description: 'Optional per-segment prompt.' },
              spriteProfile: { type: 'string', description: 'Optional: standard or wide.' },
            },
            required: ['moveId'],
          },
          description: 'Ordered combo segments (>= 2), generated in sequence.',
        },
      }, ['characterId', 'segments']),
      execute: async ({ characterId, basePrompt, segments, context }) => {
        const result = await pipeline.generateComboSequence({
          characterId,
          segments: segments ?? [],
          basePrompt: basePrompt || undefined,
          context: context ?? {},
        });
        return { segments: result.segments.map((segment) => withAssetApiUrl(segment)) };
      },
    },
    {
      name: 'extract_row_frames',
      description: 'Extract individual frames from a generated 1x6 sprite row sheet. Detects character bounding boxes against the magenta background.',
      inputSchema: objectSchema({
        characterId: stringSchema('Character id.'),
        sourceAssetKey: stringSchema('CMS key of the source row sheet to extract from.'),
        moveId: stringSchema(`Row id (one of: ${ROW_ID_LIST}).`),
        spriteProfile: stringSchema('Sprite profile used at generation time: standard (1x6 row) or wide (2x3 grid). Defaults to standard.'),
      }, ['characterId', 'sourceAssetKey', 'moveId']),
      execute: async ({ characterId, sourceAssetKey, moveId, spriteProfile }) => {
        return pipeline.extractRowFrames({ characterId, sourceAssetKey, moveId, spriteProfile: spriteProfile || undefined });
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
      name: 'save_gym_edits',
      description: 'Persist Character Gym edits across two stores in one call (A2/A3). Half 1: the full frameData.json (per-frame anchors + the gym\'s anchor-relative collision boxes) to the asset store. Half 2: the draft `overrides` block (per-state hurtbox + per-move/per-id hitbox geometry, frame-px anchor-relative) and authored hitbox numbers to the draft. Set/unset semantics: `overrides` REPLACES draft.overrides wholesale, so a key removed by reset-to-measured is actually deleted (deepMerge cannot delete); `hitboxNumbers` patches matching hitbox_active events in place, so a single-field edit never re-sends or clobbers the moves array. Writes frameData first, then the draft, and returns a per-half result {frameData, draft} so a partial failure is reported honestly and the gym can stay dirty for the half that did not persist.',
      inputSchema: objectSchema({
        characterId: stringSchema('Character id.'),
        frameData: {
          type: 'object',
          description: 'Full frameData object to write — replaces frameData.json wholesale. Omit to leave frames untouched.',
          additionalProperties: true,
        },
        overrides: {
          type: 'object',
          description: 'Full resolved draft.overrides block ({ hurtboxes, hitboxes }) in frame-px anchor-relative space — REPLACES draft.overrides wholesale, so removing a key here unsets that override. Omit to leave overrides untouched.',
          additionalProperties: true,
        },
        hitboxNumbers: {
          type: 'array',
          description: 'Targeted in-place patches to authored hitbox numbers (damage/hitstun/blockstun/knockbackX/knockbackY/level) on draft hitbox_active events. Each item: { moveId, hitboxId?, ...fields }. Matched by moveId + (event.id ?? "default").',
          items: { type: 'object', additionalProperties: true },
        },
      }, ['characterId']),
      execute: async ({ characterId, frameData, overrides, hitboxNumbers }) => {
        const result = { ok: true };

        // --- Half 1: frameData → asset store (written first, per save order A2/A3) ---
        if (frameData !== undefined) {
          try {
            const keys = await repository.listCharacterAssets(characterId);
            const prefix = `characters/${repository.safeCharacterId(characterId)}/assets/`;
            const key = keys.find((candidate) => candidate.endsWith('frameData.json'));
            if (!key) throw new Error(`No frameData.json asset to update for ${characterId}`);
            const relativePath = key.startsWith(prefix) ? key.slice(prefix.length) : key;
            const json = `${JSON.stringify(frameData, null, 2)}\n`;
            const asset = await writeCharacterAssetUpload({
              repository,
              storage: repository.storage,
              characterId,
              input: {
                relativePath,
                contentBase64: Buffer.from(json, 'utf8').toString('base64'),
                contentType: 'application/json',
              },
              source: 'character-gym',
            });
            result.frameData = { status: 'saved', key: asset.key, relativePath };
          } catch (error) {
            result.ok = false;
            result.frameData = { status: 'error', error: error.message };
          }
        }

        // --- Half 2: draft overrides + hitbox numbers → draft store ---
        const hasNumberPatches = Array.isArray(hitboxNumbers) && hitboxNumbers.length > 0;
        if (overrides !== undefined || hasNumberPatches) {
          try {
            const draft = await repository.getDraft(characterId);
            if (!draft) throw new Error(`No draft to update for ${characterId}`);
            if (overrides !== undefined) {
              draft.overrides = sanitizeOverrides(overrides);
            }
            let patchedEvents = 0;
            for (const patch of hitboxNumbers ?? []) {
              patchedEvents += applyHitboxNumberPatch(draft, patch);
            }
            await repository.saveDraft(characterId, draft, { source: 'character-gym' });
            result.draft = { status: 'saved', patchedEvents };
          } catch (error) {
            result.ok = false;
            result.draft = { status: 'error', error: error.message };
          }
        }

        return result;
      },
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

/**
 * Coerce a gym-supplied overrides block to the { hurtboxes, hitboxes } shape the
 * convert pipeline reads. The gym sends the FULL resolved block each save, so
 * this wholesale-replaces draft.overrides — a key the gym dropped (reset to
 * measured) is simply absent here, which is how unset/delete works without
 * deepMerge (deepMerge cannot delete keys).
 */
function sanitizeOverrides(overrides) {
  if (!isPlainObject(overrides)) return { hurtboxes: {}, hitboxes: {}, guardboxes: {} };
  return {
    hurtboxes: isPlainObject(overrides.hurtboxes) ? overrides.hurtboxes : {},
    hitboxes: isPlainObject(overrides.hitboxes) ? overrides.hitboxes : {},
    guardboxes: isPlainObject(overrides.guardboxes) ? overrides.guardboxes : {},
  };
}

/**
 * Patch authored hitbox numbers on the draft's hitbox_active events in place,
 * matched by moveId + (event.id ?? 'default'). Patches only the provided fields
 * and PRESERVES the draft's existing knockback shape (flat knockbackX/Y vs
 * nested knockback:{x,y}) so convert doesn't see two competing representations.
 *
 * @returns {number} count of events patched
 */
function applyHitboxNumberPatch(draft, patch) {
  if (!isPlainObject(patch) || !patch.moveId) return 0;
  const move = (draft.moves ?? []).find((candidate) => candidate.id === patch.moveId);
  if (!move) return 0;
  const wantId = patch.hitboxId ?? 'default';
  let count = 0;
  for (const phase of move.phases ?? []) {
    for (const entry of phase.events ?? []) {
      const event = entry.event ?? entry;
      if (!event || !event.hitbox) continue;
      if (event.type !== 'hitbox_active' && event.type !== 'hitbox') continue;
      if ((event.id ?? 'default') !== wantId) continue;
      patchHitboxFields(event.hitbox, patch);
      count += 1;
    }
  }
  return count;
}

function patchHitboxFields(hitbox, patch) {
  for (const field of ['damage', 'hitstun', 'blockstun', 'level']) {
    if (patch[field] !== undefined) hitbox[field] = patch[field];
  }
  // Write a single knockback representation per axis. If only the nested
  // `knockback:{x,y}` shape exists, patch it; otherwise write the flat field
  // (which convert reads first: `knockbackX ?? knockback?.x`) AND clear the
  // nested coordinate so a malformed both-shapes event can't leave a stale value
  // that convert would prefer over the patch (codex P2).
  if (patch.knockbackX !== undefined) {
    if (isPlainObject(hitbox.knockback) && hitbox.knockbackX === undefined) {
      hitbox.knockback.x = patch.knockbackX;
    } else {
      hitbox.knockbackX = patch.knockbackX;
      if (isPlainObject(hitbox.knockback)) delete hitbox.knockback.x;
    }
  }
  if (patch.knockbackY !== undefined) {
    if (isPlainObject(hitbox.knockback) && hitbox.knockbackY === undefined) {
      hitbox.knockback.y = patch.knockbackY;
    } else {
      hitbox.knockbackY = patch.knockbackY;
      if (isPlainObject(hitbox.knockback)) delete hitbox.knockback.y;
    }
  }
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
