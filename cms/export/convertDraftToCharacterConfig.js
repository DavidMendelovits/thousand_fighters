/**
 * convertDraftToCharacterConfig.js
 *
 * Pure function that converts a CMS draft + fighter pack data into a
 * runtime-compatible CharacterConfig plain object.
 *
 * @param {{ draft: object, frameData: object|null, manifest: object|null }} params
 * @returns {object} CharacterConfig-shaped plain object
 */
import { normalizeManifest } from '../pipeline/manifestSchema.js';

/**
 * Collision override layer (Character Gym, T10/D2).
 *
 * `draft.overrides` is a human/gym-authored correction layer that WINS over the
 * measured-geometry passes (`generateDefaultHurtboxes`, `applyMeasuredHitboxGeometry`).
 * The AI never emits it. Boxes are stored in **frame pixels, anchor-relative** —
 * the same space as the extractor's measured `hurtbox`/`attackBox` — so convert
 * applies `× scale` exactly like the measured path. That keeps overrides
 * scale-robust (a re-extracted, resized sprite scales its boxes with it) and
 * lets the gym persist what it draws with no unit conversion.
 *
 * Shape:
 *   draft.overrides = {
 *     hurtboxes: { <FighterState>: { x, y, width, height } },     // per-state
 *     hitboxes:  { <moveId>: { <hitboxId>: { x, y, width, height } } }, // per move + id
 *   }
 *
 * A hitbox override is a STATIC box: it replaces the measured geometry and
 * clears the interpolated `keyframes` track (A4 — what you draw is what ships).
 *
 * @typedef {{ x: number, y: number, width: number, height: number }} BoxPx
 */

export function convertDraftToCharacterConfig({ draft, frameData, manifest: rawManifest }) {
  if (!draft) throw new Error('convertDraftToCharacterConfig: draft is required');

  const id = draft.id;
  if (!id) throw new Error('convertDraftToCharacterConfig: draft.id is required');

  const manifest = normalizeManifest(rawManifest, { id });
  const stats = draft.stats ?? {};
  const scale = deriveSpriteScale(draft.sprite ?? {}, frameData);
  const overrides = (draft.overrides && typeof draft.overrides === 'object') ? draft.overrides : {};

  return {
    id,
    displayName: draft.displayName ?? id,
    walkForwardSpeed: stats.walkForwardSpeed ?? 2.8,
    walkBackSpeed: stats.walkBackSpeed ?? 1.8,
    jumpVelocity: stats.jumpVelocity ?? 10.2,
    jumpForwardVelocity: stats.jumpForwardVelocity ?? 3.4,
    jumpBackVelocity: stats.jumpBackVelocity ?? 2.8,
    gravity: stats.gravity ?? 0.54,
    maxFallSpeed: stats.maxFallSpeed ?? 12,
    maxHealth: stats.maxHealth ?? 1000,
    pivotOffsetY: 0,
    sprite: buildSpriteConfig({ draft, frameData, manifest, scale }),
    // Measured hurtboxes first, then gym overrides win (D2).
    hurtboxes: applyHurtboxOverrides(generateDefaultHurtboxes(frameData, scale), overrides.hurtboxes, scale),
    // Guard boxes are override-only — no measured/default pass. Fighters with no
    // gym-authored guardboxes get an empty map and fall back to the legacy
    // level/crouch logic in HitResolver (T17).
    guardboxes: applyGuardboxOverrides({}, overrides.guardboxes, scale),
    animations: {
      idle: 'idle',
      walk_forward: 'walk_forward',
      walk_back: 'walk_back',
      crouch: 'crouch',
      airborne: 'airborne',
      landing: 'landing',
      attack: 'attack',
      hitstun: 'hitstun',
      blockstun: 'blockstun',
      knockdown: 'knockdown',
      getup: 'getup',
      dead: 'dead',
    },
    moves: resolveProjectileEntities(
      applyComboChaining(
        (draft.moves ?? []).map((draftMove) =>
          convertMove(draftMove, { frameData, scale, hitboxOverrides: overrides.hitboxes?.[draftMove.id] })),
        draft.combos,
      ),
      draft.projectiles,
    ),
  };
}

// ---------------------------------------------------------------------------
// Combo chaining (T22)
// ---------------------------------------------------------------------------

/** Cancel-input window (frames) given to combo members so the player can land
 *  the next input during the cancellable recovery. convert otherwise pins
 *  trigger.window to 6, which is too tight to chain. */
const COMBO_CANCEL_WINDOW = 14;

/**
 * Derive the full runtime CANCEL GRAPH onto converted moves from the combo
 * descriptor — `draft.combos: [{ id, segments: [moveId, ...] }]`. For each
 * adjacent pair a → b this wires every gate `Fighter`/`MoveExecutor` check on
 * the cancel path, so a generated combo actually FIRES with no manual tuning:
 *
 *   - `a.cancelInto += b`            — MoveExecutor.tryCancel requires it.
 *   - `b.trigger.cancelFrom += a`    — LOAD-BEARING. findTriggeredMove's
 *       cancelFrom check is `forCancel`-guarded, so on the normal path (from
 *       idle/walk) b is unaffected and still triggers standalone; on the cancel
 *       path b is admitted ONLY out of a, not out of every attack. Adding
 *       `allowedStates:'attack'` WITHOUT this is the footgun (b becomes
 *       cancellable from anything).
 *   - `b.trigger.allowedStates += 'attack'` — during a move the fighter is in
 *       state 'attack'; findTriggeredMove rejects b unless its allowedStates
 *       includes it (convert defaults to idle/walk only).
 *   - `b.trigger.window = max(window, COMBO_CANCEL_WINDOW)` — room to land it.
 *
 * Phase `cancellable` is NOT fabricated here — it comes free from the
 * recovery-phase default in convertPhase. This stays principled inside the
 * combo step because it is the same cancel graph derived from the same ordered
 * descriptor as `cancelInto`, and it is re-derived (not persisted) so editing a
 * combo re-wires cleanly.
 *
 * Lenient by design: a segment referencing a move that doesn't exist is skipped
 * (never emits a dangling edge). Strict validation belongs at combo DEFINITION
 * time — see `validateCombos`, used by the CMS tool.
 *
 * @param {object[]} moves   Converted runtime Move objects (mutated in place).
 * @param {object[]} [combos]
 * @returns {object[]} moves
 */
