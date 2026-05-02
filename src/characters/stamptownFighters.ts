import type { CharacterConfig, Hitbox, Move, MoveVisualFrame, ProjectileConfig, SpriteFrameMeta, SpriteSheetId } from '../schema/types';

type FighterTuning = {
  id: string;
  displayName: string;
  assetPath: string;
  projectileId: string;
  projectileAnimation: string;
  moveNames: {
    light: string;
    heavy: string;
    low: string;
    projectile: string;
    dash: string;
    uppercut: string;
  };
};

type FrameTuple = [width: number, height: number, anchorX: number, anchorY: number];

const baseHurtboxes = {
  idle: { x: -25, y: -122, width: 50, height: 122 },
  walk_forward: { x: -25, y: -122, width: 50, height: 122 },
  walk_back: { x: -25, y: -122, width: 50, height: 122 },
  crouch: { x: -28, y: -82, width: 56, height: 82 },
  attack: { x: -26, y: -120, width: 52, height: 120 },
  airborne: { x: -26, y: -114, width: 52, height: 114 },
  hitstun: { x: -28, y: -120, width: 56, height: 120 },
  blockstun: { x: -28, y: -120, width: 56, height: 120 },
  juggle: { x: -26, y: -114, width: 52, height: 114 },
};

function midPunch(overrides: Partial<Hitbox> = {}): Hitbox {
  return {
    x: 28,
    y: -92,
    width: 46,
    height: 28,
    damage: 44,
    hitstun: 14,
    blockstun: 8,
    knockback: { x: 4, y: 0 },
    level: 'mid',
    ...overrides,
  };
}

function makeProjectile(tuning: FighterTuning): ProjectileConfig {
  return {
    id: tuning.projectileId,
    animation: tuning.projectileAnimation,
    width: 30,
    height: 30,
    speed: 5.2,
    lifetime: 92,
    pierces: 1,
    clashesWithProjectiles: true,
    hitbox: {
      x: -15,
      y: -15,
      width: 30,
      height: 30,
      damage: 54,
      hitstun: 20,
      blockstun: 12,
      chipDamage: 8,
      knockback: { x: 5, y: 0 },
      level: 'mid',
    },
  };
}

function makeFrameMeta(tuples: Partial<Record<SpriteSheetId, FrameTuple[]>>): Partial<Record<SpriteSheetId, SpriteFrameMeta[]>> {
  const result: Partial<Record<SpriteSheetId, SpriteFrameMeta[]>> = {};
  for (const [sheet, frames] of Object.entries(tuples) as Array<[SpriteSheetId, FrameTuple[]]>) {
    result[sheet] = frames.map(([width, height, anchorX, anchorY], index) => ({
      file: `sprites/${sheet}/${sheet}_${String(index + 1).padStart(3, '0')}.png`,
      width,
      height,
      anchor: { x: anchorX, y: anchorY },
    }));
  }
  return result;
}

const guitarShredderFrames = makeFrameMeta({
  base: [
    [154, 201, 77, 183],
    [159, 194, 80, 176],
    [157, 195, 78, 177],
    [162, 179, 81, 161],
    [162, 150, 81, 132],
    [159, 194, 80, 176],
  ],
  punch: [
    [159, 194, 80, 176],
    [201, 192, 100, 174],
    [201, 189, 100, 171],
    [199, 190, 100, 172],
    [209, 187, 104, 169],
    [159, 194, 80, 176],
  ],
  kick: [
    [162, 150, 81, 132],
    [155, 191, 78, 173],
    [191, 170, 96, 152],
    [219, 153, 110, 135],
    [170, 149, 85, 131],
    [162, 150, 81, 132],
  ],
  special_1: [
    [159, 194, 80, 176],
    [181, 169, 90, 151],
    [201, 174, 100, 156],
    [201, 174, 100, 156],
    [181, 169, 90, 151],
    [159, 194, 80, 176],
  ],
  special_2: [
    [162, 179, 81, 161],
    [181, 169, 90, 151],
    [162, 179, 81, 161],
    [157, 195, 78, 177],
    [181, 169, 90, 151],
    [159, 194, 80, 176],
  ],
});

const mrCardboardFrames = makeFrameMeta({
  base: [
    [275, 415, 138, 371],
    [269, 408, 134, 364],
    [405, 392, 202, 348],
    [289, 366, 144, 321],
    [322, 295, 162, 251],
    [290, 360, 144, 316],
  ],
  punch: [
    [401, 404, 200, 352],
    [459, 357, 230, 305],
    [497, 352, 248, 300],
    [578, 373, 289, 321],
    [352, 374, 176, 322],
    [388, 380, 194, 328],
  ],
  kick: [
    [357, 348, 178, 296],
    [485, 341, 242, 289],
    [623, 327, 312, 275],
    [553, 318, 276, 266],
    [586, 305, 293, 253],
    [356, 349, 178, 297],
  ],
  special_1: [
    [427, 369, 214, 317],
    [368, 414, 184, 362],
    [373, 511, 186, 459],
    [476, 422, 238, 370],
    [490, 365, 245, 313],
    [512, 374, 256, 322],
  ],
  special_2: [
    [401, 393, 200, 341],
    [397, 393, 198, 341],
    [444, 454, 222, 402],
    [416, 379, 208, 327],
    [416, 379, 208, 327],
    [416, 379, 208, 327],
  ],
});

const viggoFrames = makeFrameMeta({
  base: [
    [220, 298, 110, 260],
    [246, 286, 123, 248],
    [249, 286, 124, 248],
    [251, 286, 125, 248],
    [261, 286, 130, 248],
    [259, 286, 129, 248],
  ],
  punch: [
    [220, 286, 110, 248],
    [272, 286, 136, 248],
    [330, 286, 165, 248],
    [253, 286, 126, 248],
    [255, 286, 127, 248],
    [225, 286, 112, 248],
  ],
  kick: [
    [221, 286, 110, 248],
    [235, 286, 117, 248],
    [312, 286, 156, 248],
    [252, 286, 126, 248],
    [228, 286, 114, 248],
    [228, 286, 114, 248],
  ],
  special_1: [
    [230, 286, 115, 248],
    [294, 286, 147, 248],
    [222, 286, 111, 248],
    [226, 286, 113, 248],
    [282, 286, 141, 248],
    [220, 286, 110, 248],
  ],
  special_2: [
    [220, 286, 110, 248],
    [233, 286, 116, 248],
    [288, 286, 144, 248],
    [285, 286, 142, 248],
    [220, 286, 110, 248],
    [220, 286, 110, 248],
  ],
});

const janitorFrames = makeFrameMeta({
  base: [
    [226, 295, 113, 257],
    [266, 286, 133, 248],
    [329, 286, 164, 248],
    [274, 291, 137, 253],
    [308, 286, 154, 248],
    [278, 286, 139, 248],
  ],
  punch: [
    [267, 286, 133, 248],
    [316, 286, 158, 248],
    [350, 286, 175, 248],
    [273, 286, 136, 248],
    [244, 286, 122, 248],
    [224, 286, 112, 248],
  ],
  kick: [
    [220, 286, 110, 248],
    [301, 286, 150, 248],
    [325, 286, 162, 248],
    [274, 286, 137, 248],
    [278, 286, 139, 248],
    [231, 286, 115, 248],
  ],
  special_1: [
    [286, 286, 143, 248],
    [313, 286, 156, 248],
    [311, 287, 155, 249],
    [381, 286, 190, 248],
    [263, 286, 131, 248],
    [344, 286, 172, 248],
  ],
  special_2: [
    [233, 286, 116, 248],
    [346, 286, 173, 248],
    [240, 286, 120, 248],
    [252, 286, 126, 248],
    [252, 286, 126, 248],
    [252, 286, 126, 248],
  ],
});

const jackTuckerFrames = makeFrameMeta({
  base: [
    [220, 286, 110, 248],
    [236, 286, 118, 248],
    [231, 286, 115, 248],
    [237, 286, 118, 248],
    [261, 286, 130, 248],
    [275, 286, 137, 248],
  ],
  punch: [
    [264, 286, 132, 248],
    [326, 286, 163, 248],
    [371, 286, 185, 248],
    [249, 286, 124, 248],
    [236, 286, 118, 248],
    [220, 286, 110, 248],
  ],
  kick: [
    [234, 286, 117, 248],
    [269, 286, 134, 248],
    [233, 286, 116, 248],
    [236, 286, 118, 248],
    [285, 286, 142, 248],
    [220, 286, 110, 248],
  ],
  special_1: [
    [313, 286, 156, 248],
    [335, 286, 167, 248],
    [220, 286, 110, 248],
    [334, 286, 167, 248],
    [245, 286, 122, 248],
    [288, 286, 144, 248],
  ],
  special_2: [
    [268, 286, 134, 248],
    [230, 286, 115, 248],
    [221, 286, 110, 248],
    [360, 286, 150, 248],
    [220, 286, 110, 248],
    [220, 286, 110, 248],
  ],
});

const martinUrbanoFrames = makeFrameMeta({
  base: [
    [249, 317, 124, 279],
    [229, 306, 114, 268],
    [256, 299, 128, 261],
    [277, 286, 138, 248],
    [268, 286, 134, 248],
    [242, 332, 121, 294],
  ],
  punch: [
    [273, 286, 136, 248],
    [265, 286, 132, 248],
    [284, 286, 142, 248],
    [364, 286, 182, 248],
    [301, 286, 150, 248],
    [237, 286, 118, 248],
  ],
  kick: [
    [236, 286, 118, 248],
    [237, 286, 118, 248],
    [298, 286, 149, 248],
    [335, 286, 167, 248],
    [245, 286, 122, 248],
    [229, 286, 114, 248],
  ],
  special_1: [
    [235, 286, 117, 248],
    [262, 286, 131, 248],
    [265, 286, 132, 248],
    [270, 286, 135, 248],
    [268, 286, 134, 248],
    [229, 286, 114, 248],
  ],
  special_2: [
    [233, 292, 116, 254],
    [265, 290, 132, 252],
    [351, 286, 175, 248],
    [423, 286, 211, 248],
    [350, 286, 175, 248],
    [252, 286, 126, 248],
  ],
});

const dylanSaxFrames = makeFrameMeta({
  base: [
    [220, 286, 110, 248],
    [243, 289, 121, 251],
    [250, 286, 125, 248],
    [248, 286, 124, 248],
    [257, 286, 128, 248],
    [295, 302, 147, 264],
  ],
  punch: [
    [331, 286, 165, 248],
    [308, 286, 154, 248],
    [261, 286, 130, 248],
    [290, 286, 145, 248],
    [305, 286, 152, 248],
    [247, 286, 123, 248],
  ],
  kick: [
    [228, 286, 114, 248],
    [220, 286, 110, 248],
    [304, 286, 152, 248],
    [288, 286, 144, 248],
    [294, 286, 147, 248],
    [242, 286, 121, 248],
  ],
  special_1: [
    [227, 286, 113, 248],
    [246, 286, 123, 248],
    [243, 286, 121, 248],
    [260, 305, 130, 267],
    [251, 286, 125, 248],
    [239, 286, 119, 248],
  ],
  special_2: [
    [233, 286, 116, 248],
    [245, 286, 122, 248],
    [242, 286, 121, 248],
    [246, 286, 123, 248],
    [223, 286, 111, 248],
    [223, 286, 111, 248],
  ],
});

