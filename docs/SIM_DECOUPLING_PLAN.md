# Plan: Decouple the Simulation from Phaser

> Status: **proposal / not yet started.** This document is the plan only — no
> runtime code changes ship with it. It describes the exact seams to cut so the
> fighting-game *simulation* can run without Phaser, which is the prerequisite
> for the three things we actually want: **crisp/deterministic feel, rollback
> netcode for online play, and portability** (desktop via Tauri/Steam, mobile
> via Capacitor) without a Unity/Unreal rewrite.

## Why this first

Everything downstream depends on one property the codebase does not yet have: a
**pure, deterministic, serializable game state** with no rendering dependency.

- **Rollback netcode** needs to `snapshot()` the whole match, replay N frames
  from stored inputs, and `restore()` — impossible while game state lives inside
  a Phaser scene graph.
- **"Crisp and responsive"** needs a fixed-timestep sim decoupled from render
  frames; today `Fighter` advances state and pushes pixels in the same pass.
- **Native / console / desktop ports** are a *reskin* (redraw from sim state)
  once the sim is Phaser-free, versus a full rewrite today.
- **Headless testing & AI training** (bot practice, balance sims, determinism
  regression tests) become possible only when the sim runs without a canvas.

The renderer brand is not the lever. This decoupling is.

## Target architecture

One-way data flow, every frame: **input → sim step → render reads sim.**

```
src/
  sim/                    ← PURE. No `import Phaser`. Deterministic. Serializable.
    world.ts              GameState: fighters + projectiles + frame + rng seed
    fighterSim.ts         state machine + physics + combat (from Fighter.ts)
    moveExecutor.ts       phase/event timeline (from MoveExecutor.ts)
    projectileSim.ts      plain-data projectile instances (from ProjectilePool.ts)
    hitResolver.ts        collision → state mutation (from HitResolver.ts)
    presentationBus.ts    per-frame queue of "intents" the sim EMITS, never executes
    mathf.ts              deterministic math (fixed-point in a later phase)
  render/                 ← Phaser. Reads sim, draws. Owns all GameObjects.
    fighterView.ts        sprites/actors/anchors/tint (from Fighter.syncVisuals)
    projectileView.ts     projectile images (from ProjectilePool bodies)
    vfxController.ts       drains presentationBus: screen shake, VFX, sound, hitpause
    fightScene.ts         wires input → sim.step() → views.sync()
  schema/                 ← shared data types (already engine-agnostic; keep)
  characters/             ← fighter data (already engine-agnostic; keep)
```

**Invariant:** nothing under `sim/` may import Phaser or touch a GameObject. A
lint rule (`no-restricted-imports` for `phaser` inside `src/sim/**`) enforces it.

## The core idea: sim emits intents, render executes them

Today `MoveExecutor.handleEvent` mixes two kinds of `MoveEvent`:

1. **State events** — change the match: `hitbox_active`, `hitbox_end`,
   `set_velocity`, `teleport`, `invulnerable`, `armor`, `modify_hurtbox`,
   `spawn_projectile*`, `set_actor_offset`, `swap_lead`, `enter_fusion`, etc.
   These stay in the sim.
2. **Presentation events** — cosmetic: `screen_shake`, `spawn_vfx`,
   `play_sound`, `play_animation`. Today these reach straight into Phaser
   (`scene.cameras.main.shake`, `scene.add.image`, `scene.tweens.add`).

The fix: presentation events get **pushed onto a `PresentationBus` queue** by the
sim instead of executed. Each rendered frame, `vfxController` drains the queue
and does the Phaser work. The sim stays pure; rollback can safely discard
un-rendered intents on a re-sim; a headless run just ignores the bus.

```ts
// sim/presentationBus.ts
export type PresentationIntent =
  | { kind: 'screen_shake'; intensity: number; duration: number }
  | { kind: 'vfx'; name: string; x: number; y: number }
  | { kind: 'sound'; name: string }
  | { kind: 'hitpause'; frames: number };

export class PresentationBus {
  private queue: PresentationIntent[] = [];
  emit(i: PresentationIntent) { this.queue.push(i); }
  drain(): PresentationIntent[] { const q = this.queue; this.queue = []; return q; }
}
```

## Serializable game state (the payload rollback needs)

`GameState` must be plain data — deep-cloneable and comparable — with **no
Phaser references, no `Set`/`Map` of objects, no functions**. `hasHitThisMove`
(currently a `Set<string>`) and the actor override `Map`s become plain
structures. Positions become integers/fixed-point (see determinism).

```ts
// sim/world.ts  (shape sketch — plain data only)
export interface GameState {
  frame: number;
  rngSeed: number;              // if/when any randomness is introduced
  fighters: [FighterState, FighterState];
  projectiles: ProjectileState[];
  hitpauseFrames: number;
}
export function snapshot(s: GameState): GameState { /* structuredClone */ }
export function restore(target: GameState, snap: GameState): void { /* copy back */ }
export function step(s: GameState, inputs: [RawInput, RawInput], bus: PresentationBus): void;
```

The **only** network payload for online play then becomes
`{ frame, p1Input, p2Input }` — inputs, never state.

## Determinism requirements (gate for cross-device rollback)

- **No `Math.random()` / `Date.now()` in `sim/`.** (Current sim appears free of
  both — keep it that way; add a lint guard.)
- **Fixed timestep.** Sim advances in whole frames (already frame-based); render
  interpolates. Decouple `sim.step()` cadence from `requestAnimationFrame`.
- **Deterministic math.** Floats are deterministic *within one machine* (fine for
  P2P where both peers run the same JS build; enough for a first rollback cut).
  **Cross-platform** determinism (JS peer vs a future native peer) requires
  fixed-point — deferred to Phase 5, isolated behind `sim/mathf.ts` so the
  migration is a find-replace of arithmetic, not a rewrite.
