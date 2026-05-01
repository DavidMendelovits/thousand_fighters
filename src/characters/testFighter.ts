import type { CharacterConfig, Hitbox, Move, ProjectileConfig } from '../schema/types';

const midPunch: Hitbox = {
  x: 28,
  y: -90,
  width: 42,
  height: 28,
  damage: 45,
  hitstun: 14,
  blockstun: 8,
  chipDamage: 0,
  knockback: { x: 4, y: 0 },
  level: 'mid',
};

const fireballProjectile: ProjectileConfig = {
  id: 'test_fireball',
  animation: 'fireball',
  width: 26,
  height: 26,
  speed: 5,
  lifetime: 96,
  pierces: 1,
  clashesWithProjectiles: true,
  hitbox: {
    x: -13,
    y: -13,
    width: 26,
    height: 26,
    damage: 55,
    hitstun: 20,
    blockstun: 12,
    chipDamage: 8,
    knockback: { x: 5, y: 0 },
    level: 'mid',
  },
};

const moves: Move[] = [
  {
    id: 'uppercut',
    displayName: 'Uppercut',
    animation: 'uppercut',
    trigger: {
      allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
      sequence: ['forward', 'down', 'down-forward', 'hp'],
      window: 18,
    },
    phases: [
      {
        name: 'startup',
        frames: 5,
        events: [
          { onFrame: 0, event: { type: 'play_animation', name: 'uppercut_startup' } },
          { onFrame: 0, event: { type: 'invulnerable', duration: 5, against: ['high', 'mid', 'low', 'projectile'] } },
          { onFrame: 1, event: { type: 'set_velocity', vx: 1.5, vy: -7.5, relativeToFacing: true } },
        ],
      },
      {
        name: 'active',
        frames: 8,
        events: [
          {
            onFrame: 0,
            event: {
              type: 'hitbox_active',
              id: 'rise',
              hitbox: {
                x: 18,
                y: -124,
                width: 44,
                height: 80,
                damage: 90,
                hitstun: 34,
                blockstun: 16,
                chipDamage: 6,
                knockback: { x: 3, y: -8 },
                level: 'mid',
                launches: true,
              },
            },
          },
        ],
      },
      { name: 'recovery', frames: 24, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'rise' } }] },
    ],
    endState: 'airborne',
  },
  {
    id: 'fireball',
    displayName: 'Fireball',
    animation: 'fireball_cast',
    trigger: {
      allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
      sequence: ['down', 'down-forward', 'forward', 'hp'],
      window: 20,
    },
    phases: [
      { name: 'startup', frames: 12, events: [{ onFrame: 0, event: { type: 'play_animation', name: 'fireball_startup' } }] },
      {
        name: 'release',
        frames: 4,
        events: [{ onFrame: 0, event: { type: 'spawn_projectile', projectile: fireballProjectile, offsetX: 48, offsetY: -72 } }],
      },
      { name: 'recovery', frames: 22, events: [] },
    ],
  },
  {
    id: 'dash_punch',
    displayName: 'Dash Punch',
    animation: 'dash_punch',
    trigger: {
      allowedStates: ['idle', 'walk_forward', 'walk_back', 'landing'],
      sequence: ['forward', 'forward', 'lp'],
      window: 16,
    },
    phases: [
      {
        name: 'startup',
        frames: 7,
        events: [
          { onFrame: 0, event: { type: 'set_velocity', vx: 7, relativeToFacing: true } },
          { onFrame: 0, event: { type: 'play_animation', name: 'dash_punch_startup' } },
        ],
      },
      {
        name: 'active',
        frames: 5,
        events: [
          {
            onFrame: 0,
            event: {
              type: 'hitbox_active',
              id: 'dash',
              hitbox: {
                ...midPunch,
                x: 34,
                width: 54,
                damage: 70,
                hitstun: 22,
                blockstun: 12,
                knockback: { x: 7, y: 0 },
              },
            },
          },
        ],
      },
      {
        name: 'recovery',
        frames: 16,
        events: [
          { onFrame: 0, event: { type: 'hitbox_end', id: 'dash' } },
          { onFrame: 0, event: { type: 'set_velocity', vx: 0, relativeToFacing: true } },
        ],
      },
    ],
  },
  {
    id: 'crouch_low_kick',
    displayName: 'Crouching Low Kick',
    animation: 'crouch_low_kick',
    trigger: {
      allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
      sequence: ['down', 'lk'],
      window: 8,
    },
    phases: [
      { name: 'startup', frames: 4, events: [{ onFrame: 0, event: { type: 'modify_hurtbox', hurtbox: { x: -24, y: -78, width: 48, height: 78 } } }] },
      {
        name: 'active',
        frames: 4,
        events: [
          {
            onFrame: 0,
            event: {
              type: 'hitbox_active',
              id: 'low_kick',
              hitbox: {
                x: 20,
                y: -32,
                width: 56,
                height: 22,
                damage: 38,
                hitstun: 12,
                blockstun: 9,
                knockback: { x: 3, y: 0 },
                level: 'low',
              },
            },
          },
        ],
      },
      {
        name: 'recovery',
        frames: 10,
        events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'low_kick' } }],
      },
    ],
  },
  {
    id: 'heavy_punch',
    displayName: 'Heavy Punch',
    animation: 'heavy_punch',
    trigger: {
      allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
      sequence: ['hp'],
      window: 6,
    },
    phases: [
      { name: 'startup', frames: 8, events: [{ onFrame: 0, event: { type: 'play_animation', name: 'heavy_punch_startup' } }] },
      {
        name: 'active',
        frames: 4,
        events: [
          {
            onFrame: 0,
            event: {
              type: 'hitbox_active',
              id: 'heavy',
              hitbox: {
                x: 26,
                y: -96,
                width: 58,
                height: 36,
                damage: 85,
                hitstun: 28,
                blockstun: 14,
                chipDamage: 4,
                knockback: { x: 5, y: -6 },
                level: 'mid',
                launches: true,
              },
            },
          },
        ],
      },
      { name: 'recovery', frames: 18, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'heavy' } }] },
    ],
  },
  {
    id: 'light_punch',
    displayName: 'Light Punch',
    animation: 'light_punch',
    trigger: {
      allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing', 'attack'],
      sequence: ['lp'],
      window: 6,
      cancelFrom: ['light_punch'],
    },
    phases: [
      { name: 'startup', frames: 3, events: [{ onFrame: 0, event: { type: 'play_animation', name: 'light_punch_startup' } }] },
      {
        name: 'active',
        frames: 3,
        cancellable: true,
        events: [{ onFrame: 0, event: { type: 'hitbox_active', id: 'jab', hitbox: midPunch } }],
      },
      {
        name: 'recovery',
        frames: 8,
        cancellable: true,
        events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'jab' } }],
      },
    ],
    cancelInto: ['light_punch', 'heavy_punch'],
  },
];