const coreyFrames = makeFrameMeta({
  base: [
    [254, 286, 127, 248],
    [238, 286, 119, 248],
    [274, 286, 137, 248],
    [288, 286, 144, 248],
    [265, 286, 132, 248],
    [250, 326, 125, 288],
  ],
  punch: [
    [287, 286, 143, 248],
    [342, 286, 171, 248],
    [249, 286, 124, 248],
    [329, 286, 164, 248],
    [262, 286, 131, 248],
    [250, 286, 125, 248],
  ],
  kick: [
    [308, 286, 154, 248],
    [251, 286, 125, 248],
    [314, 286, 157, 248],
    [308, 286, 154, 248],
    [234, 286, 117, 248],
    [250, 286, 125, 248],
  ],
  special_1: [
    [241, 286, 120, 248],
    [241, 286, 120, 248],
    [316, 286, 158, 248],
    [294, 286, 147, 248],
    [253, 286, 126, 248],
    [236, 286, 118, 248],
  ],
  special_2: [
    [240, 286, 120, 248],
    [239, 286, 119, 248],
    [303, 286, 151, 248],
    [232, 286, 116, 248],
    [232, 286, 116, 248],
    [232, 286, 116, 248],
  ],
});

const jugglingJoeFrames = makeFrameMeta({
  base: [
    [222, 286, 111, 248],
    [220, 286, 110, 248],
    [224, 286, 112, 248],
    [220, 286, 110, 248],
    [220, 286, 110, 248],
    [244, 286, 122, 248],
  ],
  punch: [
    [264, 286, 132, 248],
    [269, 286, 134, 248],
    [298, 286, 149, 248],
    [238, 286, 119, 248],
    [220, 286, 110, 248],
    [221, 286, 110, 248],
  ],
  kick: [
    [277, 286, 138, 248],
    [305, 286, 152, 248],
    [288, 286, 144, 248],
    [220, 286, 110, 248],
    [220, 286, 110, 248],
    [226, 286, 113, 248],
  ],
  special_1: [
    [234, 286, 117, 248],
    [237, 286, 118, 248],
    [220, 286, 110, 248],
    [301, 286, 150, 248],
    [220, 286, 110, 248],
    [220, 286, 110, 248],
  ],
  special_2: [
    [228, 286, 114, 248],
    [232, 286, 116, 248],
    [245, 286, 122, 248],
    [230, 286, 115, 248],
    [228, 286, 114, 248],
    [228, 286, 114, 248],
  ],
});

const rubberChickenFrames = makeFrameMeta({
  base: [
    [220, 286, 110, 248],
    [225, 286, 112, 248],
    [220, 286, 110, 248],
    [220, 286, 110, 248],
    [220, 286, 110, 248],
    [220, 289, 110, 251],
  ],
  punch: [
    [253, 286, 126, 248],
    [300, 286, 150, 248],
    [321, 286, 160, 248],
    [263, 286, 131, 248],
    [220, 286, 110, 248],
    [220, 286, 110, 248],
  ],
  kick: [
    [220, 286, 110, 248],
    [275, 286, 137, 248],
    [257, 286, 128, 248],
    [220, 286, 110, 248],
    [221, 286, 110, 248],
    [220, 286, 110, 248],
  ],
  special_1: [
    [220, 286, 110, 248],
    [328, 286, 164, 248],
    [363, 286, 181, 248],
    [247, 286, 123, 248],
    [220, 286, 110, 248],
    [220, 286, 110, 248],
  ],
  special_2: [
    [220, 286, 110, 248],
    [220, 286, 110, 248],
    [278, 286, 139, 248],
    [220, 286, 110, 248],
    [220, 286, 110, 248],
    [220, 286, 110, 248],
  ],
});

const fighterAnimations: CharacterConfig['animations'] = {
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
};

const generatedBaseStateFrames: NonNullable<CharacterConfig['sprite']>['stateFrames'] = {
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
};

function visualTimeline(frames: number[], durations: number[]): MoveVisualFrame[] {
  return frames.map((frame, index) => ({ frame, duration: durations[index] ?? 1 }));
}

function totalMoveFrames(move: Move): number {
  return move.phases.reduce((sum, phase) => sum + phase.frames, 0);
}

function timedFrames(move: Move, frames: number[], weights: number[]): MoveVisualFrame[] {
  const total = totalMoveFrames(move);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  let remaining = total;
  return frames.map((frame, index) => {
    const slotsLeft = frames.length - index;
    const duration =
      index === frames.length - 1
        ? remaining
        : Math.max(1, Math.round((total * (weights[index] ?? 1)) / Math.max(1, weightTotal)));
    remaining = Math.max(slotsLeft - 1, remaining - duration);
    return { frame, duration };
  });
}

function fireballTimeline(move: Move): MoveVisualFrame[] {
  const startup = move.phases[0]?.frames ?? 0;
  const release = move.phases[1]?.frames ?? 0;
  const recovery = move.phases[2]?.frames ?? 0;
  const early = Math.max(2, Math.floor(startup * 0.34));
  const mid = Math.max(2, Math.floor(startup * 0.3));
  const late = Math.max(1, startup - early - mid);
  return visualTimeline([0, 1, 2, 3, 4, 5], [early, mid, late, release, Math.max(2, Math.floor(recovery * 0.45)), Math.max(1, recovery - Math.floor(recovery * 0.45))]);
}

function uppercutTimeline(move: Move): MoveVisualFrame[] {
  const startup = move.phases[0]?.frames ?? 0;
  const active = move.phases[1]?.frames ?? 0;
  const recovery = move.phases[2]?.frames ?? 0;
  return visualTimeline([0, 1, 2, 3, 4, 5], [
    Math.max(2, Math.floor(startup * 0.5)),
    Math.max(1, startup - Math.floor(startup * 0.5)),
    Math.max(2, Math.floor(active * 0.55)),
    Math.max(1, active - Math.floor(active * 0.55)),
    Math.max(3, Math.floor(recovery * 0.42)),
    Math.max(1, recovery - Math.floor(recovery * 0.42)),
  ]);
}

function sixFrameTimelineFor(move: Move): MoveVisualFrame[] {
  switch (move.id) {
    case 'light_punch':
      return timedFrames(move, [0, 1, 2, 3, 4, 5], [1, 1, 2, 2, 2, 2]);
    case 'heavy_punch':
      return timedFrames(move, [0, 1, 2, 3, 4, 5], [3, 3, 2, 3, 4, 5]);
    case 'dash_punch':
      return timedFrames(move, [0, 1, 2, 3, 4, 5], [2, 3, 3, 3, 3, 5]);
    case 'crouch_low_kick':
      return timedFrames(move, [0, 1, 2, 3, 4, 5], [2, 2, 3, 3, 2, 3]);
    case 'uppercut':
      return uppercutTimeline(move);
    case 'fireball':
      return fireballTimeline(move);
    default:
      return timedFrames(move, [0, 1, 2, 3, 4, 5], [1, 1, 1, 1, 1, 1]);
  }
}

function addSixFrameVisualTimelines(moves: Move[]): Move[] {
  return moves.map((move) => ({ ...move, visualTimeline: sixFrameTimelineFor(move) }));
}

function makeMoves(tuning: FighterTuning): Move[] {
  const projectile = makeProjectile(tuning);

  return [
    {
      id: 'uppercut',
      displayName: tuning.moveNames.uppercut,
      animation: 'special_2',
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
            { onFrame: 0, event: { type: 'invulnerable', duration: 5, against: ['high', 'mid', 'low', 'projectile'] } },
            { onFrame: 1, event: { type: 'set_velocity', vx: 1.6, vy: -7.6, relativeToFacing: true } },
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
                hitbox: midPunch({
                  x: 18,
                  y: -126,
                  width: 48,
                  height: 84,
                  damage: 90,
                  hitstun: 34,
                  blockstun: 16,
                  chipDamage: 6,
                  knockback: { x: 3, y: -8 },
                  launches: true,
                }),
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
      displayName: tuning.moveNames.projectile,
      animation: 'special_1',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['down', 'down-forward', 'forward', 'hp'],
        window: 20,
      },
      phases: [
        { name: 'startup', frames: 12, events: [] },
        {
          name: 'release',
          frames: 4,
          events: [
            { onFrame: 0, event: { type: 'spawn_projectile', projectile, offsetX: 54, offsetY: -78 } },
            { onFrame: 0, event: { type: 'screen_shake', intensity: 0.002, duration: 3 } },
          ],
        },
        { name: 'recovery', frames: 22, events: [] },
      ],
    },
    {
      id: 'dash_punch',
      displayName: tuning.moveNames.dash,
      animation: 'punch',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'landing'],
        sequence: ['forward', 'forward', 'lp'],
        window: 16,
      },
      phases: [
        { name: 'startup', frames: 7, events: [{ onFrame: 0, event: { type: 'set_velocity', vx: 7, relativeToFacing: true } }] },
        {
          name: 'active',
          frames: 5,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'dash',
                hitbox: midPunch({ x: 34, width: 58, damage: 70, hitstun: 22, blockstun: 12, knockback: { x: 7, y: 0 } }),
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
      displayName: tuning.moveNames.low,
      animation: 'kick',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['down', 'lk'],
        window: 8,
      },
      phases: [
        { name: 'startup', frames: 4, events: [{ onFrame: 0, event: { type: 'modify_hurtbox', hurtbox: { x: -28, y: -78, width: 56, height: 78 } } }] },
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
                  y: -34,
                  width: 62,
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
        { name: 'recovery', frames: 10, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'low_kick' } }] },
      ],
    },
    {
      id: 'heavy_punch',
      displayName: tuning.moveNames.heavy,
      animation: 'punch',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['hp'],
        window: 6,
      },
      phases: [
        { name: 'startup', frames: 8, events: [] },
        {
          name: 'active',
          frames: 4,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'heavy',
                hitbox: midPunch({
                  x: 26,
                  y: -98,
                  width: 60,
                  height: 38,
                  damage: 84,
                  hitstun: 28,
                  blockstun: 14,
                  chipDamage: 4,
                  knockback: { x: 5, y: -6 },
                  launches: true,
                }),
              },
            },
          ],
        },
        { name: 'recovery', frames: 18, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'heavy' } }] },
      ],
    },
    {
      id: 'light_punch',
      displayName: tuning.moveNames.light,
      animation: 'punch',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing', 'attack'],
        sequence: ['lp'],
        window: 6,
        cancelFrom: ['light_punch'],
      },
      phases: [
        { name: 'startup', frames: 3, events: [] },
        { name: 'active', frames: 3, cancellable: true, events: [{ onFrame: 0, event: { type: 'hitbox_active', id: 'jab', hitbox: midPunch() } }] },
        { name: 'recovery', frames: 8, cancellable: true, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'jab' } }] },
      ],
      cancelInto: ['light_punch', 'heavy_punch'],
    },
  ];
}

