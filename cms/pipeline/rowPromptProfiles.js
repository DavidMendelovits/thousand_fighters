// Per-row image-generation guidance, shared by both image adapters (codex +
// OpenAI Responses) so new rows get sensible animation arcs from one source
// instead of duplicated inline maps (T21).
//
// CRITICAL — the frame roles here MUST agree with the engine's playback
// convention in src/core/animationRowPlayback.ts. State-driven rows
// (jump/crouch/block) play one-shot and HOLD THE LAST FRAME, so the FINAL frame
// must be the settled/held pose (settled crouch, raised guard, falling/airborne
// pose). If the prompt says "frame 6 = recovery to standing" but the engine
// holds frame 6 during a sustained crouch, it looks broken.

import { SHEET_IDS } from '../../shared/animationRows.js';

// Shared attack arc (canonical normals/specials) — unchanged wording from the
// pre-T21 adapters so existing generation is behavior-preserving.
const ATTACK_ROLES =
  'frames 1-2 = startup/wind-up, frame 3 = reaching toward the target, frame 4 = the MOMENT OF CONTACT (fullest extension/impact), frame 5 = follow-through, frame 6 = recovery back toward neutral';
const ATTACK_SHORT = 'Frame roles: 1-2 startup, 3 reaching, 4 moment of contact, 5 follow-through, 6 recovery.';

// Height-stable rows share this scale note — keep the character the same
// height in every frame so extraction can equalize cleanly.
const STABLE_HEIGHT_NOTE = 'Keep the character the exact same height and scale in every frame; feet on the same floor line.';

/**
 * @typedef {Object} RowPromptProfile
 * @property {string} description   Short move description (the "Animation: ..." slot).
 * @property {string} frameRoles    Verbose per-frame role sentence (multi-line prompt).
 * @property {string} shortRoles    One-line role note (terse prompt).
 * @property {boolean} [idle]       True for the breathing-loop base row (subtle motion).
 * @property {boolean} [heightDynamic]  True for rows where height legitimately changes
 *                                  (crouch/jump) — these are exempt from frame equalization.
 * @property {string}  [scaleNote]  Height-stability instruction emitted by adapters for
 *                                  height-stable rows; undefined/absent for dynamic rows.
 */

