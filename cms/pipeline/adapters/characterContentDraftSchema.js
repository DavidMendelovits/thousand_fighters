// Single source of truth for the `CharacterContentDraft` structured-output
// schema. BOTH text-model adapters import this:
//   - openAiResponsesTextModelAdapter.js uses it with `strict: true` (OpenAI
//     Responses structured output), so every property MUST be listed in
//     `required`, objects set `additionalProperties: false`, and "optional"
//     fields are modelled as `anyOf: [T, { type: 'null' }]`.
//   - codexTextModelAdapter.js embeds it verbatim in the prompt as guidance;
//     the strict shape is harmless there and keeps the two adapters in lockstep.
//
// Before T-move-kit there were two hand-maintained copies that drifted (the
// move `animation` enum, no combos/projectiles). This module removes that
// duplication. The move-row enum is sourced from shared/animationRows.js so a
// new move-triggered row can't silently fall out of generation.
//
// What the model authors vs. what the pipeline derives:
//   - The model emits combos as ordered move-id chains. It does NOT author the
//     cancel graph (allowedStates/cancelFrom/window) — convert's
//     applyComboChaining derives that from the descriptor (see
//     convertDraftToCharacterConfig.js). Asking the model for it would be
//     circular and is exactly the part we can't afford to get wrong.
//   - The model emits projectile ENTITIES (numbers) + references them from
//     spawn events via `projectileId`. The texture key (`animation`) and
//     `sourceKey` are derived/attached by the pipeline, not the model.

import { MOVE_SHEET_IDS } from '../../../shared/animationRows.js';

const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });

function hitboxSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['x', 'y', 'width', 'height', 'damage', 'knockbackX', 'knockbackY', 'hitstun'],
    properties: {
      x: { type: 'number' },
      y: { type: 'number' },
      width: { type: 'number' },
      height: { type: 'number' },
      damage: { type: 'integer' },
      knockbackX: { type: 'number' },
      knockbackY: { type: 'number' },
      hitstun: { type: 'integer' },
    },
  };
}

// Per-event payload. Restricted to the gameplay-critical authorable event types.
// `projectile` is null-only: creation references a first-class projectile ENTITY
// by `projectileId` (the T23 path), never an inline projectile. Offsets are
// nullable so non-spawn events emit null; convert defaults them for spawns.
function eventSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'hitbox', 'projectile', 'projectileId', 'offsetX', 'offsetY'],
    properties: {
      type: {
        type: 'string',
        enum: ['hitbox_active', 'hitbox_end', 'spawn_projectile'],
      },
      hitbox: nullable(hitboxSchema()),
      projectile: { type: 'null' },
      projectileId: nullable({ type: 'string' }),
      offsetX: nullable({ type: 'number' }),
      offsetY: nullable({ type: 'number' }),
    },
  };
}

function phaseSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'frames', 'events'],
    properties: {
      name: { type: 'string' },
      frames: { type: 'integer' },
      events: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['frame', 'event'],
          properties: {
            frame: { type: 'integer' },
            event: eventSchema(),
          },
        },
      },
    },
  };
}

function moveSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'displayName', 'description', 'animation', 'trigger', 'phases'],
    properties: {
      id: { type: 'string' },
      displayName: { type: 'string' },
      description: { type: 'string' },
      // Move-triggered sprite rows (punch/kick/special_1/special_2/grab/throw).
      animation: { type: 'string', enum: [...MOVE_SHEET_IDS] },
      trigger: {
        type: 'object',
        additionalProperties: false,
        required: ['sequence'],
        properties: {
          // Non-empty: a move with an empty input sequence never matches in the
          // input buffer, so a combo follow-up with [] gets cancel wiring but
          // can never fire (codex P1). Use canonical tokens (lp/mp/hp/lk/mk/hk,
          // up/down/forward/back and the diagonals); convert normalizes common
          // aliases, but motion shorthands like "qcf" won't match.
          sequence: { type: 'array', minItems: 1, items: { type: 'string' } },
        },
      },
      phases: {
        type: 'array',
        minItems: 3,
        items: phaseSchema(),
      },
    },
  };
}

