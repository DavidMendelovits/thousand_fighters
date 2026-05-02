import type { ProjectilePool } from '../core/ProjectilePool';

export type InputToken =
  | 'up'
  | 'down'
  | 'forward'
  | 'back'
  | 'down-forward'
  | 'down-back'
  | 'up-forward'
  | 'up-back'
  | 'lp'
  | 'mp'
  | 'hp'
  | 'lk'
  | 'mk'
  | 'hk'
  | 'neutral';

export type RawInput = {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  lp: boolean;
  mp: boolean;
  hp: boolean;
  lk: boolean;
  mk: boolean;
  hk: boolean;
  lpPrev: boolean;
  mpPrev: boolean;
  hpPrev: boolean;
  lkPrev: boolean;
  mkPrev: boolean;
  hkPrev: boolean;
};

export type MoveTrigger = {
  allowedStates: FighterState[];
  sequence: InputToken[];
  window?: number;
  cancelFrom?: string[];
};

export type HitLevel = 'high' | 'mid' | 'low';

export type Hitbox = {
  x: number;
  y: number;
  width: number;
  height: number;
  damage: number;
  hitstun: number;
  blockstun: number;
  chipDamage?: number;
  knockback: { x: number; y: number };
  level?: HitLevel;
  launches?: boolean;
  knockdown?: boolean;
  unblockable?: boolean;
  hitSpark?: string;
  hitSound?: string;
};

export type Hurtbox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MoveEvent =
  | { type: 'hitbox_active'; hitbox: Hitbox; id?: string }
  | { type: 'hitbox_end'; id?: string }
  | { type: 'spawn_projectile'; projectile: ProjectileConfig; offsetX: number; offsetY: number }
  | { type: 'spawn_projectile_at_target'; projectile: ProjectileConfig; offsetX: number; offsetY: number }
  | { type: 'spawn_projectile_from_sky'; projectile: ProjectileConfig; targetOffsetX: number; spawnOffsetY: number }
  | { type: 'set_velocity'; vx?: number; vy?: number; relativeToFacing?: boolean }
  | { type: 'teleport'; offsetX: number; offsetY: number }
  | { type: 'invulnerable'; duration: number; against?: (HitLevel | 'projectile')[] }
  | { type: 'armor'; hits: number; duration: number }
  | { type: 'play_animation'; name: string }
  | { type: 'play_sound'; name: string }
  | { type: 'spawn_vfx'; name: string; offsetX: number; offsetY: number }
  | { type: 'modify_hurtbox'; hurtbox: Hurtbox | null }
  | { type: 'screen_shake'; intensity: number; duration: number };

export type MovePhase = {
  name: string;
  frames: number;
  cancellable?: boolean;
  events: Array<{
    onFrame: number;
    event: MoveEvent;
  }>;
};

export type MoveVisualFrame = {
  // Sprite frame index within the move's animation sheet.
  frame: number;
  // Integer gameplay frames to hold this sprite frame.
  duration: number;
};

export type Move = {
  id: string;
  displayName: string;
  animation: string;
  // Optional hand-authored visual timing. Combat phases still drive hitboxes,
  // projectiles, cancels, and state; this only controls which sprite frame is
  // shown on each deterministic gameplay frame.
  visualTimeline?: MoveVisualFrame[];
  trigger: MoveTrigger;
  phases: MovePhase[];
  endState?: FighterState;
  cancelInto?: string[];
  airOk?: boolean;
  groundOk?: boolean;
  cost?: { meter?: number };
};

export type ProjectileConfig = {
  id: string;
  animation: string;
  width: number;
  height: number;
  speed: number;
  velocity?: { x?: number; y?: number; relativeToFacing?: boolean };
  gravity?: number;
  lifetime: number;
  hitbox: Hitbox;
  pierces?: number;
  clashesWithProjectiles?: boolean;
  spawnPolicy?: {
    maxActivePerOwner?: number;
    ifAlreadyActive?: 'block_spawn' | 'replace_oldest' | 'allow';
  };
};

export type SpriteSheetId = 'base' | 'punch' | 'kick' | 'special_1' | 'special_2';

export type SpriteFrameMeta = {
  file: string;
  width: number;
  height: number;
  anchor: { x: number; y: number };
};

export type CharacterSpriteConfig = {
  basePath: string;
  frameWidth?: number;
  frameHeight?: number;
  scale: number;
  anchorY?: number;
  stateFrames?: Partial<Record<FighterState, number | number[]>>;
  frameCounts: Partial<Record<SpriteSheetId, number>>;
  sheets: Partial<Record<SpriteSheetId, string>>;
  frames?: Partial<Record<SpriteSheetId, SpriteFrameMeta[]>>;
};

export type FighterState =
  | 'idle'
  | 'walk_forward'
  | 'walk_back'
  | 'crouch'
  | 'crouch_transition'
  | 'jump_startup'
  | 'airborne'
  | 'landing'
  | 'attack'
  | 'hitstun'
  | 'blockstun'
  | 'knockdown'
  | 'getup'
  | 'juggle'
  | 'dead';

export type CharacterConfig = {
  id: string;
  displayName: string;
  walkForwardSpeed: number;
  walkBackSpeed: number;
  jumpVelocity: number;
  jumpForwardVelocity: number;
  jumpBackVelocity: number;
  gravity: number;
  maxFallSpeed: number;
  maxHealth: number;
  hurtboxes: Partial<Record<FighterState, Hurtbox>>;
  pivotOffsetY: number;
  sprite?: CharacterSpriteConfig;
  animations: Partial<Record<FighterState, string>>;
  moves: Move[];
};

export type FighterScene = Phaser.Scene & {
  projectiles: ProjectilePool;
  hitPauseFrames: number;
};