/** @type {Record<string, RowPromptProfile>} */
export const ROW_PROMPT_PROFILES = {
  base: {
    idle: true,
    description: 'base idle stance — subtle breathing/sway animation loop, facing right, neutral pose',
    frameRoles:
      'frame 1 = neutral stance, frames 2-3 = gentle inhale (chest rises slightly), frame 4 = peak of the breath, frames 5-6 = settle back to neutral so the loop closes cleanly',
    shortRoles:
      'This is an IDLE LOOP: motion between frames must be subtle — a few pixels of breathing and sway, feet planted on the same floor spot, silhouette near-identical across all 6 frames. Frame roles: 1 neutral, 2-3 gentle inhale, 4 peak of breath, 5-6 settle back to neutral.',
    scaleNote: STABLE_HEIGHT_NOTE,
  },
  punch: { description: 'punch attack — wind-up, extension, contact, follow-through, recovery frames', frameRoles: ATTACK_ROLES, shortRoles: ATTACK_SHORT, scaleNote: STABLE_HEIGHT_NOTE },
  kick: { description: 'kick attack — chamber, extension, contact, follow-through, recovery frames', frameRoles: ATTACK_ROLES, shortRoles: ATTACK_SHORT, scaleNote: STABLE_HEIGHT_NOTE },
  special_1: { description: 'special move 1 — dramatic startup, active frames with effect/projectile, recovery', frameRoles: ATTACK_ROLES, shortRoles: ATTACK_SHORT, scaleNote: STABLE_HEIGHT_NOTE },
  special_2: { description: 'special move 2 — dramatic startup, active frames with effect/projectile, recovery', frameRoles: ATTACK_ROLES, shortRoles: ATTACK_SHORT, scaleNote: STABLE_HEIGHT_NOTE },

  // T21 rows. State-driven rows (jump/crouch/block) end on the HELD pose to
  // match the engine's hold-last playback.
  // jump and crouch are height-DYNAMIC — the character legitimately changes
  // height, so heightDynamic=true exempts them from frame equalization.
  jump: {
    description: 'jump — the airborne arc: crouch-load, push-off, rising, apex, then descent',
    frameRoles:
      'frame 1 = crouch-load anticipation, frame 2 = push-off leaving the ground, frame 3 = rising, frame 4 = apex at peak height, frame 5 = beginning to descend, frame 6 = falling/descent pose (the held airborne pose the engine holds while falling)',
    shortRoles: 'Frame roles: 1 crouch-load, 2 push-off, 3 rising, 4 apex, 5 descending, 6 falling pose (held).',
    heightDynamic: true,
  },
  crouch: {
    description: 'crouch — lowering from standing into a fully settled, held crouch',
    frameRoles:
      'frame 1 = standing, frames 2-3 = bending the knees and dropping the hips, frames 4-5 = lowering further, frame 6 = fully settled crouch (the held pose the engine holds while crouching)',
    shortRoles: 'Frame roles: 1 standing, 2-3 bending, 4-5 lowering, 6 settled crouch (held).',
    heightDynamic: true,
  },
  dash_forward: {
    description: 'dash forward — an explosive forward burst that recovers to neutral',
    frameRoles:
      'frame 1 = forward lean/anticipation, frames 2-3 = explosive push forward, frame 4 = full forward stride/extension, frames 5-6 = recover back toward neutral',
    shortRoles: 'Frame roles: 1 lean, 2-3 burst forward, 4 full stride, 5-6 recover.',
    scaleNote: STABLE_HEIGHT_NOTE,
  },
  dash_back: {
    description: 'dash back — an explosive backward hop/retreat that recovers to neutral',
    frameRoles:
      'frame 1 = backward lean/anticipation, frames 2-3 = explosive push backward, frame 4 = full backward extension, frames 5-6 = recover back toward neutral',
    shortRoles: 'Frame roles: 1 lean back, 2-3 burst backward, 4 full retreat, 5-6 recover.',
    scaleNote: STABLE_HEIGHT_NOTE,
  },
  block: {
    description: 'block — raising into a fully settled, held defensive guard',
    frameRoles:
      'frame 1 = reacting, frames 2-3 = raising the guard, frames 4-5 = guard nearly up, frame 6 = fully settled defensive guard (the held pose the engine holds during blockstun)',
    shortRoles: 'Frame roles: 1 react, 2-3 raise guard, 4-5 guard up, 6 settled guard (held).',
    scaleNote: STABLE_HEIGHT_NOTE,
  },
  grab: {
    description: 'grab — this single fighter alone mimes a grab on empty air: reach out, close both hands on nothing, and hold the clench. NO second character, no opponent, no other body anywhere — only this one fighter',
    frameRoles:
      'ONLY this one fighter is in frame (no opponent, no second body): frames 1-2 = reach/lunge forward into empty air, frame 3 = hand extends forward toward nothing, frame 4 = hands clench shut on empty air (the grab mime, gripping an invisible target), frame 5 = pulling the clenched hands inward, frame 6 = holding the clench with both hands closed on nothing',
    shortRoles: 'SINGLE fighter only — no opponent or second body in any frame; the fighter mimes the grab on empty air. Frame roles: 1-2 reach, 3 extend hand, 4 hands clench shut on nothing, 5 pull in, 6 hold the clench.',
    scaleNote: STABLE_HEIGHT_NOTE,
  },
  throw: {
    description: 'throw — this single fighter alone mimes a throw on empty air: wind up the arms as if holding something, heave the empty hands up and forward, release into nothing, and recover. NO second character, no opponent, no thrown body — only this one fighter',
    frameRoles:
      'ONLY this one fighter is in frame (no opponent, no second body, nothing held): frames 1-2 = wind-up, arms drawn back as if gripping an invisible weight, frame 3 = heaving the empty hands up and forward (lift/spin the mime), frame 4 = arms snap open releasing into empty air at peak force, frame 5 = follow-through with open empty hands, frame 6 = recovery toward neutral',
    shortRoles: 'SINGLE fighter only — no opponent, no second body, nothing actually held; the fighter mimes the throw on empty air. Frame roles: 1-2 wind-up (empty grip), 3 heave up/forward, 4 release into nothing, 5 follow-through, 6 recovery.',
    scaleNote: STABLE_HEIGHT_NOTE,
  },

  // Walk rows LOOP (the engine wraps with modulo), so frame 6 must flow back
  // into frame 1 — a continuous step cycle, not a settle-to-neutral arc.
  walk_forward: {
    description: 'walk forward — a seamless looping forward walk cycle, facing right, advancing',
    frameRoles:
      'a 6-frame forward walk LOOP: frame 1 = contact (lead foot plants forward), frames 2-3 = weight shifts onto the lead foot and the body passes over it, frame 4 = the rear foot swings through (opposite contact), frames 5-6 = transition so frame 6 leads cleanly back into frame 1. Feet advance, silhouette translates forward, loop closes seamlessly.',
    shortRoles: 'This is a LOOPING walk cycle: frame 6 must flow back into frame 1. Frame roles: 1 lead-foot contact, 2-3 pass-over, 4 opposite contact, 5-6 cycle back to 1.',
    scaleNote: STABLE_HEIGHT_NOTE,
  },
  walk_back: {
    description: 'walk backward — a seamless looping backward/retreating walk cycle, facing right, stepping back',
    frameRoles:
      'a 6-frame backward walk LOOP: frame 1 = rear foot plants behind, frames 2-3 = weight shifts back, frame 4 = opposite foot steps back (opposite contact), frames 5-6 = transition so frame 6 leads cleanly back into frame 1. The fighter still FACES right but retreats leftward; loop closes seamlessly.',
    shortRoles: 'This is a LOOPING backpedal cycle: frame 6 must flow back into frame 1, still facing right. Frame roles: 1 rear-foot plant, 2-3 weight back, 4 opposite step, 5-6 cycle back to 1.',
    scaleNote: STABLE_HEIGHT_NOTE,
  },
};

/**
 * Resolve the prompt profile for a row id, falling back to a generic attack arc
 * for unknown ids so generation never throws.
 * @param {string | undefined} moveId
 * @returns {RowPromptProfile}
 */
export function rowPromptProfile(moveId) {
  const id = moveId ?? 'base';
  return (
    ROW_PROMPT_PROFILES[id] ?? {
      description: `${id} — a fighting-game move`,
      frameRoles: ATTACK_ROLES,
      shortRoles: ATTACK_SHORT,
    }
  );
}

/**
 * Drift guard: registry rows that lack an explicit prompt profile.
 * @returns {string[]}
 */
export function rowsMissingProfiles() {
  return SHEET_IDS.filter((id) => !ROW_PROMPT_PROFILES[id]);
}
