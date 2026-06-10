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

export function convertDraftToCharacterConfig({ draft, frameData, manifest: rawManifest }) {
  if (!draft) throw new Error('convertDraftToCharacterConfig: draft is required');

  const id = draft.id;
  if (!id) throw new Error('convertDraftToCharacterConfig: draft.id is required');

  const manifest = normalizeManifest(rawManifest, { id });
  const stats = draft.stats ?? {};

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
    sprite: buildSpriteConfig({ draft, frameData, manifest }),
    hurtboxes: generateDefaultHurtboxes(frameData),
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
    moves: (draft.moves ?? []).map((draftMove) => convertMove(draftMove)),
  };
}

// ---------------------------------------------------------------------------
// Sprite config builder
// ---------------------------------------------------------------------------

function buildSpriteConfig({ draft, frameData, manifest }) {
  const sprite = draft.sprite ?? {};
  const id = draft.id;

  const sheets = manifest?.sheets ?? {
    base: 'sheets/base.png',
    punch: 'sheets/punch.png',
    kick: 'sheets/kick.png',
    special_1: 'sheets/special_1.png',
    special_2: 'sheets/special_2.png',
  };

  return {
    basePath: `/fighters/${id}`,
    scale: sprite.scale ?? 0.55,
    frameCounts: sprite.frameCounts ?? manifest?.frameCounts ?? {
      base: 6,
      punch: 6,
      kick: 6,
      special_1: 6,
      special_2: 6,
    },
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

/**
 * Generate reasonable default hurtboxes from frame data.
 * If no frame data is available, falls back to hardcoded typical values.
 *
 * @param {object|null} frameData
 * @returns {object} Partial record of FighterState -> Hurtbox
 */
export function generateDefaultHurtboxes(frameData) {
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

  // Use the first base frame's anchor to estimate body proportions:
  // Width ≈ 20% of frame width (this is the half-width)
  // Height ≈ anchor.y * 0.85 (feet-to-top body height estimate)
  const frame = baseFrames[0];
  const bodyWidth = Math.round(frame.width * 0.2);
  const bodyHeight = Math.round(frame.anchor.y * 0.85);

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
 * @returns {object} Runtime Move object
 */
function convertMove(draftMove) {
  const moveId = draftMove.id;
  const phases = (draftMove.phases ?? []).map((draftPhase, phaseIndex) =>
    convertPhase(draftPhase, phaseIndex, moveId, draftMove.phases)
  );

  return {
    id: moveId,
    displayName: draftMove.displayName ?? moveId,
    animation: draftMove.animation ?? 'punch',
    trigger: {
      allowedStates: draftMove.trigger?.allowedStates ?? ['idle', 'walk_forward', 'walk_back'],
      sequence: (draftMove.trigger?.sequence ?? []).map(normalizeInputToken),
      window: draftMove.trigger?.window ?? 6,
    },
    phases,
    cancelInto: draftMove.cancelInto ?? [],
  };
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

  if (draftEvent.type === 'hitbox_active' && draftEvent.hitbox) {
    const hb = draftEvent.hitbox;
    const hitstun = hb.hitstun ?? 14;
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
    return converted;
  }

  if (draftEvent.type === 'hitbox_end') {
    const result = { type: 'hitbox_end' };
    if (draftEvent.id) result.id = draftEvent.id;
    return result;
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
    medium_punch: 'mp',
    mp: 'mp',
    heavy_punch: 'hp',
    hp: 'hp',
    light_kick: 'lk',
    lk: 'lk',
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
  };
  const lower = String(token).toLowerCase();
  return map[lower] ?? token;
}
