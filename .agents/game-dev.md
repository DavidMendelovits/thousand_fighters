# Thousand Fighters — Game Engine Skill

## Phaser 3 Scene Lifecycle

`FightScene` is the main scene (~36K lines). Key lifecycle:
- `preload()` — loads sprite frames as individual textures (`{characterId}:{sheetId}:{frameIndex}`), arena backgrounds, sounds from `assets-index.json`
- `create()` — sets up fighters, input, debug overlay, arena background, pause modal
- `fixedUpdate()` — deterministic 60fps game loop: input → state machine → move execution → hitbox checks → rendering

## Fighter Class (`src/core/Fighter.ts`)

Central game object. Key methods:
- `getHurtboxesWorld()` — returns world-space hurtboxes for collision (per-state, per-actor overrides)
- `getActiveHitboxesWorld()` — returns currently active attack hitboxes
- State machine: `idle`, `walk_forward`, `walk_back`, `crouch`, `airborne`, `attack`, `hitstun`, `blockstun`, `knockdown`, `dead`

## Move Definition (`src/schema/types.ts`)

```typescript
type Move = {
  id: string;
  displayName: string;
  animation: string;          // sheet id (base, punch, kick, special_1, special_2)
  visualTimeline?: MoveVisualFrame[];  // sprite frame timing
  trigger: MoveTrigger;       // input sequence + allowed states
  phases: MovePhase[];        // frame-by-frame behavior
  endState?: FighterState;
  cancelInto?: string[];      // moves this can cancel into
};

type MovePhase = {
  name: string;
  frames: number;             // duration in game frames (60fps)
  cancellable?: boolean;
  events: Array<{ onFrame: number; event: MoveEvent }>;
};
```

## MoveEvent Types

All events are dispatched by `MoveExecutor.handleEvent()`. When adding a new event type:
1. Add the type to the `MoveEvent` union in `src/schema/types.ts`
2. Add the case to the switch in `MoveExecutor.handleEvent()`
3. The `default` case uses exhaustive type checking — TypeScript will error if you miss it

Current event types: `hitbox_active`, `hitbox_end`, `spawn_projectile`, `spawn_projectile_at_target`, `spawn_projectile_from_sky`, `set_velocity`, `teleport`, `invulnerable`, `armor`, `play_animation`, `play_sound`, `spawn_vfx`, `modify_hurtbox`, `screen_shake`, `set_actor_offset`, `reset_actor_offset`, `set_follow_delay`, `swap_lead`, `enter_fusion`, `exit_fusion`

## Hitbox System (`src/core/HitboxSystem.ts`)

- `checkAll()` — called each `fixedUpdate()`, checks fighter-vs-fighter and projectile-vs-fighter
- Uses AABB overlap (`boxesOverlap()`)
- `HitResolver.resolve()` applies damage, hitstun, knockback, hit sounds

## Debug System

- `DebugOverlay.ts` — renders hurtboxes/hitboxes/projectile boxes per-actor with color coding
- `DebugPanel.ts` — HTML overlay with per-actor per-category checkboxes
- F1 = master toggle, F3 = panel visibility

## Character Config (`src/characters/stamptownFighters.ts`)

All fighter definitions live here. Each `CharacterConfig` has: movement speeds, gravity, health, hurtboxes per state, sprite config, actor configs (for multi-actor fighters like Sklar Brothers), animations map, and moves array.

Multi-actor fighters (e.g., `sklar_brothers`) have an `actors` array with separate sprite configs, hurtboxes, and position offsets per actor (lead, echo, fusion).