- **Replace `Phaser.Math.Clamp`** (used in `Fighter.keepInStage` and
  `moveVisualFrame`) with a local `clamp` in `mathf.ts`.

## Current coupling inventory (the seams to cut)

Grounded in the code as it stands:

| File | Coupling to remove | Moves to |
|---|---|---|
| `core/Fighter.ts` | ctor takes `scene`; `scene.add.text` (label); `createActors` builds `scene.add.sprite/rectangle`; holds `body`/`label`/`actors` GameObjects; `syncVisuals`, `syncActorVisual`, `currentVisualFrame`, `frameMeta`, `frameKey`, `resolveBaseFrame`, `moveVisualFrame`; `Phaser.Math.Clamp` | State/physics/combat → `sim/fighterSim.ts`; all `sync*`/frame/anchor logic → `render/fighterView.ts` |
| `core/MoveExecutor.ts` | `scene.projectiles.spawn`; `scene.cameras.main.shake` (`screen_shake`); `scene.textures.exists` + `scene.add.image` + `scene.tweens.add` (`spawn_vfx`); reads `scene.fighters` for target-seeking spawns | Projectile spawn → `sim/projectileSim`; `screen_shake`/`spawn_vfx`/`play_sound` → `bus.emit(...)`; target lookup → read opponent from `GameState` |
| `core/ProjectilePool.ts` | `scene.add.image/rectangle`, `scene.textures.exists`, `body.destroy`, `body.setPosition` | Instances become plain `ProjectileState[]` in `sim/projectileSim.ts`; `render/projectileView.ts` owns the images |
| `core/HitResolver.ts` | `HitPause.trigger(attacker.scene, 4)` | Emit `{ kind:'hitpause', frames:4 }` on the bus; sim tracks `hitpauseFrames` in `GameState` |
| `schema/types.ts` | `FighterScene = Phaser.Scene & {...}` | Sim uses a plain `SimContext`; `FighterScene` stays only in `render/` |
| `scenes/FightScene.ts` | owns loop, holds `fighters`, `projectiles`, hitpause | Becomes the render/orchestration host: build `GameState`, call `sim.step()`, then `view.sync(state)` + `vfx.drain(bus)` |

Note: `HitResolver` and the physics/state methods of `Fighter` are already
*nearly* pure — most of the sim logic just needs to stop reaching through
`fighter.scene`. `Fighter`'s multi-actor rig (`lead`/`echo`/`fusion`, offsets,
follow-delay, per-actor hurtboxes) splits cleanly: the **offsets/hurtboxes are
sim state**, the **sprites/anchors are render** — which is also exactly what the
extendable-arm/limb feature will build on.

## Phased migration (each phase compiles, runs, and is independently mergeable)

**Phase 0 — this doc.** No code change.

**Phase 1 — PresentationBus (low risk, high isolation).** Introduce
`sim/presentationBus.ts`. Reroute `screen_shake`, `spawn_vfx`, `play_sound`, and
`HitPause` through it; add `vfxController` in render to drain it. Removes
`cameras`/`tweens`/`textures` coupling from `MoveExecutor`/`HitResolver`. No
behavior change on screen.

**Phase 2 — split `Fighter` into `FighterSim` + `FighterView`.** Sim holds no
GameObjects. View constructs sprites and reads sim each frame. This is the
largest phase; do it one fighter-subsystem at a time (physics → state machine →
actors) behind the existing public methods.

**Phase 3 — split `ProjectilePool` into `ProjectileSim` + `ProjectileView`.**
Plain-data instances in sim; images in render.

**Phase 4 — serializable `GameState` + `snapshot`/`restore`.** Convert the last
`Set`/`Map` object-state to plain data. Add a **determinism test**: run K frames
from a fixed input script twice and assert identical final `GameState` hashes.

**Phase 5 — fixed-point math** behind `sim/mathf.ts`. Only needed for
cross-platform (JS↔native) rollback; skip until a native peer exists.

**Phase 6 — rollback session** (separate epic): input-delay + rollback buffer
(GGPO/GGRS-style) over WebRTC data channels (web) or Steamworks P2P (desktop),
plus a thin matchmaking queue. Depends on Phases 1–4.

## Acceptance criteria

- `src/sim/**` has zero `phaser` imports (lint-enforced).
- The game plays identically to today (local versus, all current fighters/moves,
  VFX, screen shake, hitpause, projectiles, fusion/actor moves).
- `sim.step()` runs headless in a Node test with no canvas.
- Determinism test passes: same inputs → same `GameState` hash, twice.
- `npm run build` clean (note: the repo currently has pre-existing Phaser-type
  resolution errors unrelated to this work; those are tracked separately).

## Risks & mitigations

- **Behavioral drift during the split.** Mitigate with a golden-replay test
  captured *before* Phase 2 (record inputs + per-frame state from the current
  build, assert the refactored sim reproduces it).
- **Actor/fusion rig is subtle.** It's the trickiest extraction; keep its public
  method surface identical and move logic beneath it in small commits.
- **Scope creep into rollback.** Phases 5–6 are explicitly out of scope here;
  this plan stops at "sim is pure, deterministic, serializable."

## What this unlocks (payoff map)

| Goal you asked for | Enabled by |
|---|---|
| Crisp / responsive | Phase 1–2 (fixed-timestep sim, render decoupled) |
| Online vs. strangers | Phase 4 → Phase 6 (snapshot/restore → rollback + matchmaking) |
| Desktop (Tauri/Steam), mobile (Capacitor) | Phase 2 (sim is renderer-agnostic; shell is swappable) |
| Complex projectiles, throws, extendable arms | Phase 3 + the sim event vocabulary living in one pure place to extend |