// Combo = ordered list of EXISTING move ids that chain. Convert wires the cancel
// graph from this descriptor.
function comboSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'displayName', 'segments'],
    properties: {
      id: { type: 'string' },
      displayName: nullable({ type: 'string' }),
      segments: { type: 'array', minItems: 2, items: { type: 'string' } },
    },
  };
}

// First-class projectile ENTITY (runtime numbers). `animation` (texture key) and
// `sourceKey` are intentionally absent — the pipeline derives `animation` as
// `<characterId>_<id>` and attaches `sourceKey` when the sprite is generated.
function projectileSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'width', 'height', 'speed', 'velocity', 'lifetime', 'hitbox'],
    properties: {
      id: { type: 'string' },
      width: { type: 'number' },
      height: { type: 'number' },
      speed: { type: 'number' },
      velocity: {
        type: 'object',
        additionalProperties: false,
        required: ['x', 'y', 'relativeToFacing'],
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          relativeToFacing: { type: 'boolean' },
        },
      },
      lifetime: { type: 'integer' },
      hitbox: {
        type: 'object',
        additionalProperties: false,
        required: ['x', 'y', 'width', 'height', 'damage', 'hitstun', 'blockstun', 'knockback', 'level'],
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
          damage: { type: 'integer' },
          hitstun: { type: 'integer' },
          blockstun: { type: 'integer' },
          knockback: {
            type: 'object',
            additionalProperties: false,
            required: ['x', 'y'],
            properties: { x: { type: 'number' }, y: { type: 'number' } },
          },
          level: { type: 'string', enum: ['high', 'mid', 'low'] },
        },
      },
    },
  };
}

// Shared authoring guidance for the character-content-draft task, used by BOTH
// real text adapters so the instructions can't drift from the schema above.
export function characterContentDraftGuidance() {
  return [
    'You draft game-ready Thousand Fighters character content as strict JSON.',
    'Create a playable fighting-game character from the brief with a FULL move kit.',
    'Author moves across these move-triggered rows: punch, kick, special_1, special_2, grab, throw. Give normals, specials, AND a grab/throw — not just one or two moves.',
    'Every move has phases named startup, active, then recovery (in that order). Put hitbox_active then hitbox_end events in the active phase. The recovery phase is what lets a move be cancelled into a combo.',
    'Combos: in `combos`, list ordered chains of EXISTING move ids (2+ segments each). Do NOT author cancel windows, allowed states, or cancelFrom — the engine derives the cancel graph from the combo order. Just give the move-id sequence.',
    'Projectiles: for any move that throws something, add a projectile ENTITY to `projectiles` (id, width, height, speed, velocity, lifetime, hitbox) and reference it from that move\'s spawn_projectile event by setting the event `projectileId` to the entity id (keep the event `projectile` field null). Set the spawn event offsetX/offsetY to where it leaves the body.',
    'Event nullability: for a hitbox_active event set hitbox and leave projectileId/offsetX/offsetY null; for a spawn_projectile event set projectileId/offsetX/offsetY and leave hitbox null; for hitbox_end leave them all null.',
    'frameCounts: use 6 frames per row unless the brief says otherwise. walk_forward/walk_back are looping walk cycles; grab/throw are the grab and throw animations.',
    'Set sprite.relativeHeight from the brief: 1.0 for a standard fighter, up to 1.6 for giants, down to 0.5 for tiny fighters. This is how intended character height reaches the game.',
    'Moves should be mechanically readable and usable by the runtime config.',
    'Do not include markdown. Return only JSON matching the supplied schema.',
  ];
}

// Combo authoring (author_combo): the model designs the NEW moves of a combo
// from per-segment descriptions. It does NOT pick `animation` — the server
// assigns each move a sprite row (collision-aware, so generating sprites never
// clobbers an existing move's row), then authors the move for that row.
function comboMoveSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'displayName', 'description', 'trigger', 'phases'],
    properties: {
      id: { type: 'string' },
      displayName: { type: 'string' },
      description: { type: 'string' },
      trigger: {
        type: 'object',
        additionalProperties: false,
        required: ['sequence'],
        properties: {
          sequence: { type: 'array', minItems: 1, items: { type: 'string' } },
        },
      },
      phases: {
        type: 'array',
        minItems: 3,
        items: phaseSchema(),
      },
    },
  };
}