function makeMrCardboardMoves(): Move[] {
  const crossProjectile: ProjectileConfig = {
    id: 'cardbross_cross_projectile',
    animation: 'cardbross_cross',
    width: 96,
    height: 140,
    speed: 4.6,
    lifetime: 98,
    pierces: 1,
    clashesWithProjectiles: true,
    spawnPolicy: { maxActivePerOwner: 3, ifAlreadyActive: 'block_spawn' },
    hitbox: {
      x: -48,
      y: -70,
      width: 96,
      height: 140,
      damage: 62,
      hitstun: 22,
      blockstun: 14,
      chipDamage: 10,
      knockback: { x: 5.5, y: -1 },
      level: 'mid',
    },
  };

  return addSixFrameVisualTimelines([
    {
      id: 'uppercut',
      displayName: 'Mallet Upper',
      animation: 'special_1',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['forward', 'down', 'down-forward', 'hp'],
        window: 18,
      },
      phases: [
        {
          name: 'startup',
          frames: 6,
          events: [
            { onFrame: 0, event: { type: 'invulnerable', duration: 6, against: ['high', 'mid', 'low', 'projectile'] } },
            { onFrame: 2, event: { type: 'set_velocity', vx: 1.2, vy: -6.8, relativeToFacing: true } },
          ],
        },
        {
          name: 'active',
          frames: 7,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'mallet_rise',
                hitbox: {
                  x: 32,
                  y: -164,
                  width: 104,
                  height: 98,
                  damage: 96,
                  hitstun: 34,
                  blockstun: 17,
                  chipDamage: 7,
                  knockback: { x: 3, y: -8 },
                  level: 'mid',
                  launches: true,
                },
              },
            },
          ],
        },
        { name: 'recovery', frames: 25, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'mallet_rise' } }] },
      ],
      endState: 'airborne',
    },
    {
      id: 'fireball',
      displayName: 'Cardbross Cross',
      animation: 'special_2',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['down', 'down-forward', 'forward', 'hp'],
        window: 20,
      },
      phases: [
        { name: 'startup', frames: 18, events: [] },
        {
          name: 'release',
          frames: 4,
          events: [
            { onFrame: 0, event: { type: 'spawn_projectile', projectile: crossProjectile, offsetX: 78, offsetY: -108 } },
            { onFrame: 0, event: { type: 'screen_shake', intensity: 0.003, duration: 4 } },
          ],
        },
        { name: 'recovery', frames: 14, events: [] },
      ],
    },
    {
      id: 'dash_punch',
      displayName: 'Swordboard Rush',
      animation: 'punch',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'landing'],
        sequence: ['forward', 'forward', 'lp'],
        window: 16,
      },
      phases: [
        { name: 'startup', frames: 7, events: [{ onFrame: 0, event: { type: 'set_velocity', vx: 7.4, relativeToFacing: true } }] },
        {
          name: 'active',
          frames: 5,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'sword_rush',
                hitbox: {
                  x: 38,
                  y: -126,
                  width: 138,
                  height: 42,
                  damage: 72,
                  hitstun: 22,
                  blockstun: 12,
                  knockback: { x: 7, y: -1 },
                  level: 'mid',
                },
              },
            },
          ],
        },
        {
          name: 'recovery',
          frames: 16,
          events: [
            { onFrame: 0, event: { type: 'hitbox_end', id: 'sword_rush' } },
            { onFrame: 0, event: { type: 'set_velocity', vx: 0, relativeToFacing: true } },
          ],
        },
      ],
    },
    {
      id: 'crouch_low_kick',
      displayName: 'Flatpack Sweep',
      animation: 'kick',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['down', 'lk'],
        window: 8,
      },
      phases: [
        { name: 'startup', frames: 4, events: [{ onFrame: 0, event: { type: 'modify_hurtbox', hurtbox: { x: -30, y: -78, width: 60, height: 78 } } }] },
        {
          name: 'active',
          frames: 4,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'flatpack_sweep',
                hitbox: {
                  x: 26,
                  y: -42,
                  width: 128,
                  height: 26,
                  damage: 42,
                  hitstun: 13,
                  blockstun: 10,
                  knockback: { x: 3.2, y: 0 },
                  level: 'low',
                },
              },
            },
          ],
        },
        { name: 'recovery', frames: 10, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'flatpack_sweep' } }] },
      ],
    },
    {
      id: 'heavy_punch',
      displayName: 'Cardboard Sword',
      animation: 'punch',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['hp'],
        window: 6,
      },
      phases: [
        { name: 'startup', frames: 8, events: [] },
        {
          name: 'active',
          frames: 4,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'sword_heavy',
                hitbox: {
                  x: 32,
                  y: -126,
                  width: 148,
                  height: 46,
                  damage: 86,
                  hitstun: 29,
                  blockstun: 15,
                  chipDamage: 5,
                  knockback: { x: 5.6, y: -6 },
                  level: 'mid',
                  launches: true,
                },
              },
            },
          ],
        },
        { name: 'recovery', frames: 18, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'sword_heavy' } }] },
      ],
    },
    {
      id: 'light_punch',
      displayName: 'Boxcutter Jab',
      animation: 'punch',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing', 'attack'],
        sequence: ['lp'],
        window: 6,
        cancelFrom: ['light_punch'],
      },
      phases: [
        { name: 'startup', frames: 3, events: [] },
        {
          name: 'active',
          frames: 3,
          cancellable: true,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'sword_jab',
                hitbox: {
                  x: 30,
                  y: -114,
                  width: 92,
                  height: 32,
                  damage: 46,
                  hitstun: 14,
                  blockstun: 8,
                  knockback: { x: 4, y: 0 },
                  level: 'mid',
                },
              },
            },
          ],
        },
        { name: 'recovery', frames: 8, cancellable: true, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'sword_jab' } }] },
      ],
      cancelInto: ['light_punch', 'heavy_punch'],
    },
  ]);
}

function makeViggoMoves(): Move[] {
  const vestProjectile: ProjectileConfig = {
    id: 'hi_vis_vest_projectile',
    animation: 'hi_vis_vest',
    width: 86,
    height: 48,
    speed: 5,
    lifetime: 90,
    pierces: 1,
    clashesWithProjectiles: true,
    spawnPolicy: { maxActivePerOwner: 3, ifAlreadyActive: 'block_spawn' },
    hitbox: {
      x: -43,
      y: -24,
      width: 86,
      height: 48,
      damage: 56,
      hitstun: 20,
      blockstun: 13,
      chipDamage: 8,
      knockback: { x: 5.2, y: -1 },
      level: 'mid',
    },
  };

  return addSixFrameVisualTimelines([
    {
      id: 'uppercut',
      displayName: 'Fresh Vest Reveal',
      animation: 'special_1',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['forward', 'down', 'down-forward', 'hp'],
        window: 18,
      },
      phases: [
        {
          name: 'startup',
          frames: 6,
          events: [
            { onFrame: 0, event: { type: 'invulnerable', duration: 6, against: ['high', 'mid', 'low', 'projectile'] } },
            { onFrame: 2, event: { type: 'set_velocity', vx: 1.1, vy: -6.9, relativeToFacing: true } },
          ],
        },
        {
          name: 'active',
          frames: 7,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'fresh_reveal',
                hitbox: {
                  x: 24,
                  y: -138,
                  width: 72,
                  height: 92,
                  damage: 88,
                  hitstun: 32,
                  blockstun: 16,
                  chipDamage: 6,
                  knockback: { x: 3.2, y: -8 },
                  level: 'mid',
                  launches: true,
                },
              },
            },
          ],
        },
        { name: 'recovery', frames: 23, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'fresh_reveal' } }] },
      ],
      endState: 'airborne',
    },
    {
      id: 'fireball',
      displayName: 'Hi Vis Toss',
      animation: 'special_2',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['down', 'down-forward', 'forward', 'hp'],
        window: 20,
      },
      phases: [
        { name: 'startup', frames: 16, events: [] },
        {
          name: 'release',
          frames: 4,
          events: [
            { onFrame: 0, event: { type: 'spawn_projectile', projectile: vestProjectile, offsetX: 70, offsetY: -92 } },
            { onFrame: 0, event: { type: 'screen_shake', intensity: 0.002, duration: 3 } },
          ],
        },
        { name: 'recovery', frames: 16, events: [] },
      ],
    },
    {
      id: 'dash_punch',
      displayName: 'Queue Cutter',
      animation: 'punch',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'landing'],
        sequence: ['forward', 'forward', 'lp'],
        window: 16,
      },
      phases: [
        { name: 'startup', frames: 7, events: [{ onFrame: 0, event: { type: 'set_velocity', vx: 7.2, relativeToFacing: true } }] },
        {
          name: 'active',
          frames: 5,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'queue_cutter',
                hitbox: midPunch({ x: 34, y: -96, width: 68, height: 34, damage: 68, hitstun: 22, blockstun: 12, knockback: { x: 7, y: 0 } }),
              },
            },
          ],
        },
        {
          name: 'recovery',
          frames: 15,
          events: [
            { onFrame: 0, event: { type: 'hitbox_end', id: 'queue_cutter' } },
            { onFrame: 0, event: { type: 'set_velocity', vx: 0, relativeToFacing: true } },
          ],
        },
      ],
    },
    {
      id: 'crouch_low_kick',
      displayName: 'Barrier Kick',
      animation: 'kick',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['down', 'lk'],
        window: 8,
      },
      phases: [
        { name: 'startup', frames: 4, events: [{ onFrame: 0, event: { type: 'modify_hurtbox', hurtbox: { x: -26, y: -80, width: 52, height: 80 } } }] },
        {
          name: 'active',
          frames: 4,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'barrier_kick',
                hitbox: {
                  x: 22,
                  y: -38,
                  width: 82,
                  height: 24,
                  damage: 39,
                  hitstun: 12,
                  blockstun: 9,
                  knockback: { x: 3.2, y: 0 },
                  level: 'low',
                },
              },
            },
          ],
        },
        { name: 'recovery', frames: 10, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'barrier_kick' } }] },
      ],
    },
    {
      id: 'heavy_punch',
      displayName: 'Reflective Cross',
      animation: 'punch',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['hp'],
        window: 6,
      },
      phases: [
        { name: 'startup', frames: 8, events: [] },
        {
          name: 'active',
          frames: 4,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'reflective_cross',
                hitbox: midPunch({
                  x: 28,
                  y: -100,
                  width: 70,
                  height: 40,
                  damage: 80,
                  hitstun: 27,
                  blockstun: 14,
                  chipDamage: 4,
                  knockback: { x: 5.2, y: -5.5 },
                  launches: true,
                }),
              },
            },
          ],
        },
        { name: 'recovery', frames: 18, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'reflective_cross' } }] },
      ],
    },
    {
      id: 'light_punch',
      displayName: 'Queue Check',
      animation: 'punch',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing', 'attack'],
        sequence: ['lp'],
        window: 6,
        cancelFrom: ['light_punch'],
      },
      phases: [
        { name: 'startup', frames: 3, events: [] },
        { name: 'active', frames: 3, cancellable: true, events: [{ onFrame: 0, event: { type: 'hitbox_active', id: 'queue_jab', hitbox: midPunch() } }] },
        { name: 'recovery', frames: 8, cancellable: true, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'queue_jab' } }] },
      ],
      cancelInto: ['light_punch', 'heavy_punch'],
    },
  ]);
}

