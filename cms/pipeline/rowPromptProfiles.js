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

/**
 * @typedef {Object} RowPromptProfile
 * @property {string} description  Short move description (the "Animation: ..." slot).
 * @property {string} frameRoles   Verbose per-frame role sentence (multi-line prompt).
 * @property {string} shortRoles   One-line role note (terse prompt).
 * @property {boolean} [idle]      True for the breathing-loop base row (subtle motion).
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
  },
  punch: { description: 'punch attack — wind-up, extension, contact, follow-through, recovery frames', frameRoles: ATTACK_ROLES, shortRoles: ATTACK_SHORT },
  kick: { description: 'kick attack — chamber, extension, contact, follow-through, recovery frames', frameRoles: ATTACK_ROLES, shortRoles: ATTACK_SHORT },
  special_1: { description: 'special move 1 — dramatic startup, active frames with effect/projectile, recovery', frameRoles: ATTACK_ROLES, shortRoles: ATTACK_SHORT },
  special_2: { description: 'special move 2 — dramatic startup, active frames with effect/projectile, recovery', frameRoles: ATTACK_ROLES, shortRoles: ATTACK_SHORT },

  // T21 rows. State-driven rows (jump/crouch/block) end on the HELD pose to
  // match the engine's hold-last playback.
  jump: {
    description: 'jump — the airborne arc: crouch-load, push-off, rising, apex, then descent',
    frameRoles:
      'frame 1 = crouch-load anticipation, frame 2 = push-off leaving the ground, frame 3 = rising, frame 4 = apex at peak height, frame 5 = beginning to descend, frame 6 = falling/descent pose (the held airborne pose the engine holds while falling)',
    shortRoles: 'Frame roles: 1 crouch-load, 2 push-off, 3 rising, 4 apex, 5 descending, 6 falling pose (held).',
  },
  crouch: {
    description: 'crouch — lowering from standing into a fully settled, held crouch',
    frameRoles:
      'frame 1 = standing, frames 2-3 = bending the knees and dropping the hips, frames 4-5 = lowering further, frame 6 = fully settled crouch (the held pose the engine holds while crouching)',
    shortRoles: 'Frame roles: 1 standing, 2-3 bending, 4-5 lowering, 6 settled crouch (held).',
  },
  dash_forward: {
    description: 'dash forward — an explosive forward burst that recovers to neutral',
    frameRoles:
      'frame 1 = forward lean/anticipation, frames 2-3 = explosive push forward, frame 4 = full forward stride/extension, frames 5-6 = recover back toward neutral',
    shortRoles: 'Frame roles: 1 lean, 2-3 burst forward, 4 full stride, 5-6 recover.',
  },
  dash_back: {
    description: 'dash back — an explosive backward hop/retreat that recovers to neutral',
    frameRoles:
      'frame 1 = backward lean/anticipation, frames 2-3 = explosive push backward, frame 4 = full backward extension, frames 5-6 = recover back toward neutral',
    shortRoles: 'Frame roles: 1 lean back, 2-3 burst backward, 4 full retreat, 5-6 recover.',
  },
  block: {
    description: 'block — raising into a fully settled, held defensive guard',
    frameRoles:
      'frame 1 = reacting, frames 2-3 = raising the guard, frames 4-5 = guard nearly up, frame 6 = fully settled defensive guard (the held pose the engine holds during blockstun)',
    shortRoles: 'Frame roles: 1 react, 2-3 raise guard, 4-5 guard up, 6 settled guard (held).',
  },
  grab: {
    description: 'grab — reach out, grip the opponent, and hold',
    frameRoles:
      'frames 1-2 = reach/lunge forward, frame 3 = hand extends toward the opponent, frame 4 = grip/contact (the grab moment), frame 5 = securing the hold, frame 6 = holding the opponent',
    shortRoles: 'Frame roles: 1-2 reach, 3 extend, 4 grip/contact, 5 secure, 6 hold.',
  },
  throw: {
    description: 'throw — wind up with the held opponent, release, and recover',
    frameRoles:
      'frames 1-2 = wind-up with the held opponent, frame 3 = lifting/spinning, frame 4 = release at peak force, frame 5 = follow-through, frame 6 = recovery toward neutral',
    shortRoles: 'Frame roles: 1-2 wind-up, 3 lift, 4 release, 5 follow-through, 6 recovery.',
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
