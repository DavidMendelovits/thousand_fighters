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
  const scale = deriveSpriteScale(draft.sprite ?? {}, frameData);

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
    hurtboxes: generateDefaultHurtboxes(frameData, scale),
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
    moves: (draft.moves ?? []).map((draftMove) => convertMove(draftMove, { frameData, scale })),
  };
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

  return {
    basePath: `/fighters/${id}`,
    scale: scale ?? deriveSpriteScale(sprite, frameData),
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
      sequence: (draftMove.trigger?.sequence ?? []).map(normalizeInputToken),
      window: draftMove.trigger?.window ?? 6,
    },
    phases,
    cancelInto: draftMove.cancelInto ?? [],
  };
  if (Array.isArray(draftMove.visualTimeline) && draftMove.visualTimeline.length) {
    move.visualTimeline = draftMove.visualTimeline;
  }

  applyMeasuredHitboxGeometry(move, context.frameData?.frames?.[animation], context.scale ?? 1);
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

  const toWorld = (box) => ({
    x: Math.round(box.x * scale),
    y: Math.round(box.y * scale),
    width: Math.max(1, Math.round(box.width * scale)),
    height: Math.max(1, Math.round(box.height * scale)),
  });

  for (const { event, startTick, endTick } of activations) {
    const track = [];
    let lastSpriteFrame = -1;
    for (let tick = startTick; tick < Math.max(endTick, startTick + 1); tick++) {
      const spriteFrame = spriteFrameAt(tick, totalFrames, frameCount, move.visualTimeline);
      if (spriteFrame === lastSpriteFrame) continue;
      lastSpriteFrame = spriteFrame;
      const box = attackBoxNear(rowFrames, spriteFrame);
      if (box) track.push({ atFrame: tick - startTick, ...toWorld(box) });
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