function makeJanitorMoves(): Move[] {
  const bucketWave: ProjectileConfig = {
    id: 'bucket_wave_projectile',
    animation: 'bucket_wave',
    width: 112,
    height: 46,
    speed: 4.7,
    lifetime: 94,
    pierces: 1,
    gravity: 0,
    clashesWithProjectiles: true,
    spawnPolicy: { maxActivePerOwner: 3, ifAlreadyActive: 'block_spawn' },
    hitbox: {
      x: -56,
      y: -24,
      width: 112,
      height: 46,
      damage: 58,
      hitstun: 22,
      blockstun: 15,
      chipDamage: 9,
      knockback: { x: 4.8, y: 0 },
      level: 'low',
    },
  };

  return addSixFrameVisualTimelines([
    {
      id: 'uppercut',
      displayName: 'Mop Launch',
      animation: 'special_1',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['forward', 'down', 'down-forward', 'hp'],
        window: 18,
      },
      phases: [
        {
          name: 'startup',
          frames: 6,
          events: [
            { onFrame: 0, event: { type: 'invulnerable', duration: 6, against: ['high', 'mid', 'low', 'projectile'] } },
            { onFrame: 2, event: { type: 'set_velocity', vx: 0.9, vy: -6.4, relativeToFacing: true } },
          ],
        },
        {
          name: 'active',
          frames: 7,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'mop_launch',
                hitbox: {
                  x: 26,
                  y: -154,
                  width: 82,
                  height: 108,
                  damage: 92,
                  hitstun: 34,
                  blockstun: 17,
                  chipDamage: 7,
                  knockback: { x: 2.8, y: -8.2 },
                  level: 'mid',
                  launches: true,
                },
              },
            },
          ],
        },
        { name: 'recovery', frames: 25, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'mop_launch' } }] },
      ],
      endState: 'airborne',
    },
    {
      id: 'fireball',
      displayName: 'Bucket Wave',
      animation: 'special_2',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['down', 'down-forward', 'forward', 'hp'],
        window: 20,
      },
      phases: [
        { name: 'startup', frames: 15, events: [] },
        {
          name: 'release',
          frames: 5,
          events: [
            { onFrame: 0, event: { type: 'spawn_projectile', projectile: bucketWave, offsetX: 84, offsetY: -40 } },
            { onFrame: 0, event: { type: 'screen_shake', intensity: 0.002, duration: 4 } },
          ],
        },
        { name: 'recovery', frames: 17, events: [] },
      ],
    },
    {
      id: 'dash_punch',
      displayName: 'Mop Rush',
      animation: 'punch',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'landing'],
        sequence: ['forward', 'forward', 'lp'],
        window: 16,
      },
      phases: [
        { name: 'startup', frames: 8, events: [{ onFrame: 0, event: { type: 'set_velocity', vx: 6.4, relativeToFacing: true } }] },
        {
          name: 'active',
          frames: 5,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'mop_rush',
                hitbox: midPunch({ x: 36, y: -100, width: 112, height: 32, damage: 72, hitstun: 23, blockstun: 13, knockback: { x: 7.2, y: 0 } }),
              },
            },
          ],
        },
        {
          name: 'recovery',
          frames: 16,
          events: [
            { onFrame: 0, event: { type: 'hitbox_end', id: 'mop_rush' } },
            { onFrame: 0, event: { type: 'set_velocity', vx: 0, relativeToFacing: true } },
          ],
        },
      ],
    },
    {
      id: 'crouch_low_kick',
      displayName: 'Wet Sweep',
      animation: 'kick',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['down', 'lk'],
        window: 8,
      },
      phases: [
        { name: 'startup', frames: 4, events: [{ onFrame: 0, event: { type: 'modify_hurtbox', hurtbox: { x: -32, y: -78, width: 64, height: 78 } } }] },
        {
          name: 'active',
          frames: 4,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'wet_sweep',
                hitbox: {
                  x: 22,
                  y: -36,
                  width: 132,
                  height: 24,
                  damage: 42,
                  hitstun: 13,
                  blockstun: 10,
                  knockback: { x: 3.4, y: 0 },
                  level: 'low',
                },
              },
            },
          ],
        },
        { name: 'recovery', frames: 10, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'wet_sweep' } }] },
      ],
    },
    {
      id: 'heavy_punch',
      displayName: 'Mop Check',
      animation: 'punch',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['hp'],
        window: 6,
      },
      phases: [
        { name: 'startup', frames: 8, events: [] },
        {
          name: 'active',
          frames: 4,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'mop_check',
                hitbox: midPunch({
                  x: 30,
                  y: -106,
                  width: 124,
                  height: 34,
                  damage: 84,
                  hitstun: 29,
                  blockstun: 15,
                  chipDamage: 5,
                  knockback: { x: 5.4, y: -5 },
                  launches: true,
                }),
              },
            },
          ],
        },
        { name: 'recovery', frames: 18, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'mop_check' } }] },
      ],
    },
    {
      id: 'light_punch',
      displayName: 'Quick Wipe',
      animation: 'punch',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing', 'attack'],
        sequence: ['lp'],
        window: 6,
        cancelFrom: ['light_punch'],
      },
      phases: [
        { name: 'startup', frames: 3, events: [] },
        {
          name: 'active',
          frames: 3,
          cancellable: true,
          events: [{ onFrame: 0, event: { type: 'hitbox_active', id: 'quick_wipe', hitbox: midPunch({ x: 30, width: 78, damage: 46 }) } }],
        },
        { name: 'recovery', frames: 8, cancellable: true, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'quick_wipe' } }] },
      ],
      cancelInto: ['light_punch', 'heavy_punch'],
    },
  ]);
}

function makeJackTuckerMoves(): Move[] {
  const appleShards: ProjectileConfig = {
    id: 'apple_shards_projectile',
    animation: 'apple_shards',
    width: 118,
    height: 42,
    speed: 5.6,
    lifetime: 82,
    pierces: 1,
    clashesWithProjectiles: true,
    spawnPolicy: { maxActivePerOwner: 3, ifAlreadyActive: 'block_spawn' },
    hitbox: {
      x: -59,
      y: -21,
      width: 118,
      height: 42,
      damage: 64,
      hitstun: 23,
      blockstun: 14,
      chipDamage: 9,
      knockback: { x: 5.8, y: -1 },
      level: 'mid',
    },
  };

  return addSixFrameVisualTimelines([
    {
      id: 'uppercut',
      displayName: 'Rising Punchline',
      animation: 'special_1',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['forward', 'down', 'down-forward', 'hp'],
        window: 18,
      },
      phases: [
        {
          name: 'startup',
          frames: 6,
          events: [
            { onFrame: 0, event: { type: 'invulnerable', duration: 6, against: ['high', 'mid', 'low', 'projectile'] } },
            { onFrame: 2, event: { type: 'set_velocity', vx: 1.2, vy: -7, relativeToFacing: true } },
          ],
        },
        {
          name: 'active',
          frames: 7,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'rising_punchline',
                hitbox: {
                  x: 24,
                  y: -148,
                  width: 76,
                  height: 96,
                  damage: 91,
                  hitstun: 34,
                  blockstun: 17,
                  chipDamage: 7,
                  knockback: { x: 3.2, y: -8.2 },
                  level: 'mid',
                  launches: true,
                },
              },
            },
          ],
        },
        { name: 'recovery', frames: 24, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'rising_punchline' } }] },
      ],
      endState: 'airborne',
    },
    {
      id: 'fireball',
      displayName: 'Apple Smash',
      animation: 'special_2',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['down', 'down-forward', 'forward', 'hp'],
        window: 20,
      },
      phases: [
        { name: 'startup', frames: 18, events: [] },
        {
          name: 'release',
          frames: 4,
          events: [
            { onFrame: 0, event: { type: 'spawn_projectile', projectile: appleShards, offsetX: 82, offsetY: -96 } },
            { onFrame: 0, event: { type: 'screen_shake', intensity: 0.003, duration: 4 } },
          ],
        },
        { name: 'recovery', frames: 16, events: [] },
      ],
    },
    {
      id: 'dash_punch',
      displayName: 'Stage Rush',
      animation: 'punch',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'landing'],
        sequence: ['forward', 'forward', 'lp'],
        window: 16,
      },
      phases: [
        { name: 'startup', frames: 7, events: [{ onFrame: 0, event: { type: 'set_velocity', vx: 7.1, relativeToFacing: true } }] },
        {
          name: 'active',
          frames: 5,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'stage_rush',
                hitbox: midPunch({ x: 34, y: -98, width: 86, height: 34, damage: 70, hitstun: 22, blockstun: 12, knockback: { x: 7, y: 0 } }),
              },
            },
          ],
        },
        {
          name: 'recovery',
          frames: 15,
          events: [
            { onFrame: 0, event: { type: 'hitbox_end', id: 'stage_rush' } },
            { onFrame: 0, event: { type: 'set_velocity', vx: 0, relativeToFacing: true } },
          ],
        },
      ],
    },
    {
      id: 'crouch_low_kick',
      displayName: 'Star Boot',
      animation: 'kick',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['down', 'lk'],
        window: 8,
      },
      phases: [
        { name: 'startup', frames: 4, events: [{ onFrame: 0, event: { type: 'modify_hurtbox', hurtbox: { x: -28, y: -80, width: 56, height: 80 } } }] },
        {
          name: 'active',
          frames: 4,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'star_boot',
                hitbox: {
                  x: 22,
                  y: -38,
                  width: 92,
                  height: 24,
                  damage: 40,
                  hitstun: 12,
                  blockstun: 9,
                  knockback: { x: 3.3, y: 0 },
                  level: 'low',
                },
              },
            },
          ],
        },
        { name: 'recovery', frames: 10, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'star_boot' } }] },
      ],
    },
    {
      id: 'heavy_punch',
      displayName: 'Mic Drop',
      animation: 'punch',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['hp'],
        window: 6,
      },
      phases: [
        { name: 'startup', frames: 8, events: [] },
        {
          name: 'active',
          frames: 4,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'mic_drop',
                hitbox: midPunch({
                  x: 30,
                  y: -104,
                  width: 112,
                  height: 34,
                  damage: 83,
                  hitstun: 28,
                  blockstun: 14,
                  chipDamage: 5,
                  knockback: { x: 5.4, y: -5.5 },
                  launches: true,
                }),
              },
            },
          ],
        },
        { name: 'recovery', frames: 18, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'mic_drop' } }] },
      ],
    },
    {
      id: 'light_punch',
      displayName: 'Mic Check',
      animation: 'punch',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing', 'attack'],
        sequence: ['lp'],
        window: 6,
        cancelFrom: ['light_punch'],
      },
      phases: [
        { name: 'startup', frames: 3, events: [] },
        { name: 'active', frames: 3, cancellable: true, events: [{ onFrame: 0, event: { type: 'hitbox_active', id: 'mic_check', hitbox: midPunch({ x: 30, width: 72 }) } }] },
        { name: 'recovery', frames: 8, cancellable: true, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'mic_check' } }] },
      ],
      cancelInto: ['light_punch', 'heavy_punch'],
    },
  ]);
}

