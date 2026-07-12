# Thousand Fighters

A multiverse fighting game built with Phaser 3 + a hexagonal-architecture CMS pipeline for AI-driven fighter creation.

## Project Structure

```
src/              Game engine (TypeScript, Phaser 3)
  core/           Fighter, MoveExecutor, HitboxSystem, HitResolver, ProjectilePool
  scenes/         FightScene, DebugOverlay, DebugPanel
  schema/         types.ts — all game types
  characters/     stamptownFighters.ts — CharacterConfig definitions
cms/              CMS pipeline (JavaScript, ESM)
  pipeline/       Ports, adapters, PipelineRegistry, CharacterCreationPipeline
  tools/          createCmsTools.js — 14 CMS tools for agents
  agent/          Chat agents (OpenAI Responses, local, Codex CLI)
  codex/          Local Codex automation modules
  runtime/        createLocalCmsRuntime.js — bootstrap
  storage/        File, R2, Supabase, cached backends
  repositories/   CharacterContentRepository
public/           Static assets
  fighters/{id}/  Per-fighter: manifest.json, frameData.json, sheets/, sprites/, projectiles/, sounds/
  arenas/{id}/    Arena backgrounds
  audio/          Shared sfx/ and bgm/
scripts/          Build tools, smoke tests, migration scripts
docs/             Architecture docs, style guide, QA plan
```

## Key Patterns

### Port/Adapter Architecture (CMS)

All CMS capabilities are defined as ports in `cms/pipeline/ports.js`. Each port has required methods. Adapters implement ports and are registered in `PipelineRegistry`. Provider selection is env-var-driven.

Ports: `assetStorage`, `characterRepository`, `textModel`, `imageGenerator`, `soundGenerator`, `spriteNormalizer`, `fighterQa`, `publisher`, `jobQueue`

To add a new adapter:
1. Define or reuse a port in `cms/pipeline/ports.js`
2. Create adapter in `cms/pipeline/adapters/` with `id`, `provider`, `capabilities`, `healthCheck()`, and port methods
3. Create a factory `createXAdapter.js` that reads env var for provider selection
4. Add local placeholder in `localAdapters.js` and mock in `mockAdapters.js`
5. Register in `cms/runtime/createLocalCmsRuntime.js`
6. Add CMS tool in `cms/tools/createCmsTools.js` if agent-facing
7. Add smoke test in `scripts/smoke_cms_*.mjs`

### Fighter Asset Contract

Every fighter has 5 sheets (`base`, `punch`, `kick`, `special_1`, `special_2`) with 6 frames each (standard). Frame PNGs are individually loaded, keyed as `{characterId}:{sheetId}:{frameIndex}`. Each frame has its own dimensions and anchor point (feet/pivot) in `frameData.json`. Variable frame sizes are intentional — a mop swing can be wider than an idle pose.

### Move System

Moves are defined as `Move` objects with `trigger` (input sequence), `phases` (frame-by-frame events), and optional `visualTimeline`. Each `MovePhase` has `frames` (duration) and `events` (hitbox_active, hitbox_end, play_sound, spawn_projectile, etc.). `MoveExecutor` dispatches events; `HitboxSystem` checks AABB overlap; `HitResolver` applies damage/hitstun/knockback.

### Sound System

Sound keys in `play_sound` events resolve as: try `{characterId}:{soundName}` first, fall back to `{soundName}`. Hit sounds via `hitbox.hitSound` are de-duplicated per frame. Sounds are preloaded from `assets-index.json`.

## Dev Commands

```bash
npm run dev                    # Vite dev server
npm run build                  # Build (generates asset index first)
npm run assets:index           # Regenerate public/assets-index.json
npm run cms:admin              # Start CMS admin server
npm run cms:pipeline:smoke     # Smoke test full pipeline
npm run cms:sound:smoke        # Smoke test sound generation
npm run cms:arena:smoke        # Smoke test arena generation
npm run cms:chat:smoke         # Smoke test chat agent
```

## Key Invariants

- No vendor SDK in orchestration code — adapters isolate all provider calls
- Every adapter must have a local placeholder that works with zero API keys
- Env vars drive provider selection: `IMAGE_GENERATOR_PROVIDER`, `SOUND_GENERATOR_PROVIDER`, `CMS_STORAGE_PROVIDER`, etc.
- `assertPortAdapter()` validates adapter shape at registration time
- The `play_sound` event type in MoveExecutor and `hitSound` on Hitbox are the only two paths for game audio
- Debug visualization is controlled by `DebugPanel` (F1 master toggle, F3 panel) — per-actor, per-category
- `public/assets-index.json` is the canonical asset catalog, regenerated at build time
