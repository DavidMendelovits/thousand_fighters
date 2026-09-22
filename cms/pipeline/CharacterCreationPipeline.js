import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, readdir, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { digest } from '../storage/LineageStore.js';
import { currentConceptAssetKey } from '../authoring/referenceArt.js';
import {assertPublishReadiness} from '../authoring/publishReadiness.js';
import {loadReviewContext,packFingerprint} from './reviewFingerprint.js';
import {withMotionReviewFeedback} from '../../shared/motionReviewFeedback.js';

import { PipelinePort } from './ports.js';
import { normalizeManifest } from './manifestSchema.js';
import { mergePreservedAnchorFrames } from './preserveTunedAnchors.js';
import {
  validateCombos,
  validateProjectiles,
  validateProjectileReferences,
  normalizeInputToken,
} from '../export/convertDraftToCharacterConfig.js';
import { rowPromptProfile } from './rowPromptProfiles.js';
import { assertMotionCoverage } from './motionRowArtifacts.js';
import { projectileImpact } from '../../shared/projectileImpact.js';
import {generateWorkbenchVideoRow} from './adapters/workbenchVideoRow.js';
import {normalizeGeneratedMoves} from './adapters/advancedMoveSchema.js';
import {validateCombatRules} from '../export/validateCombatRules.js';
import {composeSpriteSheetWithFfmpeg} from './adapters/minimaxH3SpriteSheetGeneratorAdapter.js';

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
const NORMALIZE_PROJECTILE_SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'normalize_projectile.py');