function makeMartinUrbanoMoves(): Move[] {
  const firebolt: ProjectileConfig = {
    id: 'martin_firebolt_projectile',
    animation: 'martin_firebolt',
    width: 117,
    height: 80,
    speed: 5.8,
    lifetime: 84,
    pierces: 1,
    clashesWithProjectiles: true,
    spawnPolicy: { maxActivePerOwner: 3, ifAlreadyActive: 'block_spawn' },
    hitbox: {
      x: -52,
      y: -32,
      width: 104,
      height: 52,
      damage: 62,
      hitstun: 23,
      blockstun: 14,
      chipDamage: 9,
      knockback: { x: 5.7, y: -1 },
      level: 'mid',
    },
  };
  const inkSpark: ProjectileConfig = {
    id: 'martin_ink_spark_projectile',
    animation: 'martin_ink_spark',
    width: 88,
    height: 42,
    speed: 6.4,
    lifetime: 42,
    pierces: 1,
    clashesWithProjectiles: true,
    spawnPolicy: { maxActivePerOwner: 2, ifAlreadyActive: 'replace_oldest' },
    hitbox: {
      x: -38,
      y: -18,
      width: 76,
      height: 30,
      damage: 34,
      hitstun: 13,
      blockstun: 8,
      chipDamage: 4,
      knockback: { x: 3.4, y: 0 },
      level: 'mid',
    },
  };
  const groundRune: ProjectileConfig = {
    id: 'martin_ground_rune_projectile',
    animation: 'martin_ground_rune',
    width: 112,
    height: 48,
    speed: 4.9,
    lifetime: 70,
    pierces: 1,
    clashesWithProjectiles: false,
    spawnPolicy: { maxActivePerOwner: 2, ifAlreadyActive: 'replace_oldest' },
    hitbox: {
      x: -52,
      y: -18,
      width: 104,
      height: 24,
      damage: 42,
      hitstun: 14,
      blockstun: 10,
      chipDamage: 5,
      knockback: { x: 3.6, y: 0 },
      level: 'low',
    },
  };
  const lightningFromSky: ProjectileConfig = {
    id: 'martin_lightning_from_sky_projectile',
    animation: 'martin_lightning_from_sky',
    width: 96,
    height: 260,
    speed: 0,
    velocity: { y: 18, relativeToFacing: false },
    lifetime: 24,
    pierces: 99,
    clashesWithProjectiles: false,
    spawnPolicy: { maxActivePerOwner: 1, ifAlreadyActive: 'replace_oldest' },
    hitbox: {
      x: -38,
      y: -126,
      width: 76,
      height: 218,
      damage: 86,
      hitstun: 30,
      blockstun: 16,
      chipDamage: 7,
      knockback: { x: 2.8, y: -8 },
      level: 'mid',
      launches: true,
    },
  };

  return addSixFrameVisualTimelines([
    {
      id: 'uppercut',
      displayName: 'Pen Is Mightier',
      animation: 'special_2',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['forward', 'down', 'down-forward', 'hp'],
        window: 18,
      },
      phases: [
        {
          name: 'startup',
          frames: 7,
          events: [{ onFrame: 0, event: { type: 'invulnerable', duration: 7, against: ['high', 'mid', 'low', 'projectile'] } }],
        },
        {
          name: 'active',
          frames: 8,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'pen_blade',
                hitbox: {
                  x: 28,
                  y: -132,
                  width: 172,
                  height: 74,
                  damage: 94,
                  hitstun: 34,
                  blockstun: 17,
                  chipDamage: 7,
                  knockback: { x: 4.8, y: -6.5 },
                  level: 'mid',
                  launches: true,
                },
              },
            },
            { onFrame: 0, event: { type: 'screen_shake', intensity: 0.003, duration: 4 } },
          ],
        },
        { name: 'recovery', frames: 24, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'pen_blade' } }] },
      ],
    },
    {
      id: 'fireball',
      displayName: 'Firebolt Draft',
      animation: 'special_1',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['down', 'down-forward', 'forward', 'hp'],
        window: 20,
      },
      phases: [
        { name: 'startup', frames: 16, events: [] },
        {
          name: 'release',
          frames: 4,
          events: [
            { onFrame: 0, event: { type: 'spawn_projectile', projectile: firebolt, offsetX: 82, offsetY: -92 } },
            { onFrame: 0, event: { type: 'screen_shake', intensity: 0.002, duration: 3 } },
          ],
        },
        { name: 'recovery', frames: 17, events: [] },
      ],
    },
    {
      id: 'dash_punch',
      displayName: 'Run-On Spark',
      animation: 'special_1',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'landing'],
        sequence: ['forward', 'forward', 'lp'],
        window: 16,
      },
      phases: [
        { name: 'startup', frames: 8, events: [{ onFrame: 0, event: { type: 'set_velocity', vx: 2.2, relativeToFacing: true } }] },
        {
          name: 'release',
          frames: 5,
          events: [
            { onFrame: 0, event: { type: 'spawn_projectile', projectile: inkSpark, offsetX: 78, offsetY: -88 } },
            { onFrame: 2, event: { type: 'spawn_projectile', projectile: firebolt, offsetX: 92, offsetY: -92 } },
          ],
        },
        {
          name: 'recovery',
          frames: 16,
          events: [
            { onFrame: 0, event: { type: 'set_velocity', vx: 0, relativeToFacing: true } },
          ],
        },
      ],
    },
    {
      id: 'crouch_low_kick',
      displayName: 'Ground Rune',
      animation: 'special_1',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['down', 'lk'],
        window: 8,
      },
      phases: [
        { name: 'startup', frames: 4, events: [{ onFrame: 0, event: { type: 'modify_hurtbox', hurtbox: { x: -27, y: -80, width: 54, height: 80 } } }] },
        {
          name: 'release',
          frames: 4,
          events: [{ onFrame: 0, event: { type: 'spawn_projectile', projectile: groundRune, offsetX: 64, offsetY: -24 } }],
        },
        { name: 'recovery', frames: 10, events: [] },
      ],
    },
    {
      id: 'heavy_punch',
      displayName: 'Lightning from the Sky',
      animation: 'special_1',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['hp'],
        window: 6,
      },
      phases: [
        { name: 'startup', frames: 12, events: [] },
        {
          name: 'strike',
          frames: 5,
          events: [
            { onFrame: 0, event: { type: 'spawn_projectile_from_sky', projectile: lightningFromSky, targetOffsetX: 0, spawnOffsetY: -300 } },
            { onFrame: 0, event: { type: 'screen_shake', intensity: 0.004, duration: 5 } },
          ],
        },
        { name: 'recovery', frames: 21, events: [] },
      ],
    },
    {
      id: 'light_punch',
      displayName: 'Ink Spark',
      animation: 'special_1',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing', 'attack'],
        sequence: ['lp'],
        window: 6,
        cancelFrom: ['light_punch'],
      },
      phases: [
        { name: 'startup', frames: 5, events: [] },
        { name: 'release', frames: 3, cancellable: true, events: [{ onFrame: 0, event: { type: 'spawn_projectile', projectile: inkSpark, offsetX: 64, offsetY: -86 } }] },
        { name: 'recovery', frames: 9, cancellable: true, events: [] },
      ],
      cancelInto: ['light_punch', 'heavy_punch'],
    },
  ]);
}

function makeDylanSaxMoves(): Move[] {
  const purpleNoteWave: ProjectileConfig = {
    id: 'purple_note_wave_projectile',
    animation: 'purple_note_wave',
    width: 244,
    height: 137,
    speed: 5.3,
    lifetime: 88,
    pierces: 1,
    clashesWithProjectiles: true,
    spawnPolicy: { maxActivePerOwner: 3, ifAlreadyActive: 'replace_oldest' },
    hitbox: {
      x: -66,
      y: -40,
      width: 132,
      height: 70,
      damage: 62,
      hitstun: 23,
      blockstun: 14,
      chipDamage: 9,
      knockback: { x: 5.7, y: -1 },
      level: 'mid',
    },
  };

  return addSixFrameVisualTimelines([
    {
      id: 'uppercut',
      displayName: 'Brass Upper',
      animation: 'special_1',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['forward', 'down', 'down-forward', 'hp'],
        window: 18,
      },
      phases: [
        { name: 'startup', frames: 6, events: [{ onFrame: 0, event: { type: 'invulnerable', duration: 5, against: ['high', 'mid', 'low'] } }] },
        {
          name: 'active',
          frames: 8,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'brass_upper',
                hitbox: {
                  x: 24,
                  y: -148,
                  width: 88,
                  height: 104,
                  damage: 90,
                  hitstun: 33,
                  blockstun: 16,
                  chipDamage: 6,
                  knockback: { x: 3.2, y: -8 },
                  level: 'mid',
                  launches: true,
                },
              },
            },
          ],
        },
        { name: 'recovery', frames: 23, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'brass_upper' } }] },
      ],
    },
    {
      id: 'fireball',
      displayName: 'Purple Note Cannon',
      animation: 'special_2',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['down', 'down-forward', 'forward', 'hp'],
        window: 20,
      },
      phases: [
        { name: 'startup', frames: 15, events: [] },
        {
          name: 'release',
          frames: 5,
          events: [
            { onFrame: 0, event: { type: 'spawn_projectile', projectile: purpleNoteWave, offsetX: 92, offsetY: -94 } },
            { onFrame: 0, event: { type: 'screen_shake', intensity: 0.002, duration: 3 } },
          ],
        },
        { name: 'recovery', frames: 17, events: [] },
      ],
    },
    {
      id: 'dash_punch',
      displayName: 'Horn Rush',
      animation: 'punch',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'landing'],
        sequence: ['forward', 'forward', 'lp'],
        window: 16,
      },
      phases: [
        { name: 'startup', frames: 7, events: [{ onFrame: 0, event: { type: 'set_velocity', vx: 6.9, relativeToFacing: true } }] },
        {
          name: 'active',
          frames: 5,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'horn_rush',
                hitbox: midPunch({ x: 36, y: -106, width: 116, height: 36, damage: 72, hitstun: 23, blockstun: 13, knockback: { x: 7.2, y: 0 } }),
              },
            },
          ],
        },
        {
          name: 'recovery',
          frames: 16,
          events: [
            { onFrame: 0, event: { type: 'hitbox_end', id: 'horn_rush' } },
            { onFrame: 0, event: { type: 'set_velocity', vx: 0, relativeToFacing: true } },
          ],
        },
      ],
    },
    {
      id: 'crouch_low_kick',
      displayName: 'Stage Sweep',
      animation: 'kick',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['down', 'lk'],
        window: 8,
      },
      phases: [
        { name: 'startup', frames: 4, events: [{ onFrame: 0, event: { type: 'modify_hurtbox', hurtbox: { x: -28, y: -80, width: 56, height: 80 } } }] },
        {
          name: 'active',
          frames: 4,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'stage_sweep',
                hitbox: {
                  x: 20,
                  y: -40,
                  width: 112,
                  height: 24,
                  damage: 42,
                  hitstun: 13,
                  blockstun: 10,
                  knockback: { x: 3.4, y: 0 },
                  level: 'low',
                },
              },
            },
          ],
        },
        { name: 'recovery', frames: 10, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'stage_sweep' } }] },
      ],
    },
    {
      id: 'heavy_punch',
      displayName: 'Bell Ringer',
      animation: 'punch',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['hp'],
        window: 6,
      },
      phases: [
        { name: 'startup', frames: 8, events: [] },
        {
          name: 'active',
          frames: 4,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'bell_ringer',
                hitbox: midPunch({
                  x: 34,
                  y: -112,
                  width: 128,
                  height: 46,
                  damage: 84,
                  hitstun: 29,
                  blockstun: 15,
                  chipDamage: 5,
                  knockback: { x: 5.4, y: -5 },
                  launches: true,
                }),
              },
            },
          ],
        },
        { name: 'recovery', frames: 18, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'bell_ringer' } }] },
      ],
    },
    {
      id: 'light_punch',
      displayName: 'Horn Jab',
      animation: 'punch',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing', 'attack'],
        sequence: ['lp'],
        window: 6,
        cancelFrom: ['light_punch'],
      },
      phases: [
        { name: 'startup', frames: 3, events: [] },
        { name: 'active', frames: 3, cancellable: true, events: [{ onFrame: 0, event: { type: 'hitbox_active', id: 'horn_jab', hitbox: midPunch({ x: 30, y: -102, width: 92, height: 30, damage: 45 }) } }] },
        { name: 'recovery', frames: 8, cancellable: true, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'horn_jab' } }] },
      ],
      cancelInto: ['light_punch', 'heavy_punch'],
    },
  ]);
}