export function comboAuthoringSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['moves'],
    properties: {
      moves: { type: 'array', items: comboMoveSchema() },
    },
  };
}

export function comboAuthoringGuidance() {
  return [
    'You design the NEW moves of a fighting-game COMBO from the requested segments.',
    'Return one move per requested NEW segment, in the SAME order. Each segment carries the sprite row it has already been assigned (the `animation` field) plus a description — author a move that reads as that description on that row.',
    'Do NOT set `animation` yourself; the row is fixed for you. Use the assigned row only to judge what kind of move fits.',
    'Every move needs phases named startup, active, then recovery (in that order). Put hitbox_active then hitbox_end in the active phase. The recovery phase is REQUIRED — it is what lets the move be cancelled into the next link of the combo.',
    'Tune hitbox numbers to the description and ESCALATE across the combo (later links hit harder / launch). A headbutt is short-range high-stun; a roundhouse is wide; a launcher knocks up.',
    'trigger.sequence: assign a SHORT (1-2 token) input using ONLY canonical tokens — lp, mp, hp, lk, mk, hk, up, down, forward, back. Make each combo move\'s input DISTINCT from its siblings in this combo AND from the existing-move inputs you are given, so the player can chain the links cleanly.',
    'Do not include markdown. Return only JSON matching the supplied schema.',
  ];
}

export function characterContentDraftSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['displayName', 'description', 'stats', 'sprite', 'moves', 'combos', 'projectiles'],
    properties: {
      displayName: { type: 'string' },
      description: { type: 'string' },
      stats: {
        type: 'object',
        additionalProperties: false,
        required: [
          'walkForwardSpeed',
          'walkBackSpeed',
          'jumpVelocity',
          'jumpForwardVelocity',
          'jumpBackVelocity',
          'gravity',
          'maxFallSpeed',
          'maxHealth',
        ],
        properties: {
          walkForwardSpeed: { type: 'number' },
          walkBackSpeed: { type: 'number' },
          jumpVelocity: { type: 'number' },
          jumpForwardVelocity: { type: 'number' },
          jumpBackVelocity: { type: 'number' },
          gravity: { type: 'number' },
          maxFallSpeed: { type: 'number' },
          maxHealth: { type: 'integer' },
        },
      },
      sprite: {
        type: 'object',
        additionalProperties: false,
        required: ['basePath', 'scale', 'relativeHeight', 'frameCounts'],
        properties: {
          basePath: { type: 'string' },
          scale: { type: 'number' },
          relativeHeight: {
            type: 'number',
            description:
              'On-screen height relative to a standard fighter. 1.0 = standard. Giants up to 1.6, small/childlike down to 0.5. This is the only place intended height lives.',
          },
          // Only the canonical 5 are declared at creation. State/grab rows
          // (walk_forward/walk_back/jump/crouch/grab/throw…) are generated later
          // in the admin; their frame counts flow in from the fighter-pack
          // manifest at convert time (buildSpriteConfig overlays manifest counts).
          // Declaring a row here before its sprites exist would make the engine
          // "own" it and render a missing texture instead of falling back to base.
          frameCounts: {
            type: 'object',
            additionalProperties: false,
            required: ['base', 'punch', 'kick', 'special_1', 'special_2'],
            properties: {
              base: { type: 'integer' },
              punch: { type: 'integer' },
              kick: { type: 'integer' },
              special_1: { type: 'integer' },
              special_2: { type: 'integer' },
            },
          },
        },
      },
      moves: {
        type: 'array',
        minItems: 4,
        items: moveSchema(),
      },
      combos: {
        type: 'array',
        items: comboSchema(),
      },
      projectiles: {
        type: 'array',
        items: projectileSchema(),
      },
    },
  };
}
