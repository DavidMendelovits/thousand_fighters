import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, readdir, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { PipelinePort } from './ports.js';
import { normalizeManifest } from './manifestSchema.js';
import { mergePreservedAnchorFrames } from './preserveTunedAnchors.js';
import {
  validateCombos,
  validateProjectiles,
  validateProjectileReferences,
  normalizeInputToken,
} from '../export/convertDraftToCharacterConfig.js';
import { MOVE_SHEET_IDS } from '../../shared/animationRows.js';

// Canonical inputs the engine's InputBuffer can actually match. A combo move
// authored with anything else (a motion shorthand like "qcf", or an empty
// sequence) gets cancel wiring but never fires — we warn, not crash.
const CANONICAL_INPUT_TOKENS = new Set([
  'up', 'down', 'forward', 'back',
  'down-forward', 'down-back', 'up-forward', 'up-back',
  'lp', 'mp', 'hp', 'lk', 'mk', 'hk', 'neutral',
]);

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

    const moves = result.value?.moves ?? [];
    // Combos + projectiles are generated alongside moves (T-move-kit). They were
    // dropped here before — copy them through, but self-heal first so a model
    // slip (an unknown combo segment, a malformed projectile, a spawn event
    // pointing at a projectile it forgot to define) can't poison the draft.
    const { combos, projectiles, warnings } = healGeneratedKit({
      characterId,
      moves,
      combos: result.value?.combos ?? [],
      projectiles: result.value?.projectiles ?? [],
    });

    const content = {
      schemaVersion,
      id: characterId,
      displayName: result.value?.displayName ?? characterId,
      description: result.value?.description ?? brief,
      stats: result.value?.stats ?? {},
      sprite: result.value?.sprite ?? {},
      moves,
      combos,
      projectiles,
      generation: {
        provider: result.provider ?? textModel.provider ?? 'unknown',
        adapterId: textModel.id ?? 'textModel',
        createdAt: this.clock().toISOString(),
        promptRef: result.promptRef ?? null,
        warnings,
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

  async generateSpriteSheet({ characterId, prompt, moveId, spriteProfile, referenceAssetKeys = [], extraReferenceAssetKeys = [], targetPath, context = {} }) {
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
    // Continuity / supplemental references appended AFTER the identity refs (vs
    // replacing them like explicit referenceAssetKeys do) — combo segments use
    // this to carry the prior segment's sheet for pose overlap (T22). Deduped.
    if (extraReferenceAssetKeys.length) {
      referenceKeys = [...new Set([...referenceKeys, ...extraReferenceAssetKeys])];
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

  /**
   * Generate the rows of a combo SEQUENTIALLY (T22). Each segment after the
   * first carries the prior segment's source sheet as an extra reference, and
   * is prompted to begin from that strip's final cell, so the chain's poses
   * overlap.
   *
   * This is SOFT pose continuity — reference-conditioning is a nudge, not a
   * pixel-exact `start[K+1] == end[K]` guarantee (hard continuity would be a
   * frame-copy operation, a different mechanism). The threading is what's
   * deterministic and testable; visual alignment is model-dependent.
   *
   * @param {object} args
   * @param {string} args.characterId
   * @param {Array<{ moveId: string, prompt?: string, spriteProfile?: string }>} args.segments
   *   Ordered combo segments. Each moveId is generated as its own row.
   * @param {string} [args.basePrompt]  Fallback prompt for segments without one.
   * @param {object} [args.context]
   * @returns {Promise<{ segments: object[] }>}
   */
  async generateComboSequence({ characterId, segments, basePrompt, context = {} }) {
    if (!Array.isArray(segments) || segments.length < 2) {
      throw new Error('generateComboSequence: a combo needs at least 2 segments');
    }
    const results = [];
    let priorSheetKey = null;
    for (const segment of segments) {
      const moveId = segment?.moveId;
      if (!moveId) throw new Error('generateComboSequence: every segment needs a moveId');
      const continuityNote = priorSheetKey
        ? ' Pose continuity: begin frame 1 from the pose in the FINAL cell of the attached reference strip, so this move flows out of the previous move in the combo.'
        : '';
      const result = await this.generateSpriteSheet({
        characterId,
        prompt: `${segment.prompt ?? basePrompt ?? ''}${continuityNote}`,
        moveId,
        spriteProfile: segment.spriteProfile,
        extraReferenceAssetKeys: priorSheetKey ? [priorSheetKey] : [],
        context,
      });
      results.push({ moveId, ...result });
      // The sheet just written becomes the continuity reference for the next
      // segment (its final cell is the end pose).
      priorSheetKey = result.asset.key;
    }
    return { segments: results };
  }

  /**
   * Author a combo from intent: each segment is either an EXISTING move id or a
   * NEW move described in words. New segments are authored by the text model
   * (phases, hitbox numbers, a chainable input), the server assigns each a sprite
   * row, the combo descriptor stitches them (convert derives the cancel graph),
   * and — best effort — the new rows' sprites are generated in-flow.
   *
   * Row budget is the hard constraint: there are only 6 move-animation rows, and
   * generating onto a row OVERWRITES whatever animates there. So the server (not
   * the model) assigns rows, preferring rows no kept move uses, and NEVER
   * regenerates a row an existing move depends on — overflow shares an
   * already-generated row instead. The 6-row ceiling is surfaced in warnings.
   *
   * The draft (new moves + combo descriptor) is persisted in ONE write, then
   * sprites are generated as a follow-on that warns on failure but never rolls
   * back the authored combo.
   *
   * @param {object} args
   * @param {string} args.characterId
   * @param {string} args.comboId
   * @param {string} [args.comboDisplayName]
   * @param {Array<{ moveId?: string, description?: string, displayName?: string }>} args.segments
   *   Ordered. `moveId` references an existing move; otherwise `description` creates one.
   * @param {boolean} [args.generateSprites=true]
   * @param {object} [args.context]
   */
  async authorCombo({ characterId, comboId, comboDisplayName, segments, generateSprites = true, context = {} }) {
    if (!comboId) throw new Error('authorCombo: comboId is required');
    if (!Array.isArray(segments) || segments.length < 2) {
      throw new Error('authorCombo: a combo needs at least 2 segments');
    }
    const textModel = this.registry.resolve(PipelinePort.TEXT_MODEL);
    const repository = this.registry.resolve(PipelinePort.CHARACTER_REPOSITORY);
    const draft = await repository.getDraft(characterId);
    if (!draft) throw new Error(`authorCombo: no draft found for "${characterId}"`);

    const warnings = [];
    const existingMoves = draft.moves ?? [];
    const existingIds = new Set(existingMoves.map((move) => move.id));

    // Validate existing-id segments up front.
    for (const seg of segments) {
      if (seg.moveId && !existingIds.has(seg.moveId)) {
        throw new Error(`authorCombo: segment references unknown move "${seg.moveId}"`);
      }
    }

    // --- Row assignment (server-side, collision-aware) -----------------------
    // Rows any KEPT move animates on are off-limits for regeneration.
    const keptRows = new Set(existingMoves.map((move) => move.animation).filter(Boolean));
    const freeRows = MOVE_SHEET_IDS.filter((row) => !keptRows.has(row));
    const createSegs = segments
      .map((seg, index) => ({ seg, index }))
      .filter(({ seg }) => !seg.moveId);

    let freeCursor = 0;
    let lastFreeRow = null;
    const assignments = createSegs.map(({ seg, index }) => {
      let animation;
      let willGenerate;
      if (freeCursor < freeRows.length) {
        animation = freeRows[freeCursor++];
        lastFreeRow = animation;
        willGenerate = true;
      } else if (lastFreeRow) {
        // Out of distinct free rows: share an already-claimed free row (its sprite
        // is generated once by the first claimant). Don't regenerate.
        animation = lastFreeRow;
        willGenerate = false;
        warnings.push(`combo "${comboId}" has more new moves than free animation rows — "${seg.description ?? `segment ${index + 1}`}" shares row "${animation}" (no distinct sprite). Only 6 move rows exist.`);
      } else {
        // No free rows at all: reuse an owned row WITHOUT regenerating, so we
        // never clobber an existing move's sprites. It will look like that move.
        animation = MOVE_SHEET_IDS[0];
        willGenerate = false;
        warnings.push(`combo "${comboId}": no free animation rows — "${seg.description ?? `segment ${index + 1}`}" reuses "${animation}" and will look like the existing move on that row.`);
      }
      return { seg, index, animation, willGenerate };
    });

    // --- Author the new moves via the text model -----------------------------
    let authoredMoves = [];
    if (assignments.length) {
      const authoring = await textModel.completeStructured({
        task: 'combo-authoring',
        schemaName: 'ComboMoves',
        schemaVersion: 1,
        input: {
          comboId,
          characterId,
          segments: assignments.map((a) => ({
            description: a.seg.description ?? '',
            displayName: a.seg.displayName,
            animation: a.animation,
          })),
          existingMoves: existingMoves.map((move) => ({ id: move.id, sequence: move.trigger?.sequence ?? [] })),
        },
        onProgress: context.onProgress,
      });
      authoredMoves = authoring.value?.moves ?? [];
    }

    // Map authored moves onto assignments; the server owns `animation`. Guarantee
    // unique ids (don't silently replace an existing move) and fall back to a
    // minimal move if the model returned too few.
    const usedIds = new Set(existingIds);
    const createdMoves = assignments.map((a, idx) => {
      const authored = authoredMoves[idx] ?? {};
      const baseId = authored.id || slugifyMoveId(a.seg.displayName ?? a.seg.description ?? `${comboId}_${idx + 1}`);
      const id = uniqueId(baseId, usedIds);
      usedIds.add(id);
      // Follow-ups (any segment after the first) are CANCEL-ONLY: allowedStates
      // is just 'attack', so they can't be done from neutral — they're reachable
      // only through the combo. That keeps the dynamism (a hidden follow-up, not
      // another move on the button). The first segment stays neutral-accessible
      // so the combo has a real starter. (existing-move segments are untouched.)
      const isFollowUp = a.index > 0;
      const trigger = { sequence: Array.isArray(authored.trigger?.sequence) ? authored.trigger.sequence : ['lp'] };
      if (isFollowUp) trigger.allowedStates = ['attack'];
      const move = {
        id,
        displayName: authored.displayName ?? a.seg.displayName ?? id,
        description: authored.description ?? a.seg.description ?? '',
        animation: a.animation,
        trigger,
        phases: Array.isArray(authored.phases) && authored.phases.length ? authored.phases : defaultComboPhases(idx),
      };
      a.createdId = id;
      return move;
    });

    // Validate inputs: non-empty, canonical, distinct among created siblings.
    const seenSequences = new Set();
    for (const move of createdMoves) {
      const normalized = (move.trigger.sequence ?? []).map((token) => normalizeInputToken(token));
      if (!normalized.length) {
        warnings.push(`move "${move.id}" has an empty input — it can't be triggered/chained.`);
      }
      const nonCanonical = normalized.filter((token) => !CANONICAL_INPUT_TOKENS.has(token));
      if (nonCanonical.length) {
        warnings.push(`move "${move.id}" uses non-canonical input(s) [${nonCanonical.join(', ')}] that won't match — use lp/mp/hp/lk/mk/hk + directions.`);
      }
      const key = normalized.join('+');
      if (seenSequences.has(key)) {
        warnings.push(`move "${move.id}" shares input "${key}" with another combo move — they may be ambiguous to chain.`);
      }
      seenSequences.add(key);
    }

    // --- Single draft write: merge moves + combo descriptor ------------------
    const createdIdByIndex = new Map(assignments.map((a) => [a.index, a.createdId]));
    const orderedIds = segments.map((seg, i) => (seg.moveId ? seg.moveId : createdIdByIndex.get(i)));
    const createdIds = new Set(createdMoves.map((move) => move.id));
    const mergedMoves = [...existingMoves.filter((move) => !createdIds.has(move.id)), ...createdMoves];
    const combo = { id: comboId, segments: orderedIds, ...(comboDisplayName ? { displayName: comboDisplayName } : {}) };
    const combos = [...(draft.combos ?? []).filter((existing) => existing.id !== comboId), combo];
    const comboErrors = validateCombos(combos, mergedMoves.map((move) => move.id));
    if (comboErrors.length) throw new Error(`authorCombo rejected: ${comboErrors.join('; ')}`);

    await repository.saveDraft(characterId, { ...draft, moves: mergedMoves, combos }, {
      provider: 'cms-tool',
      adapterId: 'author-combo',
    });

    // --- Best-effort sprite generation (warns, never rolls back) -------------
    let spriteResults = [];
    if (generateSprites) {
      // One generation per distinct free row, in order, prompted by its description.
      const genByRow = new Map();
      for (const a of assignments) {
        if (a.willGenerate && !genByRow.has(a.animation)) {
          genByRow.set(a.animation, a.seg.description ?? '');
        }
      }
      const genSegments = [...genByRow.entries()].map(([row, description]) => ({
        moveId: row,
        prompt: [draft.description ?? '', description, 'Side-view fighting-game sprite row, magenta background, full body, generous gutters.'].filter(Boolean).join(' '),
      }));
      try {
        if (genSegments.length >= 2) {
          const result = await this.generateComboSequence({ characterId, segments: genSegments, context });
          spriteResults = result.segments;
        } else if (genSegments.length === 1) {
          const single = await this.generateSpriteSheet({ characterId, prompt: genSegments[0].prompt, moveId: genSegments[0].moveId, context });
          spriteResults = [{ moveId: genSegments[0].moveId, ...single }];
        }
      } catch (error) {
        warnings.push(`combo saved, but sprite generation failed: ${error.message}`);
      }
    }

    return { comboId, combo, createdMoves, spriteResults, warnings };
  }

  /**
   * Generate a projectile sprite AND upsert its first-class entity on the draft
   * (T23). The generated image is stored as the projectile's source asset; the
   * draft.projectiles entity carries the runtime numbers (geometry, velocity,
   * lifetime, hitbox) so it can be edited like a move in the gym, and convert
   * resolves spawn_projectile references against it.
   *
   * Re-generating an existing projectile id replaces the SPRITE but PRESERVES
   * authored numbers (only the sprite changes), so gym tuning isn't clobbered.
   *
   * @param {object} args
   * @param {string} args.characterId
   * @param {string} args.projectileId
   * @param {string} args.prompt
   * @param {string[]} [args.referenceAssetKeys]
   * @param {object} [args.context]
   * @returns {Promise<{ asset: object, projectile: object }>}
   */
  async generateProjectile({ characterId, projectileId, prompt, referenceAssetKeys = [], context = {} }) {
    if (!projectileId) throw new Error('generateProjectile: projectileId is required');
    const imageGenerator = this.registry.resolve(PipelinePort.IMAGE_GENERATOR);
    const repository = this.registry.resolve(PipelinePort.CHARACTER_REPOSITORY);
    const storage = this.registry.resolve(PipelinePort.ASSET_STORAGE);

    // Identity references keep the projectile on-theme with the fighter.
    let referenceKeys = referenceAssetKeys;
    if (!referenceKeys.length) {
      referenceKeys = [
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
      task: 'projectile-sprite',
      prompt,
      moveId: projectileId,
      projectileId,
      referenceAssetKeys: referenceKeys,
      referenceImages,
      context,
      onProgress: context.onProgress,
    });

    const contentType = result.contentType ?? 'image/png';
    const key = `source/${characterId}_${projectileId}_projectile${extensionForContentType(contentType)}`;
    const asset = await repository.writeAsset(characterId, key, bytesFromImageResult(result), {
      contentType,
      provider: result.provider ?? imageGenerator.provider ?? 'unknown',
      adapterId: imageGenerator.id ?? 'imageGenerator',
      model: result.model ?? null,
      prompt,
    });

    // Upsert the entity. Animation is the runtime texture key the engine renders.
    const animation = `${characterId}_${projectileId}`;
    const draft = await repository.getDraft(characterId);
    const existing = (draft.projectiles ?? []).find((entity) => entity.id === projectileId);
    const projectile = existing
      ? { ...existing, animation, sourceKey: asset.key }
      : {
          id: projectileId,
          animation,
          sourceKey: asset.key,
          width: 48,
          height: 32,
          speed: 7,
          velocity: { x: 7, y: 0, relativeToFacing: true },
          lifetime: 110,
          hitbox: { x: -24, y: -16, width: 48, height: 32, damage: 60, hitstun: 18, blockstun: 12, knockback: { x: 4, y: 0 }, level: 'mid' },
        };
    const projectiles = [...(draft.projectiles ?? []).filter((entity) => entity.id !== projectileId), projectile];
    await repository.saveDraft(characterId, { ...draft, projectiles }, {
      provider: 'cms-tool',
      adapterId: 'generate-projectile',
    });

    return { asset, projectile };
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

      // Merge this move's frames into the pack frameData. Preserve hand-tuned
      // anchors from the Character Gym (frame.anchorEdited) instead of clobbering
      // them with freshly-measured ones — but only while the frame dimensions
      // still match (same art). If the art changed size the manual anchor no
      // longer maps, so take the fresh one and warn (A6/T5).
      const frameDataKey = `${packRoot}/frameData.json`;
      let frameData = await storage.getJson(frameDataKey).catch(() => null);
      if (!frameData?.frames || typeof frameData.frames !== 'object') {
        frameData = {
          anchorConvention: 'frame anchor is the character pivot/feet, in pixels from each PNG top-left',
          frames: {},
        };
      }
      frameData.frames[moveId] = mergePreservedAnchorFrames(
        frameData.frames[moveId],
        fragment,
        (warning) => { report.warnings = (report.warnings ?? []).concat(warning); },
      );
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

/**
 * Self-heal the combos + projectiles a text model generates alongside moves
 * (T-move-kit), reusing the canonical convert-layer validators so "valid" has a
 * single definition. Derives each projectile's runtime texture key (`animation`
 * = `<characterId>_<id>` — the model never authors it; `sourceKey` is attached
 * later when the sprite is generated), drops malformed/duplicate entities and
 * combos that reference unknown moves, and WARNS (without dropping) on spawn
 * events pointing at a projectile that doesn't exist.
 *
 * @returns {{ combos: object[], projectiles: object[], warnings: string[] }}
 */
function healGeneratedKit({ characterId, moves, combos, projectiles }) {
  const warnings = [];
  const moveIds = (moves ?? []).map((move) => move?.id).filter(Boolean);

  const seenProjectileIds = new Set();
  const validProjectiles = [];
  for (const entity of projectiles ?? []) {
    if (!entity || typeof entity.id !== 'string') {
      warnings.push('dropped a projectile entity with no id');
      continue;
    }
    if (seenProjectileIds.has(entity.id)) {
      warnings.push(`dropped duplicate projectile "${entity.id}"`);
      continue;
    }
    const healed = { ...entity, animation: entity.animation ?? `${characterId}_${entity.id}` };
    const errors = validateProjectiles([healed]);
    if (errors.length) {
      warnings.push(`dropped projectile "${entity.id}": ${errors.join('; ')}`);
      continue;
    }
    seenProjectileIds.add(entity.id);
    validProjectiles.push(healed);
  }

  const seenComboIds = new Set();
  const validCombos = [];
  for (const combo of combos ?? []) {
    if (combo?.id && seenComboIds.has(combo.id)) {
      warnings.push(`dropped duplicate combo "${combo.id}"`);
      continue;
    }
    const errors = validateCombos([combo], moveIds);
    if (errors.length) {
      warnings.push(`dropped combo "${combo?.id ?? '(unnamed)'}": ${errors.join('; ')}`);
      continue;
    }
    if (combo?.id) seenComboIds.add(combo.id);
    validCombos.push(combo);
  }

  for (const warning of validateProjectileReferences({ moves, projectiles: validProjectiles })) {
    warnings.push(warning);
  }

  // A combo follow-up needs a non-empty input sequence to cancel into — an empty
  // sequence never matches the input buffer, so the combo is wired but dead.
  const movesById = new Map((moves ?? []).map((move) => [move?.id, move]));
  const flaggedEmpty = new Set();
  for (const combo of validCombos) {
    for (const segmentId of combo.segments ?? []) {
      const move = movesById.get(segmentId);
      const sequence = move?.trigger?.sequence;
      if (move && (!Array.isArray(sequence) || sequence.length === 0) && !flaggedEmpty.has(segmentId)) {
        flaggedEmpty.add(segmentId);
        warnings.push(`move "${segmentId}" (in combo "${combo.id}") has an empty input sequence — the combo is wired but won't fire until it has a trigger`);
      }
    }
  }

  return { combos: validCombos, projectiles: validProjectiles, warnings };
}

function slugifyMoveId(text) {
  const slug = String(text ?? 'move').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return slug || 'move';
}

function uniqueId(baseId, used) {
  if (!used.has(baseId)) return baseId;
  let n = 2;
  while (used.has(`${baseId}_${n}`)) n += 1;
  return `${baseId}_${n}`;
}

// Minimal startup/active(hitbox)/recovery fallback for a combo move when the
// model returns too few moves. Escalates lightly by position. The recovery phase
// is what makes the move cancellable into the next combo link.
function defaultComboPhases(index = 0) {
  return [
    { name: 'startup', frames: 4, events: [] },
    {
      name: 'active',
      frames: 3,
      events: [
        { frame: 0, event: { type: 'hitbox_active', hitbox: { x: 32, y: -100, width: 60, height: 40, damage: 40 + index * 15, hitstun: 14 + index * 2, blockstun: 8, knockback: { x: 3 + index, y: index >= 2 ? -4 : 0 } } } },
        { frame: 2, event: { type: 'hitbox_end' } },
      ],
    },
    { name: 'recovery', frames: 8 + index * 2, events: [] },
  ];
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