function makeCoreyMoves(): Move[] {
  const foamWave: ProjectileConfig = {
    id: 'foam_wave_projectile',
    animation: 'foam_wave',
    width: 237,
    height: 79,
    speed: 4.8,
    lifetime: 90,
    pierces: 1,
    clashesWithProjectiles: true,
    spawnPolicy: { maxActivePerOwner: 3, ifAlreadyActive: 'replace_oldest' },
    hitbox: {
      x: -78,
      y: -30,
      width: 156,
      height: 44,
      damage: 60,
      hitstun: 23,
      blockstun: 15,
      chipDamage: 10,
      knockback: { x: 5, y: 0 },
      level: 'mid',
    },
  };

  return addSixFrameVisualTimelines([
    {
      id: 'uppercut',
      displayName: 'Shake and Spray',
      animation: 'special_1',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['forward', 'down', 'down-forward', 'hp'],
        window: 18,
      },
      phases: [
        { name: 'startup', frames: 7, events: [{ onFrame: 0, event: { type: 'invulnerable', duration: 5, against: ['high', 'mid', 'low'] } }] },
        {
          name: 'active',
          frames: 8,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'shake_spray',
                hitbox: {
                  x: 28,
                  y: -128,
                  width: 108,
                  height: 82,
                  damage: 88,
                  hitstun: 33,
                  blockstun: 16,
                  chipDamage: 8,
                  knockback: { x: 3.6, y: -7.5 },
                  level: 'mid',
                  launches: true,
                },
              },
            },
          ],
        },
        { name: 'recovery', frames: 24, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'shake_spray' } }] },
      ],
    },
    {
      id: 'fireball',
      displayName: 'Foam Wave',
      animation: 'special_2',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['down', 'down-forward', 'forward', 'hp'],
        window: 20,
      },
      phases: [
        { name: 'startup', frames: 16, events: [] },
        {
          name: 'release',
          frames: 5,
          events: [
            { onFrame: 0, event: { type: 'spawn_projectile', projectile: foamWave, offsetX: 84, offsetY: -72 } },
            { onFrame: 0, event: { type: 'screen_shake', intensity: 0.002, duration: 4 } },
          ],
        },
        { name: 'recovery', frames: 17, events: [] },
      ],
    },
    {
      id: 'dash_punch',
      displayName: 'Can Rush',
      animation: 'punch',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'landing'],
        sequence: ['forward', 'forward', 'lp'],
        window: 16,
      },
      phases: [
        { name: 'startup', frames: 8, events: [{ onFrame: 0, event: { type: 'set_velocity', vx: 6.2, relativeToFacing: true } }] },
        {
          name: 'active',
          frames: 5,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'can_rush',
                hitbox: midPunch({ x: 36, y: -104, width: 96, height: 38, damage: 74, hitstun: 24, blockstun: 13, knockback: { x: 7, y: 0 } }),
              },
            },
          ],
        },
        {
          name: 'recovery',
          frames: 17,
          events: [
            { onFrame: 0, event: { type: 'hitbox_end', id: 'can_rush' } },
            { onFrame: 0, event: { type: 'set_velocity', vx: 0, relativeToFacing: true } },
          ],
        },
      ],
    },
    {
      id: 'crouch_low_kick',
      displayName: 'Wet Boot',
      animation: 'kick',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['down', 'lk'],
        window: 8,
      },
      phases: [
        { name: 'startup', frames: 5, events: [{ onFrame: 0, event: { type: 'modify_hurtbox', hurtbox: { x: -34, y: -82, width: 68, height: 82 } } }] },
        {
          name: 'active',
          frames: 4,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'wet_boot',
                hitbox: {
                  x: 22,
                  y: -40,
                  width: 116,
                  height: 26,
                  damage: 43,
                  hitstun: 13,
                  blockstun: 10,
                  knockback: { x: 3.6, y: 0 },
                  level: 'low',
                },
              },
            },
          ],
        },
        { name: 'recovery', frames: 11, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'wet_boot' } }] },
      ],
    },
    {
      id: 'heavy_punch',
      displayName: 'Can Crush',
      animation: 'punch',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['hp'],
        window: 6,
      },
      phases: [
        { name: 'startup', frames: 9, events: [] },
        {
          name: 'active',
          frames: 4,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'can_crush',
                hitbox: midPunch({
                  x: 28,
                  y: -112,
                  width: 86,
                  height: 44,
                  damage: 86,
                  hitstun: 30,
                  blockstun: 15,
                  chipDamage: 5,
                  knockback: { x: 5.2, y: -5.5 },
                  launches: true,
                }),
              },
            },
          ],
        },
        { name: 'recovery', frames: 19, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'can_crush' } }] },
      ],
    },
    {
      id: 'light_punch',
      displayName: 'Can Opener',
      animation: 'punch',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing', 'attack'],
        sequence: ['lp'],
        window: 6,
        cancelFrom: ['light_punch'],
      },
      phases: [
        { name: 'startup', frames: 4, events: [] },
        { name: 'active', frames: 3, cancellable: true, events: [{ onFrame: 0, event: { type: 'hitbox_active', id: 'can_opener', hitbox: midPunch({ x: 28, y: -100, width: 76, height: 32, damage: 46 }) } }] },
        { name: 'recovery', frames: 9, cancellable: true, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'can_opener' } }] },
      ],
      cancelInto: ['light_punch', 'heavy_punch'],
    },
  ]);
}

function makeJugglingJoeMoves(): Move[] {
  const jugglingBalls: ProjectileConfig = {
    id: 'juggling_balls_projectile',
    animation: 'juggling_balls',
    width: 183,
    height: 131,
    speed: 5.5,
    lifetime: 86,
    pierces: 1,
    clashesWithProjectiles: true,
    spawnPolicy: { maxActivePerOwner: 3, ifAlreadyActive: 'replace_oldest' },
    hitbox: {
      x: -72,
      y: -46,
      width: 144,
      height: 82,
      damage: 62,
      hitstun: 24,
      blockstun: 15,
      chipDamage: 9,
      knockback: { x: 5.6, y: -1 },
      level: 'mid',
    },
  };

  return addSixFrameVisualTimelines([
    {
      id: 'uppercut',
      displayName: 'Juggle Cyclone',
      animation: 'special_1',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['forward', 'down', 'down-forward', 'hp'],
        window: 18,
      },
      phases: [
        { name: 'startup', frames: 7, events: [{ onFrame: 0, event: { type: 'invulnerable', duration: 5, against: ['high', 'mid', 'low'] } }] },
        {
          name: 'active',
          frames: 8,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'juggle_cyclone',
                hitbox: {
                  x: 18,
                  y: -136,
                  width: 128,
                  height: 104,
                  damage: 90,
                  hitstun: 34,
                  blockstun: 17,
                  chipDamage: 7,
                  knockback: { x: 3.6, y: -7.8 },
                  level: 'mid',
                  launches: true,
                },
              },
            },
          ],
        },
        { name: 'recovery', frames: 24, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'juggle_cyclone' } }] },
      ],
    },
    {
      id: 'fireball',
      displayName: 'Juggling Barrage',
      animation: 'special_2',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['down', 'down-forward', 'forward', 'hp'],
        window: 20,
      },
      phases: [
        { name: 'startup', frames: 15, events: [] },
        {
          name: 'release',
          frames: 5,
          events: [
            { onFrame: 0, event: { type: 'spawn_projectile', projectile: jugglingBalls, offsetX: 86, offsetY: -92 } },
            { onFrame: 0, event: { type: 'screen_shake', intensity: 0.002, duration: 3 } },
          ],
        },
        { name: 'recovery', frames: 17, events: [] },
      ],
    },
    {
      id: 'dash_punch',
      displayName: 'Cascade Rush',
      animation: 'punch',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'landing'],
        sequence: ['forward', 'forward', 'lp'],
        window: 16,
      },
      phases: [
        { name: 'startup', frames: 7, events: [{ onFrame: 0, event: { type: 'set_velocity', vx: 6.6, relativeToFacing: true } }] },
        {
          name: 'active',
          frames: 5,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'cascade_rush',
                hitbox: midPunch({ x: 34, y: -104, width: 92, height: 34, damage: 70, hitstun: 23, blockstun: 13, knockback: { x: 6.8, y: 0 } }),
              },
            },
          ],
        },
        {
          name: 'recovery',
          frames: 16,
          events: [
            { onFrame: 0, event: { type: 'hitbox_end', id: 'cascade_rush' } },
            { onFrame: 0, event: { type: 'set_velocity', vx: 0, relativeToFacing: true } },
          ],
        },
      ],
    },
    {
      id: 'crouch_low_kick',
      displayName: 'Formal Shoe Sweep',
      animation: 'kick',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['down', 'lk'],
        window: 8,
      },
      phases: [
        { name: 'startup', frames: 4, events: [{ onFrame: 0, event: { type: 'modify_hurtbox', hurtbox: { x: -27, y: -80, width: 54, height: 80 } } }] },
        {
          name: 'active',
          frames: 4,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'formal_sweep',
                hitbox: {
                  x: 20,
                  y: -38,
                  width: 116,
                  height: 24,
                  damage: 42,
                  hitstun: 13,
                  blockstun: 10,
                  knockback: { x: 3.4, y: 0 },
                  level: 'low',
                },
              },
            },
          ],
        },
        { name: 'recovery', frames: 10, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'formal_sweep' } }] },
      ],
    },
    {
      id: 'heavy_punch',
      displayName: 'Ball-Palmed Cross',
      animation: 'punch',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['hp'],
        window: 6,
      },
      phases: [
        { name: 'startup', frames: 8, events: [] },
        {
          name: 'active',
          frames: 4,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'ball_cross',
                hitbox: midPunch({
                  x: 30,
                  y: -104,
                  width: 94,
                  height: 42,
                  damage: 84,
                  hitstun: 29,
                  blockstun: 15,
                  chipDamage: 5,
                  knockback: { x: 5.4, y: -5.2 },
                  launches: true,
                }),
              },
            },
          ],
        },
        { name: 'recovery', frames: 18, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'ball_cross' } }] },
      ],
    },
    {
      id: 'light_punch',
      displayName: 'Ball-Palmed Jab',
      animation: 'punch',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing', 'attack'],
        sequence: ['lp'],
        window: 6,
        cancelFrom: ['light_punch'],
      },
      phases: [
        { name: 'startup', frames: 3, events: [] },
        { name: 'active', frames: 3, cancellable: true, events: [{ onFrame: 0, event: { type: 'hitbox_active', id: 'ball_jab', hitbox: midPunch({ x: 28, y: -98, width: 74, height: 30, damage: 45 }) } }] },
        { name: 'recovery', frames: 8, cancellable: true, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'ball_jab' } }] },
      ],
      cancelInto: ['light_punch', 'heavy_punch'],
    },
  ]);
}