export function applyComboChaining(moves, combos) {
  if (!Array.isArray(combos) || combos.length === 0) return moves;
  const byId = new Map(moves.map((move) => [move.id, move]));
  const addUnique = (arr, value) => {
    const list = Array.isArray(arr) ? arr : [];
    return list.includes(value) ? list : [...list, value];
  };
  for (const combo of combos) {
    const segments = Array.isArray(combo?.segments) ? combo.segments : [];
    for (let i = 0; i < segments.length - 1; i += 1) {
      const move = byId.get(segments[i]);
      const next = byId.get(segments[i + 1]);
      // Lenient: only wire when both endpoints exist, so we never emit a
      // dangling edge for a half-authored combo (keeps live convert from
      // throwing on the testbed/runtime-config path).
      if (!move || !next) continue;

      move.cancelInto = addUnique(move.cancelInto, next.id);

      next.trigger = next.trigger ?? {};
      next.trigger.cancelFrom = addUnique(next.trigger.cancelFrom, move.id);
      next.trigger.allowedStates = addUnique(next.trigger.allowedStates, 'attack');
      next.trigger.window = Math.max(next.trigger.window ?? 6, COMBO_CANCEL_WINDOW);
    }
  }
  return moves;
}

/**
 * Strict validation for combo descriptors at definition time. Returns an array
 * of human-readable error strings (empty when valid) so the caller can fail
 * loudly before persisting — a combo pointing at a nonexistent move must be
 * rejected here, not silently dropped later.
 *
 * @param {object[]} [combos]
 * @param {string[]} moveIds  Ids of the draft's existing moves.
 * @returns {string[]} errors
 */
