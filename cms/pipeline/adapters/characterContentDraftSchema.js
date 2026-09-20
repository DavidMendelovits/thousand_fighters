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
// duplication. Custom animation row ids are supported so nonhuman characters
// and controlled actors are not constrained to the canonical six attack rows.
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

import {advancedMoveEvents,summonActorSchema,commandDirectionsSchema} from './advancedMoveSchema.js';

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
  return {anyOf:[{
    type: 'object',
    additionalProperties: false,
    required: ['type', 'hitbox', 'projectile', 'projectileId', 'offsetX', 'offsetY', 'keyframes', 'actor'],
    properties: {
      type: {
        type: 'string',
        enum: ['hitbox_active', 'hitbox_end', 'spawn_projectile'],
      },
      hitbox: nullable(hitboxSchema()),
      actor: nullable({type:'string'}),
      projectile: { type: 'null' },
      projectileId: nullable({ type: 'string' }),
      offsetX: nullable({ type: 'number' }),
      offsetY: nullable({ type: 'number' }),
      keyframes: nullable({type:'array',items:{type:'object',additionalProperties:false,required:['atFrame','x','y','width','height'],properties:{atFrame:{type:'integer'},x:{type:'number'},y:{type:'number'},width:{type:'number'},height:{type:'number'}}}}),
    },
  },...advancedMoveEvents()]};
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
    required: ['id', 'displayName', 'description', 'animation', 'trigger', 'phases', 'controlledActor'],
    properties: {
      id: { type: 'string' },
      displayName: { type: 'string' },
      description: { type: 'string' },
      // Safe custom row ids are resolved against real pack assets at export.
      animation: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
      controlledActor: nullable({type:'string'}),
      trigger: {
        type: 'object',
        additionalProperties: false,
        required: ['sequence', 'directions'],
        properties: {
          directions: commandDirectionsSchema(),
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
    ...characterInputGuidance(),
    'You draft game-ready Thousand Fighters character content as strict JSON.',
    'Create a playable fighting-game character from the brief with a FULL move kit.',
    'Give a full kit with normals, specials and a grab/throw. Each mechanically distinct action may use a unique lowercase snake_case animation row; canonical punch/kick/special_1/special_2/grab/throw rows remain supported. Do not reuse a human punch animation for a nonhuman morph.',
    'Every move has phases named startup, active, then recovery (in that order). Only striking moves need hitbox_active/hitbox_end. Use grab_check/grab_end for grabs, summon_control for possession and recall_summon for dismissal; never add a fake melee hit to a non-attacking action.',
    'Summons: actors lists only summoned entities, each with a unique id, summon:true, description, and dedicated idleAnimation row. The body actor is derived by the pipeline. A summon_control event names that actor, duration 1–600 ticks, speed >0 and <=12, and offsets within +/-300. Give it controlled moves with controlledActor set to its id, including a recall_summon action. Body moves use controlledActor:null. Contact events on controlled moves must name the same actor. Generate the entity isolated from the fighter; its own approved idle/reference must exist before video generation.',
    'Grabs use grab_check with a grab payload and grab_end to clear contact. A summon grip names the same actor in event.actor and grab.actorGrip.actor, with torso socket and lift/swing trajectory; never bake an opponent into the sprite. Ordinary grabs use actor:null and actorGrip:null.',
    'Directional commands use trigger.directions as a facing-relative held-direction filter; use null for unrestricted commands. Keep sequence for button/motion history. Actor control separates body and summon commands, so the same button may be reused in those different contexts.',
    'Projectiles may also use spawn_projectile_at_target, spawn_projectile_from_sky, or spawn_projectile_behind_target with their explicit offset/distance fields and a defined projectileId.',
    'Combos: in `combos`, list ordered chains of EXISTING move ids (2+ segments each). Do NOT author cancel windows, allowed states, or cancelFrom — the engine derives the cancel graph from the combo order. Just give the move-id sequence.',
    'Projectiles: for any move that throws something, add a projectile ENTITY to `projectiles` (id, width, height, speed, velocity, lifetime, hitbox) and reference it from that move\'s spawn_projectile event by setting the event `projectileId` to the entity id (keep the event `projectile` field null). Set the spawn event offsetX/offsetY to where it leaves the body.',
    'Event nullability: for a hitbox_active event set hitbox and leave projectileId/offsetX/offsetY null; for a spawn_projectile event set projectileId/offsetX/offsetY and leave hitbox null; for hitbox_end leave them all null.',
    'frameCounts: use 6 frames per row unless the brief says otherwise. walk_forward/walk_back are looping walk cycles; grab/throw are the grab and throw animations.',
    'Set sprite.relativeHeight from the brief: 1.0 for a standard fighter, up to 1.6 for giants, down to 0.5 for tiny fighters. This is how intended character height reaches the game.',
    'Moves should be mechanically readable and usable by the runtime config.',
    'For shape-changing attacks, keyframes may describe a collision track using increasing atFrame ticks since hitbox activation and x/y/width/height in feet-origin world pixels. Keep ticks inside the active phase. Use null for ordinary contacts. Geometry must match the striking portion, not the whole VFX silhouette. The workbench can refine and lock authored geometry after visual review.',
    'Coordinates are feet-origin: y=0 is the floor, negative y is ABOVE the floor. Melee hitbox y and hand projectile offsetY should normally be negative (for example -70); positive values put attacks underground. Projectile hitboxes are relative to their projectile center.',
    'Physics stats are positive magnitudes: jumpVelocity and jumpBackVelocity must be POSITIVE. The engine applies upward/backward signs. Use jumpVelocity around 10-13 and jumpBackVelocity around 3.',
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
    required: ['id', 'displayName', 'description', 'trigger', 'phases', 'controlledActor'],
    properties: {
      id: { type: 'string' },
      displayName: { type: 'string' },
      description: { type: 'string' },
      controlledActor: nullable({type:'string'}),
      trigger: {
        type: 'object',
        additionalProperties: false,
        required: ['sequence', 'directions'],
        properties: {
          directions: commandDirectionsSchema(),
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
    ...characterInputGuidance(),
    'You design the NEW moves of a fighting-game COMBO from the requested segments.',
    'Return one move per requested NEW segment, in the SAME order. Each segment carries the sprite row it has already been assigned (the `animation` field) plus a description — author a move that reads as that description on that row.',
    'Do NOT set `animation` yourself; the row is fixed for you. Use the assigned row only to judge what kind of move fits.',
    'Every move needs phases named startup, active, then recovery. Only strikes use hitbox_active/hitbox_end; grabs use grab_check/grab_end. Recovery is required for combo links. Controlled summon moves must name an EXISTING actor in controlledActor and contact events; never invent an actor that is absent from the current draft. Use trigger.directions for held-direction variants, null otherwise.',
    'Tune hitbox numbers to the description and ESCALATE across the combo (later links hit harder / launch). A headbutt is short-range high-stun; a roundhouse is wide; a launcher knocks up.',
    'trigger.sequence: assign a SHORT (1-2 token) input using ONLY canonical tokens — lp, mp, hp, lk, mk, hk, up, down, forward, back. Make each combo move\'s input DISTINCT from its siblings in this combo AND from the existing-move inputs you are given, so the player can chain the links cleanly.',
    'Do not include markdown. Return only JSON matching the supplied schema.',
  ];
}

export function characterInputGuidance(){
  return [
    'Inputs are CHARACTER-SPECIFIC. Do not copy David or another fighter\'s command layout. Choose commands that fit this character\'s abilities, movement vocabulary, tactical role and intended combo flow; honor any explicit user control preferences.',
    'Use supported runtime input tokens, not literal keyboard letters. Physical bindings may alias lp/mk, lk/mp and hp/hk; aliases are NOT distinct buttons. Keep frequent actions easy on a three-button mobile layout. Forward/back are facing-relative.',
    'Choose directions deliberately: down for a low or grounded action, forward for commitment or reach, back for retreat/counter/pull when that fits the character; these are semantic suggestions, not mandatory mappings. Explain the chosen command and its purpose briefly in each move description.',
    'Check commands against the existing kit and the legal state/predecessor. Never create two indistinguishable triggers competing in the same state. Repeated buttons are valid for authored strings only when predecessor/cancel-only gating is actually supported by the supplied authoring schema; otherwise do not invent unsupported trigger fields.',
  ];
}

export function characterContentDraftSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['displayName', 'description', 'artBrief', 'stats', 'sprite', 'moves', 'combos', 'projectiles', 'actors'],
    properties: {
      actors: {type:'array',items:summonActorSchema()},
      displayName: { type: 'string' },
      description: { type: 'string' },
      artBrief: {type:'string',description:'Appearance-only identity brief: silhouette, palette, material and side-view neutral pose. Never include controls, move lists, labels, text, UI or multiple poses; image generation consumes this verbatim.'},
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