function makeRubberChickenMoves(): Move[] {
  const squeakStorm: ProjectileConfig = {
    id: 'squeak_storm_projectile',
    animation: 'squeak_storm',
    width: 239,
    height: 159,
    speed: 4.9,
    lifetime: 88,
    pierces: 1,
    clashesWithProjectiles: true,
    spawnPolicy: { maxActivePerOwner: 3, ifAlreadyActive: 'replace_oldest' },
    hitbox: {
      x: -80,
      y: -44,
      width: 160,
      height: 78,
      damage: 60,
      hitstun: 24,
      blockstun: 15,
      chipDamage: 10,
      knockback: { x: 5, y: -1 },
      level: 'mid',
    },
  };

  return addSixFrameVisualTimelines([
    {
      id: 'uppercut',
      displayName: 'Elastic Neck Snap',
      animation: 'special_1',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['forward', 'down', 'down-forward', 'hp'],
        window: 18,
      },
      phases: [
        { name: 'startup', frames: 6, events: [{ onFrame: 0, event: { type: 'invulnerable', duration: 5, against: ['high', 'mid', 'low'] } }] },
        {
          name: 'active',
          frames: 8,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'elastic_neck',
                hitbox: {
                  x: 28,
                  y: -128,
                  width: 168,
                  height: 72,
                  damage: 88,
                  hitstun: 33,
                  blockstun: 17,
                  chipDamage: 7,
                  knockback: { x: 4.5, y: -6.5 },
                  level: 'mid',
                  launches: true,
                },
              },
            },
            { onFrame: 0, event: { type: 'screen_shake', intensity: 0.002, duration: 3 } },
          ],
        },
        { name: 'recovery', frames: 24, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'elastic_neck' } }] },
      ],
    },
    {
      id: 'fireball',
      displayName: 'Squeak Storm',
      animation: 'special_2',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['down', 'down-forward', 'forward', 'hp'],
        window: 20,
      },
      phases: [
        { name: 'startup', frames: 15, events: [] },
        {
          name: 'release',
          frames: 5,
          events: [
            { onFrame: 0, event: { type: 'spawn_projectile', projectile: squeakStorm, offsetX: 82, offsetY: -88 } },
            { onFrame: 0, event: { type: 'screen_shake', intensity: 0.003, duration: 4 } },
          ],
        },
        { name: 'recovery', frames: 18, events: [] },
      ],
    },
    {
      id: 'dash_punch',
      displayName: 'Rubber Rebound',
      animation: 'punch',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'landing'],
        sequence: ['forward', 'forward', 'lp'],
        window: 16,
      },
      phases: [
        { name: 'startup', frames: 7, events: [{ onFrame: 0, event: { type: 'set_velocity', vx: 6.8, relativeToFacing: true } }] },
        {
          name: 'active',
          frames: 5,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'rubber_rebound',
                hitbox: midPunch({ x: 30, y: -108, width: 118, height: 36, damage: 70, hitstun: 23, blockstun: 13, knockback: { x: 7.2, y: 0 } }),
              },
            },
          ],
        },
        {
          name: 'recovery',
          frames: 16,
          events: [
            { onFrame: 0, event: { type: 'hitbox_end', id: 'rubber_rebound' } },
            { onFrame: 0, event: { type: 'set_velocity', vx: 0, relativeToFacing: true } },
          ],
        },
      ],
    },
    {
      id: 'crouch_low_kick',
      displayName: 'Rubber Foot Sweep',
      animation: 'kick',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['down', 'lk'],
        window: 8,
      },
      phases: [
        { name: 'startup', frames: 4, events: [{ onFrame: 0, event: { type: 'modify_hurtbox', hurtbox: { x: -26, y: -82, width: 52, height: 82 } } }] },
        {
          name: 'active',
          frames: 4,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'rubber_sweep',
                hitbox: {
                  x: 18,
                  y: -40,
                  width: 122,
                  height: 24,
                  damage: 42,
                  hitstun: 13,
                  blockstun: 10,
                  knockback: { x: 3.5, y: 0 },
                  level: 'low',
                },
              },
            },
          ],
        },
        { name: 'recovery', frames: 10, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'rubber_sweep' } }] },
      ],
    },
    {
      id: 'heavy_punch',
      displayName: 'Peck Hammer',
      animation: 'punch',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing'],
        sequence: ['hp'],
        window: 6,
      },
      phases: [
        { name: 'startup', frames: 8, events: [] },
        {
          name: 'active',
          frames: 4,
          events: [
            {
              onFrame: 0,
              event: {
                type: 'hitbox_active',
                id: 'peck_hammer',
                hitbox: midPunch({
                  x: 28,
                  y: -116,
                  width: 108,
                  height: 44,
                  damage: 84,
                  hitstun: 30,
                  blockstun: 15,
                  chipDamage: 5,
                  knockback: { x: 5.5, y: -5.4 },
                  launches: true,
                }),
              },
            },
          ],
        },
        { name: 'recovery', frames: 18, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'peck_hammer' } }] },
      ],
    },
    {
      id: 'light_punch',
      displayName: 'Floppy Wing Slap',
      animation: 'punch',
      trigger: {
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch', 'landing', 'attack'],
        sequence: ['lp'],
        window: 6,
        cancelFrom: ['light_punch'],
      },
      phases: [
        { name: 'startup', frames: 3, events: [] },
        { name: 'active', frames: 3, cancellable: true, events: [{ onFrame: 0, event: { type: 'hitbox_active', id: 'wing_slap', hitbox: midPunch({ x: 26, y: -102, width: 86, height: 32, damage: 45 }) } }] },
        { name: 'recovery', frames: 8, cancellable: true, events: [{ onFrame: 0, event: { type: 'hitbox_end', id: 'wing_slap' } }] },
      ],
      cancelInto: ['light_punch', 'heavy_punch'],
    },
  ]);
}

function makeCharacter(tuning: FighterTuning): CharacterConfig {
  return {
    id: tuning.id,
    displayName: tuning.displayName,
    walkForwardSpeed: 3,
    walkBackSpeed: 2,
    jumpVelocity: 11,
    jumpForwardVelocity: 4,
    jumpBackVelocity: 3.2,
    gravity: 0.55,
    maxFallSpeed: 12,
    maxHealth: 1000,
    pivotOffsetY: 0,
    sprite: {
      basePath: tuning.assetPath,
      frameWidth: 256,
      frameHeight: 256,
      scale: 1,
      anchorY: 238 / 256,
      frameCounts: {
        base: 6,
        punch: 4,
        kick: 4,
        special_1: 4,
        special_2: 4,
      },
      sheets: {
        base: 'sheets/base.png',
        punch: 'sheets/punch.png',
        kick: 'sheets/kick.png',
        special_1: 'sheets/special_1.png',
        special_2: 'sheets/special_2.png',
      },
    },
    hurtboxes: baseHurtboxes,
    animations: fighterAnimations,
    moves: makeMoves(tuning),
  };
}

const guitarShredderBaseConfig = makeCharacter({
  id: 'guitar_shredder',
  displayName: 'Guitar Shredder',
  assetPath: '/fighters/guitar_shredder',
  projectileId: 'power_chord_wave',
  projectileAnimation: 'sound_wave',
  moveNames: {
    light: 'Encore Jab',
    heavy: 'Feedback Cross',
    low: 'Bootleg Sweep',
    projectile: 'Power Chord',
    dash: 'Stage Dive',
    uppercut: 'Rising Solo',
  },
});

export const guitarShredderConfig: CharacterConfig = {
  ...guitarShredderBaseConfig,
  moves: addSixFrameVisualTimelines(guitarShredderBaseConfig.moves),
  sprite: {
    ...guitarShredderBaseConfig.sprite!,
    frameCounts: {
      base: 6,
      punch: 6,
      kick: 6,
      special_1: 6,
      special_2: 6,
    },
    frames: guitarShredderFrames,
  },
};

export const micMonarchConfig = makeCharacter({
  id: 'mic_monarch',
  displayName: 'Mic Monarch',
  assetPath: '/fighters/mic_monarch',
  projectileId: 'feedback_check_wave',
  projectileAnimation: 'feedback_wave',
  moveNames: {
    light: 'Cue Punch',
    heavy: 'Curtain Call',
    low: 'Kilt Sweep',
    projectile: 'Feedback Check',
    dash: 'Crowd Work',
    uppercut: 'Spotlight Command',
  },
});

export const mrCardboardConfig: CharacterConfig = {
  id: 'mr_cardboard',
  displayName: 'Mr Cardboard',
  walkForwardSpeed: 2.8,
  walkBackSpeed: 1.9,
  jumpVelocity: 10.6,
  jumpForwardVelocity: 3.8,
  jumpBackVelocity: 3,
  gravity: 0.55,
  maxFallSpeed: 12,
  maxHealth: 1020,
  pivotOffsetY: 0,
  sprite: {
    basePath: '/fighters/mr_cardboard',
    frameWidth: 256,
    frameHeight: 256,
    scale: 0.5,
    anchorY: 238 / 256,
    frameCounts: {
      base: 6,
      punch: 6,
      kick: 6,
      special_1: 6,
      special_2: 6,
    },
    sheets: {
      base: 'sheets/base.png',
      punch: 'sheets/punch.png',
      kick: 'sheets/kick.png',
      special_1: 'sheets/special_1.png',
      special_2: 'sheets/special_2.png',
    },
    frames: mrCardboardFrames,
  },
  hurtboxes: {
    ...baseHurtboxes,
    idle: { x: -30, y: -122, width: 60, height: 122 },
    walk_forward: { x: -30, y: -122, width: 60, height: 122 },
    walk_back: { x: -30, y: -122, width: 60, height: 122 },
    attack: { x: -32, y: -124, width: 64, height: 124 },
    crouch: { x: -34, y: -82, width: 68, height: 82 },
  },
  animations: fighterAnimations,
  moves: makeMrCardboardMoves(),
};

export const viggoConfig: CharacterConfig = {
  id: 'viggo',
  displayName: 'Viggo',
  walkForwardSpeed: 3.1,
  walkBackSpeed: 2.1,
  jumpVelocity: 11.2,
  jumpForwardVelocity: 4.2,
  jumpBackVelocity: 3.4,
  gravity: 0.55,
  maxFallSpeed: 12,
  maxHealth: 980,
  pivotOffsetY: 0,
  sprite: {
    basePath: '/fighters/viggo',
    frameWidth: 256,
    frameHeight: 256,
    scale: 0.55,
    anchorY: 248 / 286,
    stateFrames: generatedBaseStateFrames,
    frameCounts: {
      base: 6,
      punch: 6,
      kick: 6,
      special_1: 6,
      special_2: 6,
    },
    sheets: {
      base: 'sheets/base.png',
      punch: 'sheets/punch.png',
      kick: 'sheets/kick.png',
      special_1: 'sheets/special_1.png',
      special_2: 'sheets/special_2.png',
    },
    frames: viggoFrames,
  },
  hurtboxes: {
    ...baseHurtboxes,
    idle: { x: -24, y: -122, width: 48, height: 122 },
    walk_forward: { x: -24, y: -122, width: 48, height: 122 },
    walk_back: { x: -24, y: -122, width: 48, height: 122 },
    attack: { x: -26, y: -122, width: 52, height: 122 },
    crouch: { x: -28, y: -82, width: 56, height: 82 },
  },
  animations: fighterAnimations,
  moves: makeViggoMoves(),
};