export function validateCombos(combos, moveIds) {
  const errors = [];
  if (combos === undefined || combos === null) return errors;
  if (!Array.isArray(combos)) return ['combos must be an array'];
  const known = new Set(moveIds ?? []);
  const seenIds = new Set();
  for (const combo of combos) {
    const cid = combo?.id ?? '(unnamed)';
    if (combo?.id) {
      if (seenIds.has(combo.id)) errors.push(`duplicate combo id "${combo.id}"`);
      seenIds.add(combo.id);
    }
    const segments = Array.isArray(combo?.segments) ? combo.segments : [];
    if (segments.length < 2) {
      errors.push(`combo "${cid}" needs at least 2 segments (got ${segments.length})`);
    }
    for (const segId of segments) {
      if (!known.has(segId)) errors.push(`combo "${cid}" references unknown move "${segId}"`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Projectile entities (T23)
// ---------------------------------------------------------------------------

/**
 * Build a runtime ProjectileConfig from a draft projectile entity, filling
 * sensible defaults for anything unauthored. The entity is the authoring shape
 * of `src/schema/types.ts` ProjectileConfig.
 *
 * @param {object} entity  draft.projectiles[i]
 * @returns {object} runtime ProjectileConfig
 */
function projectileConfigFromEntity(entity) {
  const hb = entity.hitbox ?? {};
  const width = entity.width ?? 32;
  const height = entity.height ?? 32;
  const speed = entity.speed ?? entity.velocity?.x ?? 6;
  const config = {
    id: entity.id,
    animation: entity.animation ?? 'special_2',
    width,
    height,
    speed,
    velocity: {
      x: entity.velocity?.x ?? speed,
      y: entity.velocity?.y ?? 0,
      relativeToFacing: entity.velocity?.relativeToFacing ?? true,
    },
    lifetime: entity.lifetime ?? 120,
    hitbox: {
      x: hb.x ?? -Math.round(width / 2),
      y: hb.y ?? -Math.round(height / 2),
      width: hb.width ?? width,
      height: hb.height ?? height,
      damage: hb.damage ?? 60,
      hitstun: hb.hitstun ?? 18,
      blockstun: hb.blockstun ?? 12,
      knockback: { x: hb.knockback?.x ?? hb.knockbackX ?? 3, y: hb.knockback?.y ?? hb.knockbackY ?? 0 },
      level: hb.level ?? 'mid',
    },
  };
  if (typeof entity.gravity === 'number') config.gravity = entity.gravity;
  if (typeof entity.pierces === 'number') config.pierces = entity.pierces;
  if (typeof entity.clashesWithProjectiles === 'boolean') config.clashesWithProjectiles = entity.clashesWithProjectiles;
  if (entity.spawnPolicy && typeof entity.spawnPolicy === 'object') config.spawnPolicy = entity.spawnPolicy;
  return config;
}

/**
 * Resolve spawn events that reference a projectile ENTITY by id (T23). Walks
 * every move's phase events; for each `spawn_projectile*` event carrying a
 * `projectileId`, fills in `projectile` from `draft.projectiles` and strips the
 * id. Lenient: an event whose `projectileId` has no matching entity is DROPPED
 * (the runtime spawn event requires a projectile config — a dangling one would
 * crash), not emitted broken. Inline-projectile events (legacy) are untouched.
 *
 * @param {object[]} moves      Converted runtime Move objects (mutated in place).
 * @param {object[]} [projectiles]  draft.projectiles entities.
 * @returns {object[]} moves
 */
export function resolveProjectileEntities(moves, projectiles) {
  const byId = new Map((Array.isArray(projectiles) ? projectiles : []).map((entity) => [entity.id, entity]));
  for (const move of moves) {
    for (const phase of move.phases ?? []) {
      const events = phase.events ?? [];
      const resolved = [];
      for (const wrapped of events) {
        const event = wrapped.event ?? wrapped;
        if (event && typeof event.projectileId === 'string' && !event.projectile) {
          const entity = byId.get(event.projectileId);
          if (!entity) continue; // lenient: drop a dangling reference rather than emit a broken spawn
          const { projectileId: _id, ...rest } = event;
          const filled = { ...rest, projectile: projectileConfigFromEntity(entity) };
          resolved.push(wrapped.event ? { ...wrapped, event: filled } : filled);
        } else {
          resolved.push(wrapped);
        }
      }
      phase.events = resolved;
    }
  }
  return moves;
}

/**
 * Strict validation for projectile entities at definition time. Returns
 * human-readable error strings (empty when valid).
 *
 * @param {object[]} [projectiles]
 * @returns {string[]} errors
 */
export function validateProjectiles(projectiles) {
  const errors = [];
  if (projectiles === undefined || projectiles === null) return errors;
  if (!Array.isArray(projectiles)) return ['projectiles must be an array'];
  const seenIds = new Set();
  for (const entity of projectiles) {
    const pid = entity?.id ?? '(unnamed)';
    if (!entity?.id || typeof entity.id !== 'string') {
      errors.push(`projectile "${pid}" needs a string id`);
    } else {
      if (seenIds.has(entity.id)) errors.push(`duplicate projectile id "${entity.id}"`);
      seenIds.add(entity.id);
    }
    // NOTE: validateProjectiles is intentionally lenient on velocity/hitbox/
    // damage — convert's projectileConfigFromEntity defaults those, and this
    // same validator gates incremental flows (define_projectile tuning, gym
    // saves) where a partial entity is legitimate. Creation-time completeness is
    // enforced upstream by the strict characterContentDraftSchema instead.
    for (const field of ['width', 'height', 'lifetime']) {
      if (entity?.[field] !== undefined && (typeof entity[field] !== 'number' || entity[field] <= 0)) {
        errors.push(`projectile "${pid}": ${field} must be a positive number`);
      }
    }
    if (entity?.hitbox !== undefined && (typeof entity.hitbox !== 'object' || entity.hitbox === null)) {
      errors.push(`projectile "${pid}": hitbox must be an object`);
    }
  }
  return errors;
}

/**
 * Reference-integrity check (codex P1): every `spawn_projectile*` event in the
 * draft's moves must reference a projectile entity that still exists. Convert
 * drops a dangling reference leniently (runtime safety), so this surfaces the
 * loss at authoring/save time instead of letting a renamed/removed entity
 * silently stop a move from spawning. Returns human-readable warnings (empty
 * when all references resolve).
 *
 * @param {object} draft
 * @returns {string[]} warnings
 */
export function validateProjectileReferences(draft) {
  const warnings = [];
  const known = new Set((Array.isArray(draft?.projectiles) ? draft.projectiles : []).map((entity) => entity?.id));
  for (const move of draft?.moves ?? []) {
    for (const phase of move?.phases ?? []) {
      for (const wrapped of phase?.events ?? []) {
        const event = wrapped?.event ?? wrapped;
        const pid = event?.projectileId;
        if (typeof pid === 'string' && !event.projectile && !known.has(pid)) {
          warnings.push(`move "${move?.id ?? '(unknown)'}" spawns projectile "${pid}", which no longer exists on the draft — it will silently NOT spawn at runtime`);
        }
      }
    }
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Override helpers (frame-px, anchor-relative -> world units via scale)
// ---------------------------------------------------------------------------

/** True when `box` has numeric x/y/width/height. */
function isBox(box) {
  return Boolean(box)
    && typeof box.x === 'number' && typeof box.y === 'number'
    && typeof box.width === 'number' && typeof box.height === 'number';
}

/** Convert a frame-pixel (anchor-relative) box to world units. */
function scaleBox(box, scale) {
  return {
    x: Math.round(box.x * scale),
    y: Math.round(box.y * scale),
    width: Math.max(1, Math.round(box.width * scale)),
    height: Math.max(1, Math.round(box.height * scale)),
  };
}

/**
 * Apply per-state hurtbox overrides on top of the measured map. Override wins;
 * an override for a state the measured pass didn't emit is added.
 *
 * @param {object} hurtboxes - measured/default hurtbox map (mutated + returned)
 * @param {object|undefined} overrides - per-state BoxPx map (frame-px)
 * @param {number} scale
 */
function applyHurtboxOverrides(hurtboxes, overrides, scale) {
  if (!overrides || typeof overrides !== 'object') return hurtboxes;
  for (const [state, box] of Object.entries(overrides)) {
    if (isBox(box)) hurtboxes[state] = scaleBox(box, scale);
  }
  return hurtboxes;
}

/**
 * Apply per-state guard-box overrides. Guard boxes are OVERRIDE-ONLY — there is
 * no measured/default pass, so the starting map is always `{}`. Fighters with no
 * gym-authored guardboxes produce an empty map and fall back to the legacy
 * level/crouch logic in HitResolver (T17).
 *
 * @param {object} guardboxes - empty base map (mutated + returned)
 * @param {object|undefined} overrides - per-state BoxPx map (frame-px)
 * @param {number} scale
 */
function applyGuardboxOverrides(guardboxes, overrides, scale) {
  if (!overrides || typeof overrides !== 'object') return guardboxes;
  for (const [state, box] of Object.entries(overrides)) {
    if (isBox(box)) guardboxes[state] = scaleBox(box, scale);
  }
  return guardboxes;
}

/**
 * Apply per-hitbox geometry overrides on a converted move, AFTER the measured
 * pass. Matches by hitbox id (default 'default'); replaces geometry and clears
 * the keyframe track so the override is a static box (A4).
 *
 * @param {object} move - runtime move (mutated)
 * @param {object|undefined} overrides - { <hitboxId>: BoxPx } for this move (frame-px)
 * @param {number} scale
 */
function applyHitboxOverrides(move, overrides, scale) {
  if (!overrides || typeof overrides !== 'object') return;
  for (const phase of move.phases ?? []) {
    for (const entry of phase.events ?? []) {
      const event = entry.event;
      if (event?.type !== 'hitbox_active' || !event.hitbox) continue;
      const box = overrides[event.id ?? 'default'];
      if (!isBox(box)) continue;
      Object.assign(event.hitbox, scaleBox(box, scale));
      delete event.keyframes;
    }
  }
}

// ---------------------------------------------------------------------------
// Sprite config builder
// ---------------------------------------------------------------------------

// On-screen silhouette height every fighter is normalized to, in canvas pixels
// (canvas is 800x450). Calibrated against the hand-tuned roster: janitor's
// base frames are ~290px tall at scale 0.55 ≈ 160px on screen.
const TARGET_SILHOUETTE_PX = 160;

/**
 * Derive the render scale from measured frame data instead of trusting the
 * drafted sprite.scale: the text model invents that number before any art
 * exists, so it has no relationship to the generated frame pixel sizes.
 *
 * sprite.relativeHeight (0.5–1.6, default 1) carries intended character
 * height — a giant should tower, a gremlin should be small — which pixels
 * cannot express because sheet pixel density is generation noise.
 * sprite.scaleAdjust remains as a manual fine-tune multiplier.
 */
function deriveSpriteScale(sprite, frameData) {
  const adjust = typeof sprite.scaleAdjust === 'number' && sprite.scaleAdjust > 0
    ? sprite.scaleAdjust
    : 1;

  const heights = (frameData?.frames?.base ?? [])
    .map((frame) => frame.silhouetteHeight)
    .filter((value) => typeof value === 'number' && value > 0)
    .sort((a, b) => a - b);
  if (!heights.length) return (sprite.scale ?? 0.55) * adjust;

  const relativeHeight = typeof sprite.relativeHeight === 'number'
    ? Math.min(1.6, Math.max(0.5, sprite.relativeHeight))
    : 1;

  const median = heights[Math.floor(heights.length / 2)];
  const derived = TARGET_SILHOUETTE_PX / median;
  return Math.min(2, Math.max(0.05, derived)) * relativeHeight * adjust;
}

function buildSpriteConfig({ draft, frameData, manifest, scale }) {
  const sprite = draft.sprite ?? {};
  const id = draft.id;

  const sheets = manifest?.sheets ?? {
    base: 'sheets/base.png',
    punch: 'sheets/punch.png',
    kick: 'sheets/kick.png',
    special_1: 'sheets/special_1.png',
    special_2: 'sheets/special_2.png',
  };

  // Frame counts: start from the draft's declared counts (the canonical 5 the AI
  // sets at creation), then OVERLAY the fighter-pack manifest's counts. The
  // manifest is the ground truth for what has actually been extracted, so any
  // row generated later in the admin (walk_forward/walk_back/jump/crouch/block/
  // dash/grab/throw) renders once its frames exist — without it, a draft that
  // declares frameCounts would mask every generated row (they only ever land in
  // the manifest). Rows that are neither declared nor extracted stay absent, so
  // the engine falls back to base instead of a missing texture.
  const declaredFrameCounts = sprite.frameCounts ?? {
    base: 6,
    punch: 6,
    kick: 6,
    special_1: 6,
    special_2: 6,
  };
  const frameCounts = { ...declaredFrameCounts, ...(manifest?.frameCounts ?? {}) };

  return {
    basePath: `/fighters/${id}`,
    scale: scale ?? deriveSpriteScale(sprite, frameData),
    frameCounts,
    sheets,
    frames: frameData?.frames ?? undefined,
    stateFrames: {
      idle: [0, 1],
      walk_forward: [1, 0],
      walk_back: [1, 0],
      crouch: 2,
      airborne: 3,
      landing: 2,
      blockstun: 1,
      hitstun: 4,
      juggle: 3,
      knockdown: 4,
      getup: 2,
      dead: 4,
    },
  };
}

// ---------------------------------------------------------------------------
// Hurtbox generation
// ---------------------------------------------------------------------------

// Which base-row frame each fighter state displays — mirrors the
// stateFrames map in buildSpriteConfig, so the measured hurtbox always
// matches the sprite actually on screen for that state.
const STATE_BASE_FRAME = {
  idle: 0,
  walk_forward: 1,
  walk_back: 1,
  crouch: 2,
  airborne: 3,
  hitstun: 4,
  blockstun: 1,
  juggle: 3,
};

/**
 * Generate hurtboxes from frame data, in world units.
 *
 * Preferred path: each frame's measured silhouette hurtbox (emitted by the
 * extractor, anchor-relative frame pixels) scaled into world units, picked
 * per state via STATE_BASE_FRAME. Falls back to anchor-based heuristics for
 * packs extracted before hurtbox measurement existed, then to hardcoded
 * typical values when there is no frame data at all.
 *
 * @param {object|null} frameData
 * @param {number} scale - render scale converting frame pixels to world units
 * @returns {object} Partial record of FighterState -> Hurtbox
 */
export function generateDefaultHurtboxes(frameData, scale = 1) {
  const baseFrames = frameData?.frames?.base;
  if (!baseFrames?.length) {
    return {
      idle: { x: -25, y: -120, width: 50, height: 120 },
      walk_forward: { x: -25, y: -120, width: 50, height: 120 },
      walk_back: { x: -25, y: -120, width: 50, height: 120 },
      crouch: { x: -30, y: -80, width: 60, height: 80 },
      attack: { x: -28, y: -122, width: 56, height: 122 },
      airborne: { x: -24, y: -110, width: 48, height: 110 },
      hitstun: { x: -26, y: -118, width: 52, height: 118 },
      blockstun: { x: -26, y: -118, width: 52, height: 118 },
      juggle: { x: -24, y: -110, width: 48, height: 110 },
    };
  }

  const measured = baseFrames.some((frame) => frame?.hurtbox);
  if (measured) {
    const worldBoxFor = (frameIndex, pad = 0) => {
      const frame = baseFrames[Math.min(frameIndex, baseFrames.length - 1)];
      const box = frame?.hurtbox ?? baseFrames.find((candidate) => candidate?.hurtbox)?.hurtbox;
      return {
        x: Math.round(box.x * scale) - pad,
        y: Math.round(box.y * scale) - pad,
        width: Math.max(1, Math.round(box.width * scale)) + pad * 2,
        height: Math.max(1, Math.round(box.height * scale)) + pad,
      };
    };

    const hurtboxes = {};
    for (const [state, frameIndex] of Object.entries(STATE_BASE_FRAME)) {
      hurtboxes[state] = worldBoxFor(frameIndex);
    }
    // While attacking the body still occupies the idle envelope; the extended
    // limb is the hitbox's business, not the hurtbox's.
    hurtboxes.attack = worldBoxFor(STATE_BASE_FRAME.idle, 2);
    return hurtboxes;
  }

  // Legacy heuristic path (no measured hurtboxes): estimate from the first
  // base frame's proportions, then convert frame pixels to world units.
  // Width ≈ 20% of frame width (this is the half-width)
  // Height ≈ anchor.y * 0.85 (feet-to-top body height estimate)
  const frame = baseFrames[0];
  const bodyWidth = Math.round(frame.width * 0.2 * scale);
  const bodyHeight = Math.round(frame.anchor.y * 0.85 * scale);

  return {
    idle: { x: -bodyWidth, y: -bodyHeight, width: bodyWidth * 2, height: bodyHeight },
    walk_forward: { x: -bodyWidth, y: -bodyHeight, width: bodyWidth * 2, height: bodyHeight },
    walk_back: { x: -bodyWidth, y: -bodyHeight, width: bodyWidth * 2, height: bodyHeight },
    crouch: {
      x: -(bodyWidth + 4),
      y: -Math.round(bodyHeight * 0.65),
      width: (bodyWidth + 4) * 2,
      height: Math.round(bodyHeight * 0.65),
    },
    attack: {
      x: -(bodyWidth + 2),
      y: -(bodyHeight + 2),
      width: (bodyWidth + 2) * 2,
      height: bodyHeight + 2,
    },
    airborne: {
      x: -bodyWidth,
      y: -Math.round(bodyHeight * 0.92),
      width: bodyWidth * 2,
      height: Math.round(bodyHeight * 0.92),
    },
    hitstun: {
      x: -bodyWidth,
      y: -Math.round(bodyHeight * 0.96),
      width: bodyWidth * 2,
      height: Math.round(bodyHeight * 0.96),
    },
    blockstun: {
      x: -bodyWidth,
      y: -Math.round(bodyHeight * 0.96),
      width: bodyWidth * 2,
      height: Math.round(bodyHeight * 0.96),
    },
    juggle: {
      x: -bodyWidth,
      y: -Math.round(bodyHeight * 0.92),
      width: bodyWidth * 2,
      height: Math.round(bodyHeight * 0.92),
    },
  };
}

// ---------------------------------------------------------------------------
// Move conversion
// ---------------------------------------------------------------------------

/**
 * Convert a draft move to the runtime Move format.
 *
 * @param {object} draftMove
 * @param {{ frameData?: object|null, scale?: number }} [context]
 * @returns {object} Runtime Move object
 */
function convertMove(draftMove, context = {}) {
  const moveId = draftMove.id;
  const phases = (draftMove.phases ?? []).map((draftPhase, phaseIndex) =>
    convertPhase(draftPhase, phaseIndex, moveId, draftMove.phases)
  );

  const animation = draftMove.animation ?? 'punch';
  const move = {
    id: moveId,
    displayName: draftMove.displayName ?? moveId,
    animation,
    trigger: {
      allowedStates: draftMove.trigger?.allowedStates ?? ['idle', 'walk_forward', 'walk_back'],
      sequence: expandTriggerSequence(draftMove.trigger?.sequence ?? [], animation),
      window: draftMove.trigger?.window ?? 14,
    },
    phases,
    cancelInto: draftMove.cancelInto ?? [],
  };
  if (Array.isArray(draftMove.visualTimeline) && draftMove.visualTimeline.length) {
    move.visualTimeline = draftMove.visualTimeline;
  }

  // Carve disabled frames out of active windows BEFORE measuring geometry, so each
  // surviving sub-window gets its own geometry track.
  applyDisabledHitboxFrames(move, context.frameData?.frames?.[animation]);
  applyMeasuredHitboxGeometry(move, context.frameData?.frames?.[animation], context.scale ?? 1);
  // Gym geometry overrides win over the measured pass (D2/A4).
  applyHitboxOverrides(move, context.hitboxOverrides, context.scale ?? 1);
  return move;
}

// ---------------------------------------------------------------------------
// Measured hitbox geometry
// ---------------------------------------------------------------------------

/**
 * Sprite frame shown at a given gameplay tick of a move — mirrors
 * Fighter.getMoveSpriteFrame: explicit visualTimeline wins, else the row
 * plays evenly across the move's total duration.
 */
function spriteFrameAt(elapsed, totalFrames, frameCount, visualTimeline) {
  const clampFrame = (value) => Math.min(frameCount - 1, Math.max(0, value));
  if (visualTimeline?.length) {
    let cursor = 0;
    for (const visualFrame of visualTimeline) {
      cursor += visualFrame.duration;
      if (elapsed < cursor) return clampFrame(visualFrame.frame);
    }
    return clampFrame(visualTimeline[visualTimeline.length - 1].frame);
  }
  return clampFrame(Math.floor((elapsed / Math.max(totalFrames, 1)) * frameCount));
}

/** Nearest frame with a usable attackBox, searching outward from index. */
function attackBoxNear(rowFrames, index) {
  for (let distance = 0; distance < rowFrames.length; distance++) {
    for (const candidate of [index - distance, index + distance]) {
      const box = rowFrames[candidate]?.attackBox;
      if (box && box.width > 0 && box.height > 0) return box;
    }
  }
  return null;
}

/**
 * Replace AI-guessed hitbox geometry with boxes measured from the sprite
 * silhouettes: for each hitbox's active window, the geometry tracks the
 * attackBox of whichever sprite frame is on screen, emitted as keyframes
 * (MoveExecutor interpolates them). The AI keeps authoring damage, hitstun,
 * and knockback — gameplay numbers, not geometry.
 */
function applyMeasuredHitboxGeometry(move, rowFrames, scale) {
  if (!Array.isArray(rowFrames) || !rowFrames.some((frame) => frame?.attackBox)) return;

  const totalFrames = move.phases.reduce((sum, phase) => sum + (phase.frames ?? 1), 0);
  const frameCount = rowFrames.length;

  // Resolve each hitbox activation's [start, end) tick window.
  const activations = [];
  const open = new Map();
  let offset = 0;
  for (const phase of move.phases) {
    for (const entry of phase.events ?? []) {
      const tick = offset + (entry.onFrame ?? 0);
      const event = entry.event;
      if (event?.type === 'hitbox_active' && event.hitbox) {
        open.set(event.id ?? 'default', { event, startTick: tick });
      } else if (event?.type === 'hitbox_end') {
        const activation = open.get(event.id ?? 'default');
        if (activation) {
          activations.push({ ...activation, endTick: tick });
          open.delete(event.id ?? 'default');
        }
      }
    }
    offset += phase.frames ?? 1;
  }
  for (const activation of open.values()) {
    activations.push({ ...activation, endTick: totalFrames });
  }

  for (const { event, startTick, endTick } of activations) {
    const track = [];
    let lastSpriteFrame = -1;
    for (let tick = startTick; tick < Math.max(endTick, startTick + 1); tick++) {
      const spriteFrame = spriteFrameAt(tick, totalFrames, frameCount, move.visualTimeline);
      if (spriteFrame === lastSpriteFrame) continue;
      lastSpriteFrame = spriteFrame;
      const box = attackBoxNear(rowFrames, spriteFrame);
      if (box) track.push({ atFrame: tick - startTick, ...scaleBox(box, scale) });
    }
    if (!track.length) continue;

    const { atFrame: _first, ...baseGeometry } = track[0];
    Object.assign(event.hitbox, baseGeometry);
    if (track.length > 1) {
      event.keyframes = track;
    } else {
      delete event.keyframes;
    }
  }
}

/** Deep-clone a hitbox_active event for a split sub-window (drop transient/derived fields). */
function cloneHitboxEvent(event) {
  const clone = JSON.parse(JSON.stringify(event));
  delete clone.disabledFrames;
  delete clone.keyframes; // recomputed per sub-window by applyMeasuredHitboxGeometry
  return clone;
}

/**
 * Carve disabled sprite-frames out of a hitbox's active window so the move does
 * NOT hit on those frames (gym "Delete hit on frame"). The active window comes
 * from the move's hitbox_active/hitbox_end events; `event.disabledFrames` lists
 * sprite-frame indices to drop. For each activation we:
 *   1. walk its [startTick, endTick) window, mapping every tick to a sprite frame
 *      (same mapping the runtime uses), and split it into the contiguous runs of
 *      NON-disabled ticks;
 *   2. replace the single active/end pair with one pair per surviving run.
 * All sub-windows keep the same hitbox id, so hit-dedup still allows only one hit
 * per move (the standard fighting-game default). Runs before the measured-geometry
 * pass so each sub-window gets its own geometry track. Requires frame data to map
 * ticks→frames; without it the disable is a no-op (and the field is stripped).
 */
function applyDisabledHitboxFrames(move, rowFrames) {
  const phases = move.phases ?? [];
  const frameCount = Array.isArray(rowFrames) ? rowFrames.length : 0;

  // Phase tick boundaries: phase i covers ticks [start, start+frames).
  const bounds = [];
  let cum = 0;
  for (let i = 0; i < phases.length; i++) {
    const frames = phases[i].frames ?? 1;
    bounds.push({ index: i, start: cum, frames });
    cum += frames;
  }
  const totalFrames = cum;
  const tickToLocation = (tick) => {
    for (const b of bounds) {
      if (tick >= b.start && tick < b.start + b.frames) return { phaseIndex: b.index, onFrame: tick - b.start };
    }
    const last = bounds[bounds.length - 1]; // tick === totalFrames: end-of-move (non-firing; move-end clears).
    return { phaseIndex: last.index, onFrame: last.frames };
  };

  // Pair each hitbox_active with its hitbox_end, capturing both event refs + locations.
  const open = new Map();
  const activations = [];
  for (const b of bounds) {
    for (const entry of phases[b.index].events ?? []) {
      const tick = b.start + (entry.onFrame ?? 0);
      const ev = entry.event;
      if (ev?.type === 'hitbox_active' && ev.hitbox) {
        open.set(ev.id ?? 'default', { id: ev.id ?? 'default', event: ev, activeEntry: entry, activePhase: b.index, startTick: tick });
      } else if (ev?.type === 'hitbox_end') {
        const a = open.get(ev.id ?? 'default');
        if (a) { activations.push({ ...a, endEntry: entry, endPhase: b.index, endTick: tick }); open.delete(ev.id ?? 'default'); }
      }
    }
  }
  for (const a of open.values()) activations.push({ ...a, endEntry: null, endPhase: null, endTick: totalFrames });

  const removals = new Set();
  const additions = []; // { phaseIndex, onFrame, event }

  for (const act of activations) {
    const disabled = act.event.disabledFrames;
    delete act.event.disabledFrames; // strip transient field whether or not we carve
    if (!Array.isArray(disabled) || !disabled.length || !frameCount) continue;
    const disabledSet = new Set(disabled);

    // Contiguous runs of non-disabled ticks within the window.
    const ranges = [];
    let runStart = null;
    for (let tick = act.startTick; tick < act.endTick; tick++) {
      const sf = spriteFrameAt(tick, totalFrames, frameCount, move.visualTimeline);
      if (!disabledSet.has(sf)) { if (runStart === null) runStart = tick; }
      else if (runStart !== null) { ranges.push([runStart, tick]); runStart = null; }
    }
    if (runStart !== null) ranges.push([runStart, act.endTick]);

    // Nothing actually disabled inside the window → leave the events untouched.
    if (ranges.length === 1 && ranges[0][0] === act.startTick && ranges[0][1] === act.endTick) continue;

    removals.add(act.activeEntry);
    if (act.endEntry) removals.add(act.endEntry);

    for (const [s, e] of ranges) {
      const activeLoc = s === act.startTick
        ? { phaseIndex: act.activePhase, onFrame: act.activeEntry.onFrame ?? 0 }
        : tickToLocation(s);
      additions.push({ ...activeLoc, event: cloneHitboxEvent(act.event) });

      let endLoc;
      if (e === act.endTick && act.endEntry) endLoc = { phaseIndex: act.endPhase, onFrame: act.endEntry.onFrame ?? 0 };
      else if (e >= totalFrames) endLoc = null; // ends at move end — clears implicitly
      else endLoc = tickToLocation(e);
      if (endLoc) additions.push({ ...endLoc, event: { type: 'hitbox_end', id: act.id } });
    }
  }

  if (!removals.size && !additions.length) return;

  for (let i = 0; i < phases.length; i++) {
    const events = (phases[i].events ?? []).filter((entry) => !removals.has(entry));
    for (const add of additions) {
      if (add.phaseIndex === i) events.push({ onFrame: add.onFrame, event: add.event });
    }
    events.sort((a, b) => (a.onFrame ?? 0) - (b.onFrame ?? 0));
    phases[i].events = events;
  }
}

/**
 * Convert a draft phase.
 * The spec says: "Always generate hitbox_end events at the start of recovery phases."
 * This is done by collecting all hitbox ids that were activated but not yet ended
 * through all prior phases, then synthesizing hitbox_end events at frame 0 of
 * any "recovery" phase (or last phase if > 2 phases exist).
 *
 * @param {object} draftPhase
 * @param {number} phaseIndex
 * @param {string} moveId
 * @param {object[]} allPhases - all phases of this move (for hitbox tracking)
 * @returns {object} Runtime MovePhase object
 */
function convertPhase(draftPhase, phaseIndex, moveId, allPhases) {
  const phaseName = draftPhase.name ?? `phase_${phaseIndex}`;
  const isRecoveryPhase = phaseName === 'recovery' || (phaseIndex > 0 && phaseIndex === allPhases.length - 1 && allPhases.length >= 3);

  const convertedEvents = (draftPhase.events ?? []).map((e, eventIndex) => ({
    onFrame: e.frame ?? e.onFrame ?? 0,
    event: convertEvent(e.event, moveId, phaseIndex, eventIndex),
  }));

  // Collect hitbox ids activated in all prior phases and not yet ended
  const activeIds = collectUnclosedHitboxIds(allPhases, phaseIndex, moveId);

  // Synthesize hitbox_end events at frame 0 for any still-active hitboxes
  const synthesizedEnds = isRecoveryPhase
    ? activeIds
        .filter((id) => !convertedEvents.some(
          (e) => e.onFrame === 0 && e.event.type === 'hitbox_end' && (e.event.id === id || (!e.event.id && id === 'default'))
        ))
        .map((id) => ({
          onFrame: 0,
          event: id === 'default' ? { type: 'hitbox_end' } : { type: 'hitbox_end', id },
        }))
    : [];

  return {
    name: phaseName,
    frames: draftPhase.frames ?? 1,
    cancellable: draftPhase.cancellable ?? phaseName === 'recovery',
    events: [...synthesizedEnds, ...convertedEvents],
  };
}

/**
 * Walk phases 0..(targetPhaseIndex-1) and return hitbox ids that were activated
 * but not explicitly ended.
 *
 * @param {object[]} allPhases - raw draft phases
 * @param {number} targetPhaseIndex
 * @param {string} moveId
 * @returns {string[]}
 */
function collectUnclosedHitboxIds(allPhases, targetPhaseIndex, moveId) {
  const active = new Set();

  for (let pi = 0; pi < targetPhaseIndex; pi++) {
    const phase = allPhases[pi];
    for (let ei = 0; ei < (phase.events ?? []).length; ei++) {
      const e = phase.events[ei];
      const event = e.event ?? e;
      if (event.type === 'hitbox_active') {
        // Mirror MoveExecutor's (event.id ?? 'default') fallback for consistency
        const id = event.id ?? 'default';
        active.add(id);
      } else if (event.type === 'hitbox_end') {
        // hitbox_end with no id clears 'default' in the runtime
        active.delete(event.id ?? 'default');
      }
    }
  }

  return [...active];
}

/**
 * Convert a single draft event to the runtime MoveEvent format.
 *
 * @param {object} draftEvent
 * @param {string} moveId
 * @param {number} phaseIndex
 * @param {number} eventIndex
 * @returns {object} Runtime MoveEvent
 */
function convertEvent(draftEvent, moveId, phaseIndex, eventIndex) {
  if (!draftEvent) return { type: 'hitbox_end' };

  // Some drafts (older schema versions, lenient models) say `hitbox` instead
  // of `hitbox_active`. A hitbox payload makes the intent unambiguous.
  if ((draftEvent.type === 'hitbox_active' || draftEvent.type === 'hitbox') && draftEvent.hitbox) {
    const hb = draftEvent.hitbox;
    const hitstun = hb.hitstun ?? hb.stun ?? 14;
    // Use 'default' when no id is specified — mirrors MoveExecutor's (event.id ?? 'default') fallback.
    // This ensures hitbox_end events with no id correctly pair with these hitboxes.
    const hitboxId = draftEvent.id ?? 'default';

    const converted = {
      type: 'hitbox_active',
      id: hitboxId,
      hitbox: {
        x: hb.x,
        y: hb.y,
        width: hb.width,
        height: hb.height,
        damage: hb.damage,
        hitstun,
        blockstun: hb.blockstun ?? Math.round(hitstun * 0.6),
        knockback: {
          x: hb.knockbackX ?? hb.knockback?.x ?? 4,
          y: hb.knockbackY ?? hb.knockback?.y ?? 0,
        },
        level: hb.level ?? 'mid',
      },
    };
    if (Array.isArray(draftEvent.keyframes) && draftEvent.keyframes.length) {
      converted.keyframes = draftEvent.keyframes
        .filter((kf) => kf && typeof kf.atFrame === 'number')
        .map((kf) => ({ atFrame: kf.atFrame, x: kf.x, y: kf.y, width: kf.width, height: kf.height }));
    }
    // Carry per-frame disabling onto the converted event as transient metadata.
    // applyDisabledHitboxFrames reads it to split the active window, then strips
    // it so it never reaches the runtime config.
    if (Array.isArray(hb.disabledFrames) && hb.disabledFrames.length) {
      converted.disabledFrames = hb.disabledFrames.filter((n) => Number.isInteger(n) && n >= 0);
    }
    return converted;
  }

  if (draftEvent.type === 'hitbox_end') {
    const result = { type: 'hitbox_end' };
    if (draftEvent.id) result.id = draftEvent.id;
    return result;
  }

  // T23: a spawn event can reference a first-class projectile ENTITY on the
  // draft (draft.projectiles) by id instead of carrying an inline projectile.
  // Pass the reference through verbatim (preserving the spawn variant + its
  // offset fields); resolveProjectileEntities fills in the resolved config in a
  // post-pass that has access to draft.projectiles.
  if (draftEvent.projectileId && !draftEvent.projectile) {
    const type = draftEvent.type ?? 'spawn_projectile';
    const ref = { type, projectileId: draftEvent.projectileId };
    // Default the spawn variant's offset fields so the runtime never receives
    // `undefined` offsets (MoveExecutor.spawn would mis-position the shot). The
    // inline-projectile path below already defaults offsetX/offsetY; mirror that
    // here for the entity-reference path, per variant.
    const num = (value, fallback) => (typeof value === 'number' ? value : fallback);
    if (type === 'spawn_projectile_from_sky') {
      ref.targetOffsetX = num(draftEvent.targetOffsetX, 0);
      ref.spawnOffsetY = num(draftEvent.spawnOffsetY, -360);
    } else {
      ref.offsetX = num(draftEvent.offsetX, 40);
      ref.offsetY = num(draftEvent.offsetY, -60);
    }
    return ref;
  }

  if (draftEvent.projectile) {
    const proj = draftEvent.projectile;
    const hitboxDamage = proj.damage ?? 60;
    return {
      type: 'spawn_projectile',
      offsetX: draftEvent.offsetX ?? 40,
      offsetY: draftEvent.offsetY ?? -60,
      projectile: {
        id: proj.id ?? `${moveId}_projectile`,
        animation: 'special_2',
        width: 32,
        height: 32,
        speed: proj.speedX ?? proj.speed ?? 6,
        velocity: {
          x: proj.speedX ?? proj.speed ?? 6,
          y: proj.speedY ?? 0,
          relativeToFacing: true,
        },
        lifetime: proj.lifetime ?? 120,
        hitbox: {
          x: -16,
          y: -16,
          width: 32,
          height: 32,
          damage: hitboxDamage,
          hitstun: proj.hitstun ?? 18,
          blockstun: proj.blockstun ?? 12,
          knockback: { x: proj.knockbackX ?? 3, y: proj.knockbackY ?? 0 },
          level: proj.level ?? 'mid',
        },
      },
    };
  }

  // A spawn event that reached here has NEITHER an inline projectile NOR a
  // projectileId (both branches above bailed). Emitting a bare
  // `{ type: 'spawn_projectile' }` would make MoveExecutor.spawn pass
  // `undefined` to ProjectilePool, which dereferences config.spawnPolicy and
  // crashes (codex P1). The schema makes projectileId required-but-nullable, so
  // a model can produce exactly this. Neutralize it to a no-op hitbox_end.
  if (typeof draftEvent.type === 'string' && draftEvent.type.startsWith('spawn_projectile')) {
    return { type: 'hitbox_end' };
  }

  // Pass through known non-hitbox event types
  if (draftEvent.type === 'set_velocity' || draftEvent.type === 'teleport' ||
      draftEvent.type === 'invulnerable' || draftEvent.type === 'armor' ||
      draftEvent.type === 'screen_shake' || draftEvent.type === 'play_sound' ||
      draftEvent.type === 'spawn_vfx' || draftEvent.type === 'modify_hurtbox' ||
      draftEvent.type === 'grab_check' || draftEvent.type === 'grab_end') {
    return { ...draftEvent };
  }

  // Fallback: pass type through, default to hitbox_end if unknown
  return { type: draftEvent.type ?? 'hitbox_end' };
}

/**
 * Normalize AI-generated input token strings to valid InputToken values.
 *
 * @param {string} token
 * @returns {string}
 */
export function normalizeInputToken(token) {
  const map = {
    light_punch: 'lp',
    lp: 'lp',
    punch: 'lp', // bare "punch" shorthand -> light punch (F / J)
    medium_punch: 'mp',
    mp: 'mp',
    heavy_punch: 'hp',
    hp: 'hp',
    light_kick: 'lk',
    lk: 'lk',
    kick: 'lk', // bare "kick" shorthand -> light kick (G / K)
    medium_kick: 'mk',
    mk: 'mk',
    heavy_kick: 'hk',
    hk: 'hk',
    forward: 'forward',
    back: 'back',
    down: 'down',
    up: 'up',
    'down-forward': 'down-forward',
    'down-back': 'down-back',
    'up-forward': 'up-forward',
    'up-back': 'up-back',
    neutral: 'neutral',
    grab: 'grab',   // LP+LK simultaneous input — valid engine token
    throw: 'throw', // placeholder; expandTriggerSequence rewrites this
  };
  const lower = String(token).toLowerCase();
  return map[lower] ?? token;
}

/**
 * LOCKED control-scheme expansion (must match what InputBuffer emits):
 *   special_1  → [down, forward, lp]
 *   special_2  → [down, forward, lk]
 *   grab       → [grab]
 *   throw      → [forward, grab]   (command grab)
 *
 * The expansion is only applied when the raw token equals the move's own
 * `animation` field — that's the CMS sentinel that means "use the default
 * motion for this slot." Already-correct directional sequences (e.g. el_cometa's
 * rising_star_uppercut → ['forward','down','forward','lp']) don't contain these
 * literals, so they pass through normalizeInputToken unchanged.
 *
 * @param {string[]} rawSequence  Tokens as authored by the CMS agent
 * @param {string} animation      The move's animation sheet id (e.g. 'special_1')
 * @returns {string[]} Expanded, normalised sequence
 */
export function expandTriggerSequence(rawSequence, animation) {
  /** Tokens that are CMS sentinels and must be rewritten 1→many. */
  const LITERAL_EXPANSIONS = {
    special_1: ['down', 'forward', 'lp'],
    special_2: ['down', 'forward', 'lk'],
    grab: ['grab'],
    throw: ['forward', 'grab'],
  };

  // If the sequence is a single literal sentinel that matches the animation slot,
  // replace it with the canonical motion. This is the common CMS output pattern
  // (e.g. sequence: ['special_1'] for a move whose animation is 'special_1').
  // Also handle cases where the literal appears anywhere in the sequence.
  const expanded = rawSequence.flatMap((token) => {
    const lower = String(token).toLowerCase();
    const expansion = LITERAL_EXPANSIONS[lower];
    if (expansion) return expansion;
    return [normalizeInputToken(token)];
  });

  // If the sequence was empty AND the animation is a known literal, synthesise
  // the default motion (CMS omitted the trigger entirely).
  if (expanded.length === 0) {
    const fallback = LITERAL_EXPANSIONS[animation];
    if (fallback) return [...fallback];
  }

  return expanded;
}