async function normalizeProjectileBytes(rawBytes) {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'tf-proj-norm-'));
  try {
    const rawPath = path.join(tmpDir, 'raw.png');
    const normPath = path.join(tmpDir, 'norm.png');
    await writeFile(rawPath, rawBytes);
    await execFileAsync('python3', [NORMALIZE_PROJECTILE_SCRIPT_PATH, rawPath, normPath], {
      timeout: 30_000, maxBuffer: 10 * 1024 * 1024,
    });
    return await readFile(normPath);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

export class CharacterCreationPipeline {
  constructor(registry, options = {}) {
    this.registry = registry;
    this.clock = options.clock ?? (() => new Date());
    this.extractionQueues = new Map();
  }

  async createCharacterDraft({ characterId, brief, artStyle='pixel', schemaVersion = 1, context = {} }) {
    if(!['pixel','paint','watercolor'].includes(artStyle))throw new Error('Unsupported character art style. Choose pixel, paint or watercolor.');
    const textModel = this.registry.resolve(PipelinePort.TEXT_MODEL);
    const repository = this.registry.resolve(PipelinePort.CHARACTER_REPOSITORY);
    const result = await textModel.completeStructured({
      task: 'character-content-draft',
      schemaName: 'CharacterContentDraft',
      schemaVersion,
      input: {
        characterId,
        brief,
        artStyle,
        context,
      },
      onProgress: context.onProgress,
    });

    const moves = normalizeGeneratedMoves(result.value?.moves ?? []);
    const actors = normalizeGeneratedMoves(result.value?.actors ?? []);
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
    applyGeneratedComboExclusivity(moves, combos, warnings);

    const content = {
      schemaVersion,
      id: characterId,
      displayName: result.value?.displayName ?? characterId,
      description: result.value?.description ?? brief,
      artBrief: result.value?.artBrief??result.value?.description??brief,
      artStyle,
      stats: result.value?.stats ?? {},
      sprite: result.value?.sprite ?? {},
      moves,
      requireMotionCoverage:true,
      ...(actors.length ? {actors} : {}),
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

    validateCombatRules(content);
    return repository.saveDraft(characterId, content, {
      provider: content.generation.provider,
      adapterId: content.generation.adapterId,
    });
  }

  async generateCharacterConcept({ characterId, prompt, context = {} }) {
    const imageGenerator = this.registry.resolve(PipelinePort.IMAGE_GENERATOR);
    const repository = this.registry.resolve(PipelinePort.CHARACTER_REPOSITORY);
    const storage = this.registry.resolve(PipelinePort.ASSET_STORAGE);
    const draft=await repository.getDraft(characterId);
    const result = await imageGenerator.generateImage({
      task: 'character-concept',
      prompt,
      context: { characterId, ...context, artStyle:context.artStyle??draft.artStyle },
      onProgress: context.onProgress,
      onGenerationAttempt: createGenerationAttemptRecorder(storage, context.onGenerationAttempt),
    });
    const bytes = result.bytes ? Buffer.from(result.bytes) : Buffer.from(result.base64 ?? '', 'base64');
    const contentType = result.contentType ?? 'image/png';
    const ext = contentType === 'image/svg+xml' ? '.svg' : contentType === 'image/webp' ? '.webp' : contentType === 'image/jpeg' ? '.jpg' : '.png';
    const asset = await repository.writeAsset(characterId, `concept/concept_art${ext}`, bytes, {
      contentType,
      provider: result.provider,
      model: result.model,
      prompt,
      referenceGeneratedAt: new Date().toISOString(),
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

  async generateSpriteSheet({ characterId, prompt, moveId, spriteProfile, generator = 'image', referenceAssetKeys = [], extraReferenceAssetKeys = [], targetPath, context = {} }) {
    const benchmarkStartedAt = Date.now();
    if(!['image','video','pruna-video'].includes(generator))throw new Error('Unknown row generator');
    const isVideoGenerator=generator!=='image';
    const imageGenerator = this.registry.resolve(PipelinePort.IMAGE_GENERATOR);
    const repository = this.registry.resolve(PipelinePort.CHARACTER_REPOSITORY);
    const storage = this.registry.resolve(PipelinePort.ASSET_STORAGE);
    const resolvedMoveId = moveId ?? 'base';
    // 'wide' renders the 6 frames as a 2x3 grid so each cell is ~2x wider —
    // for moves whose limb extends far laterally (tentacle grabs, whips).
    const resolvedProfile = spriteProfile === 'wide' ? 'wide' : 'standard';
    let characterDraft;
    try{characterDraft=await repository.getDraft(characterId);}
    catch(error){if(error.code!=='ENOENT')throw error;}
    const actorReference = !isVideoGenerator
      ? (characterDraft?.actors??[]).find(actor=>actor.idleAnimation===resolvedMoveId)
      : null;
    prompt=withMotionReviewFeedback(prompt,characterDraft,resolvedMoveId);
    const conceptKey = await currentConceptAssetKey(repository, characterId, storage);
    const referenceReview = characterDraft?.referenceReview;
    if (referenceReview?.status === 'rejected' && referenceReview.assetKey &&
        referenceReview.assetKey === conceptKey &&
        digest(await storage.getBytes(referenceReview.assetKey)) === referenceReview.sha256) {
      throw new Error('The current identity reference was rejected. Replace or explicitly approve it before generating new rows. Existing assets are unchanged.');
    }

    // Reference images keep all rows of one fighter visually consistent.
    // Explicit keys win; otherwise the base row anchors to the concept art,
    // and every other row anchors to the approved base row plus concept art.
    let referenceKeys = referenceAssetKeys;
    if (!referenceKeys.length) {
      // An independent summon needs an isolated identity. Feeding the full
      // fighter base to an image-to-image model tends to reproduce the fighter.
      referenceKeys = actorReference ? [] : (characterDraft?.artRevision || characterDraft?.history?.workingRoot) && characterDraft.assets?.rootKey
        ? [`${characterDraft.assets.rootKey}/sprites/base/base_001.png`]
        : resolvedMoveId === 'base'
        ? [conceptKey].filter(Boolean)
        : [
            `characters/${characterId}/assets/source/${characterId}_base_sheet.png`,
            conceptKey,
          ].filter(Boolean);
    }
    // Continuity / supplemental references appended AFTER the identity refs (vs
    // replacing them like explicit referenceAssetKeys do) — combo segments use
    // this to carry the prior segment's sheet for pose overlap (T22). Deduped.
    if (extraReferenceAssetKeys.length) {
      referenceKeys = [...new Set([...referenceKeys, ...extraReferenceAssetKeys])];
    }
    const referenceImages = [];
    const referenceLoadStartedAt = Date.now();
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
    const referenceLoadMs = Date.now() - referenceLoadStartedAt;
    const artStyle=context.artStyle??characterDraft?.artStyle;

    const request = {
      task: resolvedProfile === 'wide' ? 'fighter-2x3-grid' : 'fighter-1x6-row',
      prompt,
      moveId: resolvedMoveId,
      spriteProfile: resolvedProfile,
      referenceAssetKeys: referenceKeys,
      referenceImages,
      context: { characterId, ...context, artStyle, ...(actorReference?{actorReference:{id:actorReference.id,description:actorReference.description}}:{}) },
      onProgress: context.onProgress,
      onGenerationAttempt: createGenerationAttemptRecorder(storage, context.onGenerationAttempt),
    };
    const providerStartedAt = Date.now();
    const result = isVideoGenerator
      ? await generateWorkbenchVideoRow({characterId,moveId:resolvedMoveId,prompt,provider:generator==='pruna-video'?'pruna':'fal',task:request.task,storage,repository,referenceAssetKey:referenceAssetKeys[0],buildJobId:context.buildJobId,recoveryOnly:context.recoveryOnly===true,onProgress:context.onProgress,onGenerationAttempt:request.onGenerationAttempt})
      : await imageGenerator.generateImage(request);
    const providerWallMs = Date.now() - providerStartedAt;

    const persistenceStartedAt = Date.now();
    const contentType = result.contentType ?? 'image/png';
    const key = targetPath ?? `source/${characterId}_${resolvedMoveId}_sheet${extensionForContentType(contentType)}`;
    const asset = await repository.writeAsset(characterId, key, bytesFromImageResult(result), {
      contentType,
      provider: result.provider ?? imageGenerator.provider ?? 'unknown',
      adapterId: isVideoGenerator?`${generator}-workbench`:imageGenerator.id ?? 'imageGenerator',
      model: result.model ?? null,
      prompt,
      generationMs: result.generationMs ?? null,
      postprocessMs: result.postprocessMs ?? null,
      elapsedMs: result.elapsedMs ?? null,
      frameTimings: result.frameTimings ?? null,
      estimatedCostUsd: result.estimatedCostUsd ?? null,
      taskId: result.taskId ?? null,
      usage: result.usage ?? null,
      stageTimings: result.stageTimings ?? null,
      framesReady: result.framesReady ?? false,
    });

    let videoAsset = null;
    if (result.videoBytes) {
      videoAsset = await repository.writeAsset(
        characterId,
        `source/${characterId}_${resolvedMoveId}_${result.provider?.endsWith('-video')?'motion':'h3'}.mp4`,
        Buffer.from(result.videoBytes),
        {
          contentType: result.videoContentType ?? 'video/mp4',
          provider: result.provider ?? imageGenerator.provider ?? 'unknown',
          adapterId: isVideoGenerator?`${generator}-workbench`:imageGenerator.id ?? 'imageGenerator',
          model: result.model ?? null,
          prompt,
          sourceTaskId: result.taskId ?? null,
          generationMs: result.generationMs ?? null,
          elapsedMs: result.elapsedMs ?? null,
          usage: result.usage ?? null,
          stageTimings: result.stageTimings ?? null,
        },
      );
    }

    const frameAssets = [];
    for (const frame of result.frameImages ?? []) {
      const frameNumber = String(frame.frameNumber).padStart(2, '0');
      const frameContentType = frame.contentType ?? 'image/png';
      frameAssets.push(await repository.writeAsset(
        characterId,
        `source/${characterId}_${resolvedMoveId}_frames/frame_${frameNumber}${extensionForContentType(frameContentType)}`,
        Buffer.from(frame.bytes),
        {
          contentType: frameContentType,
          provider: result.provider ?? imageGenerator.provider ?? 'unknown',
          adapterId: imageGenerator.id ?? 'imageGenerator',
          model: result.model ?? null,
          prompt,
          frameNumber: frame.frameNumber,
          sourceTaskId: frame.taskId ?? null,
          elapsedMs: result.frameTimings?.find((timing) => timing.frameNumber === frame.frameNumber)?.elapsedMs ?? null,
        },
      ));
    }
    const artifactPersistenceMs = Date.now() - persistenceStartedAt;
    const totalMs = Date.now() - benchmarkStartedAt;
    const benchmark = {
      schemaVersion: 1,
      recordedAt: new Date().toISOString(),
      operation: 'generate-sprite-sheet',
      characterId,
      moveId: resolvedMoveId,
      generator,
      provider: result.provider ?? imageGenerator.provider ?? 'unknown',
      model: result.model ?? null,
      referenceCount: isVideoGenerator ? (result.referenceKey ? 1 : 0) : referenceImages.length,
      stages: {
        referenceLoadMs,
        providerWallMs,
        provider: result.stageTimings ?? null,
        artifactPersistenceMs,
        totalMs,
      },
      frameTimings: result.frameTimings ?? null,
      estimatedCostUsd: result.estimatedCostUsd ?? null,
      taskId: result.taskId ?? null,
    };
    const benchmarkAsset = await repository.writeAsset(
      characterId,
      `benchmarks/${resolvedMoveId}/${benchmark.recordedAt.replaceAll(':', '-').replaceAll('.', '-')}.json`,
      Buffer.from(`${JSON.stringify(benchmark, null, 2)}\n`),
      { contentType: 'application/json', artifactType: 'generation-benchmark', provider: benchmark.provider, model: benchmark.model },
    );

    // Non-base rows generated without the base sheet drift visually — surface
    // that so callers can warn or regenerate once the base row exists.
    const referencesUsed = isVideoGenerator ? [result.referenceKey].filter(Boolean) : referenceImages.map((image) => image.sourceKey);
    const baseReferenceAttached = isVideoGenerator ? referencesUsed.length > 0 : referencesUsed.some((key) => key.endsWith(`${characterId}_base_sheet.png`)||key.endsWith('/base/base_001.png'));

    return {
      asset,
      framesReady: result.framesReady ?? false,
      motionRow: result.motionRow ?? null,
      provider: result.provider ?? imageGenerator.provider ?? 'unknown',
      model: result.model ?? null,
      promptRef: result.promptRef ?? null,
      videoAsset,
      frameAssets,
      generationMs: result.generationMs ?? null,
      postprocessMs: result.postprocessMs ?? null,
      elapsedMs: result.elapsedMs ?? null,
      frameTimings: result.frameTimings ?? null,
      estimatedCostUsd: result.estimatedCostUsd ?? null,
      usage: result.usage ?? null,
      stageTimings: benchmark.stages,
      benchmarkAsset,
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
   * (phases, hitbox numbers, a chainable input), the server assigns every new
   * action its own stable custom sprite row, and the combo descriptor stitches
   * them into the runtime cancel graph. Follow-ups are true cancel-only moves:
   * they are absent from neutral move selection and exist only inside the string.
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
   * @param {boolean} [args.generateSprites=false]
   * @param {object} [args.context]
   */
  async authorCombo({ characterId, comboId, comboDisplayName, segments, generateSprites = false, context = {} }) {
    if (!comboId) throw new Error('authorCombo: comboId is required');
    if (!Array.isArray(segments) || segments.length < 2) {
      throw new Error('authorCombo: a combo needs at least 2 segments');
    }
    const textModel = this.registry.resolve(PipelinePort.TEXT_MODEL);
    const repository = this.registry.resolve(PipelinePort.CHARACTER_REPOSITORY);
    const draft = await repository.getDraft(characterId);
    if (!draft) throw new Error(`authorCombo: no draft found for "${characterId}"`);

    const warnings = [];
    const priorCombo=(draft.combos??[]).find(combo=>combo.id===comboId);
    const priorOwnedIds=new Set(priorCombo?.ownedMoveIds??[]);
    // Re-authoring replaces moves owned by this combo instead of accumulating
    // unreachable attacks and animation rows in the draft.
    const existingMoves = (draft.moves ?? []).filter(move=>move.comboOwner!==comboId&&!priorOwnedIds.has(move.id));
    const existingIds = new Set(existingMoves.map((move) => move.id));

    // Validate existing-id segments up front.
    for (const seg of segments) {
      if (seg.moveId && !existingIds.has(seg.moveId)) {
        throw new Error(`authorCombo: segment references unknown move "${seg.moveId}"`);
      }
    }

    // --- Stable custom row assignment ----------------------------------------
    // Custom animation rows are data-driven throughout the current engine,
    // Gym and build planner. Give every new action a distinct row; never reuse
    // one of the legacy six and never overwrite another move's artwork.
    const usedRows = new Set(existingMoves.map((move) => move.animation).filter(Boolean));
    const usedIds = new Set(existingIds);
    const createSegs = segments
      .map((seg, index) => ({ seg, index }))
      .filter(({ seg }) => !seg.moveId);
    const assignments = createSegs.map(({ seg, index }) => {
      const stem=`combo_${slugifyMoveId(comboId)}_${index+1}`;
      const id=uniqueId(stem,usedIds);usedIds.add(id);
      const animation=uniqueId(stem,usedRows);usedRows.add(animation);
      return { seg, index, id, animation, willGenerate:true };
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
          characterContext: {displayName:draft.displayName,description:draft.description,concept:draft.concept,controlPreferences:draft.controlPreferences},
          actors: (draft.actors??[]).map(({id,summon,description})=>({id,summon,description})),
          segments: assignments.map((a) => ({
            description: a.seg.description ?? '',
            displayName: a.seg.displayName,
            animation: a.animation,
          })),
          existingMoves: existingMoves.map((move) => ({ id: move.id, sequence: move.trigger?.sequence ?? [],directions:move.trigger?.directions,controlledActor:move.controlledActor })),
        },
        onProgress: context.onProgress,
      });
      authoredMoves = normalizeGeneratedMoves(authoring.value?.moves ?? []);
    }

    // Map authored moves onto assignments; the server owns `animation`. Guarantee
    // unique ids (don't silently replace an existing move) and fall back to a
    // minimal move if the model returned too few.
    const createdIdByIndex = new Map(assignments.map((a) => [a.index, a.id]));
    const orderedIds = segments.map((seg, i) => (seg.moveId ? seg.moveId : createdIdByIndex.get(i)));
    const createdMoves = assignments.map((a, idx) => {
      const authored = authoredMoves[idx] ?? {};
      const isFollowUp = a.index > 0;
      const trigger = { sequence: Array.isArray(authored.trigger?.sequence) ? authored.trigger.sequence : ['lp'] };
      if(authored.trigger?.directions)trigger.directions=authored.trigger.directions;
      if (isFollowUp) Object.assign(trigger,{allowedStates:['attack'],cancelOnly:true,cancelFrom:[orderedIds[a.index-1]],cancelOn:'hit'});
      const move = {
        id:a.id,
        displayName: authored.displayName ?? a.seg.displayName ?? a.id,
        description: authored.description ?? a.seg.description ?? '',
        animation: a.animation,
        requiredAnimation:a.animation,
        artStatus:'proxy',
        category:'string',
        comboOwner:comboId,
        comboStage:a.index,
        ...(authored.controlledActor?{controlledActor:authored.controlledActor}:{}),
        trigger,
        phases: Array.isArray(authored.phases) && authored.phases.length ? authored.phases : defaultComboPhases(idx),
      };
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
    const createdIds = new Set(createdMoves.map((move) => move.id));
    const mergedMoves = [...existingMoves.filter((move) => !createdIds.has(move.id)), ...createdMoves];
    const combo = { id: comboId, segments: orderedIds, ownedMoveIds:[...createdIds], exclusiveFrom:1, displayName:comboDisplayName??titleCaseComboId(comboId) };
    const combos = [...(draft.combos ?? []).filter((existing) => existing.id !== comboId), combo];
    const comboErrors = validateCombos(combos, mergedMoves.map((move) => move.id));
    if (comboErrors.length) throw new Error(`authorCombo rejected: ${comboErrors.join('; ')}`);
    validateCombatRules({...draft,moves:mergedMoves,combos});

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
    const workingRoot = await repository.workingAssetRoot?.(characterId) ?? `characters/${characterId}/assets`;
    let referenceKeys = referenceAssetKeys;
    if (!referenceKeys.length) {
      referenceKeys = [
        `${workingRoot}/source/${characterId}_base_sheet.png`,
        await currentConceptAssetKey(repository, characterId, storage),
      ].filter(Boolean);
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
      context: { characterId, ...context },
      onProgress: context.onProgress,
      onGenerationAttempt: createGenerationAttemptRecorder(storage, context.onGenerationAttempt),
    });

    // Keep the paid source before any compiler work so an imperfect matte can
    // be reprocessed without another provider call.
    const rawBytes = bytesFromImageResult(result);
    const rawAsset = await repository.writeAsset(characterId, `source/${characterId}_${projectileId}_projectile_raw_${digest(rawBytes).slice(0, 12)}.png`, rawBytes, {
      contentType: 'image/png', provider: result.provider ?? imageGenerator.provider ?? 'unknown',
      adapterId: imageGenerator.id ?? 'imageGenerator', model: result.model ?? null, prompt,
    });
    let normalizedBytes;
    try {
      normalizedBytes = await normalizeProjectileBytes(rawBytes);
    } catch (normError) {
      const failedDraft = await repository.getDraft(characterId);
      const failedEntity = (failedDraft.projectiles ?? []).find(entity => entity.id === projectileId);
      if (failedEntity) await repository.saveDraft(characterId, {
        ...failedDraft,
        projectiles: (failedDraft.projectiles ?? []).map(entity => entity.id === projectileId ? { ...entity, sourceImageKey: rawAsset.key, prompt } : entity),
      }, { provider: 'cms-tool', adapterId: 'projectile-source-retained' });
      throw new Error(`Projectile source was retained at ${rawAsset.key}, but normalization failed: ${normError.message}. Reprocess the saved sprite; do not regenerate.`);
    }

    const contentType = result.contentType ?? 'image/png';
    const key = `source/${characterId}_${projectileId}_projectile_${digest(normalizedBytes).slice(0, 12)}${extensionForContentType(contentType)}`;
    const asset = await repository.writeAsset(characterId, key, normalizedBytes, {
      contentType,
      provider: result.provider ?? imageGenerator.provider ?? 'unknown',
      adapterId: imageGenerator.id ?? 'imageGenerator',
      model: result.model ?? null,
      prompt,
    });

    // Upsert the entity. Animation is the runtime texture key the engine renders.
    // Persist the prompt so the admin UI can pre-fill it for re-generation.
    const animation = `${characterId}_${projectileId}`;
    const draft = await repository.getDraft(characterId);
    const existing = (draft.projectiles ?? []).find((entity) => entity.id === projectileId);
    const projectile = existing
      ? { ...existing, animation, sourceKey: asset.key, sourceImageKey: rawAsset.key, prompt }
      : {
          id: projectileId,
          animation,
          sourceKey: asset.key,
          sourceImageKey: rawAsset.key,
          prompt,
          width: 48,
          height: 32,
          speed: 7,
          velocity: { x: 7, y: 0, relativeToFacing: true },
          lifetime: 110,
          hitbox: { x: -24, y: -16, width: 48, height: 32, damage: 60, hitstun: 18, blockstun: 12, knockback: { x: 4, y: 0 }, level: 'mid' },
        };
    projectile.impact=existing?.impact??projectileImpact(projectile,prompt);
    await repository.writeAsset(characterId,`effects/${projectileId}/impact.json`,Buffer.from(JSON.stringify(projectile.impact,null,2)),{contentType:'application/json',provider:'authored-companion',adapterId:'projectile-impact-contract'});
    const projectiles = [...(draft.projectiles ?? []).filter((entity) => entity.id !== projectileId), projectile];
    await repository.saveDraft(characterId, { ...draft, projectiles }, {
      provider: 'cms-tool',
      adapterId: 'generate-projectile',
    });

    return { asset, projectile };
  }

  async reprocessProjectile({ characterId, projectileId, sourceAssetKey }) {
    const repository = this.registry.resolve(PipelinePort.CHARACTER_REPOSITORY);
    const storage = this.registry.resolve(PipelinePort.ASSET_STORAGE);
    const draft = await repository.getDraft(characterId);
    const existing = (draft.projectiles ?? []).find(entity => entity.id === projectileId);
    if (!existing) throw new Error('Define the projectile before reprocessing its sprite.');
    const sourceKey = sourceAssetKey ?? existing.sourceImageKey ?? existing.sourceKey;
    if (!sourceKey) throw new Error('Choose a retained projectile source to reprocess.');
    const allowedRoot = draft.history?.workingRoot ?? `characters/${characterId}/assets`;
    if (sourceKey !== existing.sourceKey && sourceKey !== existing.sourceImageKey && !sourceKey.startsWith(`${allowedRoot}/source/${characterId}_${projectileId}_projectile_raw_`)) throw new Error('Projectile source is outside this character or projectile.');
    const sourceBytes = await storage.getBytes(sourceKey);
    const source = await storage.lineage.artifact(sourceBytes, { contentType: 'image/png' });
    const normalizer = await storage.lineage.artifact(await readFile(NORMALIZE_PROJECTILE_SCRIPT_PATH), { contentType: 'text/x-python' });
    return storage.lineage.run({ characterId, stage: 'reprocess-projectile', moveId: projectileId, inputs: { source, sourceKey, normalizer } }, async () => {
      const normalized = await normalizeProjectileBytes(sourceBytes);
      if ((await repository.getDraft(characterId)).updatedAt !== draft.updatedAt) throw new Error('Draft changed while reprocessing. Refresh and retry the saved source.');
      const safety = await repository.createVersion(characterId, draft, { label: `Before reprocessing projectile ${projectileId}` });
      const asset = await repository.writeAsset(characterId, `source/${characterId}_${projectileId}_projectile_${digest(normalized).slice(0, 12)}.png`, normalized, {
        contentType: 'image/png', provider: 'local', adapterId: 'projectile-reprocess', sourceKey,
      });
      const projectile = { ...existing, sourceKey: asset.key, sourceImageKey: sourceKey };
      const saved = await repository.saveDraft(characterId, {
        ...draft, projectiles: (draft.projectiles ?? []).map(entity => entity.id === projectileId ? projectile : entity),
      }, { provider: 'local', adapterId: 'projectile-reprocess' });
      const after = await repository.createVersion(characterId, saved, { label: `Reprocessed projectile ${projectileId}` });
      await storage.lineage.event(characterId, { type: 'projectile-reprocessed', moveId: projectileId, sourceSha256: source.sha256, safetyVersionId: safety.versionId, versionId: after.versionId, providerRequests: 0, output: await storage.lineage.artifact(normalized, { contentType: 'image/png' }) });
      return { asset, projectile, safetyVersionId: safety.versionId, versionId: after.versionId, providerRequests: 0 };
    });
  }

  async extractRowFrames(request) {
    const key = request.characterId;
    const prior = this.extractionQueues.get(key) ?? Promise.resolve();
    const pending = prior.catch(() => {}).then(() => this.extractRowFramesExclusive(request));
    this.extractionQueues.set(key, pending);
    try { return await pending; }
    finally { if (this.extractionQueues.get(key) === pending) this.extractionQueues.delete(key); }
  }

  async extractRowFramesExclusive({ characterId, sourceAssetKey, moveId, spriteProfile, targetHeight, videoSampleTimes, strictChromaEdges = false, context = {} }) {
    const benchmarkStartedAt = Date.now();
    const storage = this.registry.resolve(PipelinePort.ASSET_STORAGE);
    const repository = this.registry.resolve(PipelinePort.CHARACTER_REPOSITORY);
    const activeDraft = await storage.exists(`characters/${characterId}/draft/content.json`) ? await repository.getDraft(characterId) : {};
    const packRoot = activeDraft.assets?.rootKey ?? `characters/${characterId}/assets/fighter-pack`;

    // Resolve the silhouette height this row should be normalized to: explicit
    // override, else the fighter's existing base row. The base row defines the
    // fighter's scale; every other row is rescaled to match it. The base row's
    // median reach also defines the body envelope used to carve attack boxes
    // (pixels protruding beyond the idle body are the attacking limb/weapon).
    let resolvedTargetHeight = targetHeight ?? null;
    let bodyHalfWidth = null;
    const scaleReferenceStartedAt = Date.now();
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
    const scaleReferenceLoadMs = Date.now() - scaleReferenceStartedAt;

    const sourceLoadStartedAt = Date.now();
    let sourceBytes = await storage.getBytes(sourceAssetKey);
    const sourceMetadata = await storage.getMetadata(sourceAssetKey);
    if(sourceMetadata.framesReady) return {characterId,moveId,warnings:['Video frames already compiled at their authored count; six-cell extraction skipped.']};
    const sourceLoadMs = Date.now() - sourceLoadStartedAt;
    const isVideo = sourceMetadata.provider === 'fal-video';
    let videoResampleMs = 0;
    if(videoSampleTimes&&!isVideo)throw new Error('Sample times require an existing video-derived source.');
    if(isVideo&&(sourceMetadata.videoSamplingVersion!==2||videoSampleTimes)){
      const videoResampleStartedAt = Date.now();
      const videoKey=`${activeDraft.history?.workingRoot ?? `characters/${characterId}/assets`}/source/${characterId}_${moveId}_motion.mp4`;
      if(await storage.exists(videoKey)){
        sourceBytes=await composeSpriteSheetWithFfmpeg({videoBytes:await storage.getBytes(videoKey),task:spriteProfile==='wide'?'fighter-2x3-grid':'fighter-1x6-row',duration:5,sampleTimes:videoSampleTimes});
        await storage.putBytes(sourceAssetKey,sourceBytes,{...sourceMetadata,videoSamplingVersion:2,videoSampleTimes:videoSampleTimes??null});
      }else if(videoSampleTimes){throw new Error('Original source video is missing; sampling was not changed.');
      }
      videoResampleMs = Date.now() - videoResampleStartedAt;
    }
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
      // Height-dynamic rows (jump/crouch) legitimately change height — skip per-frame
      // equalization so the squat/rise animation reads correctly.
      const profile = rowPromptProfile(moveId);
      if (isVideo) args.push('--video-source');
      if (strictChromaEdges) args.push('--strict-chroma-edges');
      if (profile.heightDynamic || isVideo) {
        args.push('--no-equalize-frames');
      } else {
        args.push('--equalize-frames');
      }
      const normalizationStartedAt = Date.now();
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
      const normalizationMs = Date.now() - normalizationStartedAt;

      const report = JSON.parse(await readFile(path.join(outputDir, 'extraction_report.json'), 'utf8'));
      const fragment = report.frameData ?? [];
      if (!fragment.some((frame) => frame.silhouetteHeight > 0)) {
        throw new Error(
          `Frame extraction produced no usable frames for ${characterId}/${moveId}; the source sheet may be empty or fully transparent.`,
        );
      }

      const now = this.clock().toISOString();
      const spritesPrefix = `${packRoot}/sprites/${moveId}`;
      const persistenceStartedAt = Date.now();

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
          stageTimings: {
            scaleReferenceLoadMs,
            sourceLoadMs,
            videoResampleMs,
            normalizationMs,
          },
        },
      };
      normReport.warnings = Object.entries(normReport.moves)
        .flatMap(([move, entry]) => (entry.warnings ?? []).map((warning) => `${move}: ${warning}`));
      await storage.putJson(reportKey, normReport, {
        contentType: 'application/json',
        artifactType: 'normalization-report',
      });

      const artifactPersistenceMs = Date.now() - persistenceStartedAt;
      const stageTimings = {
        scaleReferenceLoadMs,
        sourceLoadMs,
        videoResampleMs,
        normalizationMs,
        artifactPersistenceMs,
        totalMs: Date.now() - benchmarkStartedAt,
      };
      const benchmarkKey = `${packRoot}/benchmarks/extraction/${moveId}/${now.replaceAll(':', '-').replaceAll('.', '-')}.json`;
      await storage.putJson(benchmarkKey, {
        schemaVersion: 1,
        recordedAt: now,
        operation: 'extract-row-frames',
        characterId,
        moveId,
        sourceAssetKey,
        isVideo,
        stages: stageTimings,
        warnings: report.warnings ?? [],
      }, { contentType: 'application/json', artifactType: 'extraction-benchmark' });

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
        stageTimings,
        benchmarkKey,
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
    const repository = this.registry.resolve(PipelinePort.CHARACTER_REPOSITORY);
    const context = await loadReviewContext(repository,request.characterId);
    if(request.normalizedKey!==`${context.root}/manifest.json`)throw new Error('Validate the current working pack, not an older revision.');
    const before = await packFingerprint(context);
    const result = await qa.validateFighterPack({
      requestedAt: this.clock().toISOString(),
      ...request,
    });
    const after = await packFingerprint(await loadReviewContext(repository,request.characterId));
    if(before!==after)throw new Error('Assets or rules changed during validation. Run QA again.');
    const report={...result,inputFingerprint:after};
    await repository.writeQaReport(request.characterId,`verified-${Date.now()}`,report);
    return report;
  }

  async publishCharacter(request) {
    const repository = this.registry.resolve(PipelinePort.CHARACTER_REPOSITORY);
    const draft=await repository.getDraft(request.characterId);
    if(draft.parentId)throw new Error('Hidden forms are installed and published through their parent character, not as selectable fighters.');
    assertMotionCoverage(draft);
    await assertPublishReadiness(repository,request.characterId);
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
      onGenerationAttempt: createGenerationAttemptRecorder(storage, context.onGenerationAttempt),
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
function createGenerationAttemptRecorder(storage, downstream) {
  const record = async (event) => {
    const date = /^\d{4}-\d{2}-\d{2}/.exec(event.startedAt ?? '')?.[0] ?? 'unknown-date';
    const observation = String(event.completedAt ?? new Date().toISOString()).replaceAll(':', '-').replaceAll('.', '-');
    const key = `benchmarks/generation-attempts/${date}/${event.attemptId}-${observation}.json`;
    await storage.putJson(key, { ...event, benchmarkKey: key }, {
      contentType: 'application/json',
      artifactType: 'external-generation-attempt',
      provider: event.provider,
      model: event.model,
      status: event.status,
    });
    await downstream?.({ ...event, benchmarkKey: key });
  };
  record.lineage = storage.lineage;
  return record;
}

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

/**
 * Turns model-declared exclusive combo stages into the same first-class move
 * contract used by the workbench authoring tool. This keeps initial character
 * creation and later CMS editing on one runtime model: dedicated rows,
 * cancel-only activation, and an explicit predecessor for every link.
 */
function applyGeneratedComboExclusivity(moves, combos, warnings) {
  const byId=new Map((moves??[]).map(move=>[move.id,move]));
  const owned=new Map();
  for(const combo of combos??[]){
    if(!Number.isInteger(combo.exclusiveFrom))continue;
    if(combo.exclusiveFrom<1||combo.exclusiveFrom>=combo.segments.length){
      warnings.push(`combo "${combo.id}" has invalid exclusiveFrom ${combo.exclusiveFrom}; expected a segment index from 1 to ${combo.segments.length-1}`);
      continue;
    }
    for(let index=combo.exclusiveFrom;index<combo.segments.length;index+=1){
      const id=combo.segments[index];
      const priorOwner=owned.get(id);
      if(priorOwner&&priorOwner!==combo.id){
        warnings.push(`move "${id}" was declared combo-only by both "${priorOwner}" and "${combo.id}"; keeping its first owner`);
        continue;
      }
      const move=byId.get(id);if(!move)continue;
      owned.set(id,combo.id);
      move.comboOwner=combo.id;
      move.comboStage=index;
      move.category='string';
      move.requiredAnimation=move.requiredAnimation??move.animation;
      move.artStatus=move.artStatus??'proxy';
      move.trigger={
        ...(move.trigger??{}),
        allowedStates:['attack'],
        cancelOnly:true,
        cancelFrom:[combo.segments[index-1]],
        cancelOn:'hit',
      };
    }
    combo.ownedMoveIds=combo.segments.slice(combo.exclusiveFrom);
  }
}

function slugifyMoveId(text) {
  const slug = String(text ?? 'move').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return slug || 'move';
}

function titleCaseComboId(value){
  return String(value??'combo').split(/[_-]+/).filter(Boolean).map(part=>part.charAt(0).toUpperCase()+part.slice(1)).join(' ')||'Combo';
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