export const janitorConfig: CharacterConfig = {
  id: 'janitor',
  displayName: 'The Janitor',
  walkForwardSpeed: 2.7,
  walkBackSpeed: 1.8,
  jumpVelocity: 10.4,
  jumpForwardVelocity: 3.6,
  jumpBackVelocity: 2.8,
  gravity: 0.58,
  maxFallSpeed: 12,
  maxHealth: 1060,
  pivotOffsetY: 0,
  sprite: {
    basePath: '/fighters/janitor',
    frameWidth: 256,
    frameHeight: 256,
    scale: 0.55,
    anchorY: 248 / 286,
    stateFrames: generatedBaseStateFrames,
    frameCounts: {
      base: 6,
      punch: 6,
      kick: 6,
      special_1: 6,
      special_2: 6,
    },
    sheets: {
      base: 'sheets/base.png',
      punch: 'sheets/punch.png',
      kick: 'sheets/kick.png',
      special_1: 'sheets/special_1.png',
      special_2: 'sheets/special_2.png',
    },
    frames: janitorFrames,
  },
  hurtboxes: {
    ...baseHurtboxes,
    idle: { x: -31, y: -122, width: 62, height: 122 },
    walk_forward: { x: -31, y: -122, width: 62, height: 122 },
    walk_back: { x: -31, y: -122, width: 62, height: 122 },
    attack: { x: -33, y: -124, width: 66, height: 124 },
    crouch: { x: -35, y: -82, width: 70, height: 82 },
  },
  animations: fighterAnimations,
  moves: makeJanitorMoves(),
};

export const jackTuckerConfig: CharacterConfig = {
  id: 'jack_tucker',
  displayName: 'Jack Tucker',
  walkForwardSpeed: 3,
  walkBackSpeed: 2,
  jumpVelocity: 11,
  jumpForwardVelocity: 4,
  jumpBackVelocity: 3.2,
  gravity: 0.55,
  maxFallSpeed: 12,
  maxHealth: 1000,
  pivotOffsetY: 0,
  sprite: {
    basePath: '/fighters/jack_tucker',
    frameWidth: 256,
    frameHeight: 256,
    scale: 0.55,
    anchorY: 248 / 286,
    stateFrames: generatedBaseStateFrames,
    frameCounts: {
      base: 6,
      punch: 6,
      kick: 6,
      special_1: 6,
      special_2: 6,
    },
    sheets: {
      base: 'sheets/base.png',
      punch: 'sheets/punch.png',
      kick: 'sheets/kick.png',
      special_1: 'sheets/special_1.png',
      special_2: 'sheets/special_2.png',
    },
    frames: jackTuckerFrames,
  },
  hurtboxes: {
    ...baseHurtboxes,
    idle: { x: -27, y: -122, width: 54, height: 122 },
    walk_forward: { x: -27, y: -122, width: 54, height: 122 },
    walk_back: { x: -27, y: -122, width: 54, height: 122 },
    attack: { x: -29, y: -123, width: 58, height: 123 },
    crouch: { x: -30, y: -82, width: 60, height: 82 },
  },
  animations: fighterAnimations,
  moves: makeJackTuckerMoves(),
};

export const martinUrbanoConfig: CharacterConfig = {
  id: 'martin_urbano',
  displayName: 'Martin Urbano',
  walkForwardSpeed: 2.95,
  walkBackSpeed: 2.05,
  jumpVelocity: 10.8,
  jumpForwardVelocity: 3.9,
  jumpBackVelocity: 3.1,
  gravity: 0.55,
  maxFallSpeed: 12,
  maxHealth: 990,
  pivotOffsetY: 0,
  sprite: {
    basePath: '/fighters/martin_urbano',
    frameWidth: 256,
    frameHeight: 256,
    scale: 0.55,
    anchorY: 248 / 286,
    stateFrames: generatedBaseStateFrames,
    frameCounts: {
      base: 6,
      punch: 6,
      kick: 6,
      special_1: 6,
      special_2: 6,
    },
    sheets: {
      base: 'sheets/base.png',
      punch: 'sheets/punch.png',
      kick: 'sheets/kick.png',
      special_1: 'sheets/special_1.png',
      special_2: 'sheets/special_2.png',
    },
    frames: martinUrbanoFrames,
  },
  hurtboxes: {
    ...baseHurtboxes,
    idle: { x: -26, y: -123, width: 52, height: 123 },
    walk_forward: { x: -26, y: -123, width: 52, height: 123 },
    walk_back: { x: -26, y: -123, width: 52, height: 123 },
    attack: { x: -28, y: -124, width: 56, height: 124 },
    crouch: { x: -30, y: -82, width: 60, height: 82 },
  },
  animations: fighterAnimations,
  moves: makeMartinUrbanoMoves(),
};

export const dylanSaxConfig: CharacterConfig = {
  id: 'dylan_sax',
  displayName: 'Dylan',
  walkForwardSpeed: 3.1,
  walkBackSpeed: 2.1,
  jumpVelocity: 11.2,
  jumpForwardVelocity: 4.2,
  jumpBackVelocity: 3.3,
  gravity: 0.55,
  maxFallSpeed: 12,
  maxHealth: 980,
  pivotOffsetY: 0,
  sprite: {
    basePath: '/fighters/dylan_sax',
    frameWidth: 256,
    frameHeight: 256,
    scale: 0.55,
    anchorY: 248 / 286,
    stateFrames: generatedBaseStateFrames,
    frameCounts: {
      base: 6,
      punch: 6,
      kick: 6,
      special_1: 6,
      special_2: 6,
    },
    sheets: {
      base: 'sheets/base.png',
      punch: 'sheets/punch.png',
      kick: 'sheets/kick.png',
      special_1: 'sheets/special_1.png',
      special_2: 'sheets/special_2.png',
    },
    frames: dylanSaxFrames,
  },
  hurtboxes: {
    ...baseHurtboxes,
    idle: { x: -26, y: -124, width: 52, height: 124 },
    walk_forward: { x: -26, y: -124, width: 52, height: 124 },
    walk_back: { x: -26, y: -124, width: 52, height: 124 },
    attack: { x: -28, y: -126, width: 56, height: 126 },
    crouch: { x: -30, y: -82, width: 60, height: 82 },
  },
  animations: fighterAnimations,
  moves: makeDylanSaxMoves(),
};

export const coreyConfig: CharacterConfig = {
  id: 'corey',
  displayName: 'Corey',
  walkForwardSpeed: 2.6,
  walkBackSpeed: 1.75,
  jumpVelocity: 10.2,
  jumpForwardVelocity: 3.5,
  jumpBackVelocity: 2.7,
  gravity: 0.58,
  maxFallSpeed: 12,
  maxHealth: 1070,
  pivotOffsetY: 0,
  sprite: {
    basePath: '/fighters/corey',
    frameWidth: 256,
    frameHeight: 256,
    scale: 0.55,
    anchorY: 248 / 286,
    stateFrames: generatedBaseStateFrames,
    frameCounts: {
      base: 6,
      punch: 6,
      kick: 6,
      special_1: 6,
      special_2: 6,
    },
    sheets: {
      base: 'sheets/base.png',
      punch: 'sheets/punch.png',
      kick: 'sheets/kick.png',
      special_1: 'sheets/special_1.png',
      special_2: 'sheets/special_2.png',
    },
    frames: coreyFrames,
  },
  hurtboxes: {
    ...baseHurtboxes,
    idle: { x: -34, y: -124, width: 68, height: 124 },
    walk_forward: { x: -34, y: -124, width: 68, height: 124 },
    walk_back: { x: -34, y: -124, width: 68, height: 124 },
    attack: { x: -36, y: -126, width: 72, height: 126 },
    crouch: { x: -38, y: -84, width: 76, height: 84 },
  },
  animations: fighterAnimations,
  moves: makeCoreyMoves(),
};

export const jugglingJoeConfig: CharacterConfig = {
  id: 'juggling_joe',
  displayName: 'Juggling Joe Fisher',
  walkForwardSpeed: 3.05,
  walkBackSpeed: 2.05,
  jumpVelocity: 11,
  jumpForwardVelocity: 4,
  jumpBackVelocity: 3.2,
  gravity: 0.55,
  maxFallSpeed: 12,
  maxHealth: 990,
  pivotOffsetY: 0,
  sprite: {
    basePath: '/fighters/juggling_joe',
    frameWidth: 256,
    frameHeight: 256,
    scale: 0.55,
    anchorY: 248 / 286,
    stateFrames: generatedBaseStateFrames,
    frameCounts: {
      base: 6,
      punch: 6,
      kick: 6,
      special_1: 6,
      special_2: 6,
    },
    sheets: {
      base: 'sheets/base.png',
      punch: 'sheets/punch.png',
      kick: 'sheets/kick.png',
      special_1: 'sheets/special_1.png',
      special_2: 'sheets/special_2.png',
    },
    frames: jugglingJoeFrames,
  },
  hurtboxes: {
    ...baseHurtboxes,
    idle: { x: -26, y: -123, width: 52, height: 123 },
    walk_forward: { x: -26, y: -123, width: 52, height: 123 },
    walk_back: { x: -26, y: -123, width: 52, height: 123 },
    attack: { x: -28, y: -124, width: 56, height: 124 },
    crouch: { x: -30, y: -82, width: 60, height: 82 },
  },
  animations: fighterAnimations,
  moves: makeJugglingJoeMoves(),
};

export const rubberChickenConfig: CharacterConfig = {
  id: 'rubber_chicken',
  displayName: 'Rubber Chicken',
  walkForwardSpeed: 3.2,
  walkBackSpeed: 2.15,
  jumpVelocity: 11.4,
  jumpForwardVelocity: 4.2,
  jumpBackVelocity: 3.4,
  gravity: 0.52,
  maxFallSpeed: 12,
  maxHealth: 960,
  pivotOffsetY: 0,
  sprite: {
    basePath: '/fighters/rubber_chicken',
    frameWidth: 256,
    frameHeight: 256,
    scale: 0.6,
    anchorY: 248 / 286,
    stateFrames: generatedBaseStateFrames,
    frameCounts: {
      base: 6,
      punch: 6,
      kick: 6,
      special_1: 6,
      special_2: 6,
    },
    sheets: {
      base: 'sheets/base.png',
      punch: 'sheets/punch.png',
      kick: 'sheets/kick.png',
      special_1: 'sheets/special_1.png',
      special_2: 'sheets/special_2.png',
    },
    frames: rubberChickenFrames,
  },
  hurtboxes: {
    ...baseHurtboxes,
    idle: { x: -22, y: -132, width: 44, height: 132 },
    walk_forward: { x: -22, y: -132, width: 44, height: 132 },
    walk_back: { x: -22, y: -132, width: 44, height: 132 },
    attack: { x: -24, y: -134, width: 48, height: 134 },
    crouch: { x: -28, y: -78, width: 56, height: 78 },
  },
  animations: fighterAnimations,
  moves: makeRubberChickenMoves(),
};

export const playableCharacters = [
  mrCardboardConfig,
  guitarShredderConfig,
  micMonarchConfig,
  viggoConfig,
  janitorConfig,
  jackTuckerConfig,
  martinUrbanoConfig,
  dylanSaxConfig,
  coreyConfig,
  jugglingJoeConfig,
  rubberChickenConfig,
] as const;