export const testFighterConfig: CharacterConfig = {
  id: 'test_fighter',
  displayName: 'Test Fighter',
  walkForwardSpeed: 3,
  walkBackSpeed: 2,
  jumpVelocity: 11,
  jumpForwardVelocity: 4,
  jumpBackVelocity: 3.2,
  gravity: 0.55,
  maxFallSpeed: 12,
  maxHealth: 1000,
  pivotOffsetY: 0,
  hurtboxes: {
    idle: { x: -24, y: -116, width: 48, height: 116 },
    walk_forward: { x: -24, y: -116, width: 48, height: 116 },
    walk_back: { x: -24, y: -116, width: 48, height: 116 },
    crouch: { x: -26, y: -76, width: 52, height: 76 },
    attack: { x: -24, y: -116, width: 48, height: 116 },
    airborne: { x: -24, y: -108, width: 48, height: 108 },
    hitstun: { x: -26, y: -116, width: 52, height: 116 },
    blockstun: { x: -26, y: -116, width: 52, height: 116 },
    juggle: { x: -24, y: -108, width: 48, height: 108 },
  },
  animations: {
    idle: 'idle',
    walk_forward: 'walk_forward',
    walk_back: 'walk_back',
    crouch: 'crouch',
    airborne: 'jump',
    landing: 'landing',
    attack: 'attack',
    hitstun: 'hitstun',
    blockstun: 'blockstun',
    knockdown: 'knockdown',
    getup: 'getup',
    dead: 'dead',
  },
  moves,
};
