# CMS & Sprite Pipeline Overhaul — June 2026

Branch: `DM/cms-admin-platform` · PR: [#5](https://github.com/DavidMendelovits/thousand_fighters/pull/5) · 19 commits (`855474e..0d72b4a`)

This document records the four bodies of work landed in this overhaul, the design
decisions behind them, and what remains. Written for contributors picking up the
pipeline after this point.

---

## 1. CMS works end-to-end

The pipeline previously worked stage-by-stage but the chain had breaks at both
ends: the game never loaded what the CMS published, and adapters disagreed about
formats. All of these are now closed and covered by a single keyless smoke test.

### Game loads published fighters
- `scripts/build_assets_index.mjs` flags fighters that have a `config.json`
  (`entry.config`), and supports `ASSETS_PUBLIC_DIR` for tests.
- New `src/characters/roster.ts`: `loadCmsRoster()` runs before the Phaser game
  constructs (`src/main.ts`), fetches flagged configs, validates them minimally,
  and merges via `mergeRoster()`. `FightScene` reads the merged `roster`.

### One canonical manifest schema
- Canonical = game format: camelCase `sheets` / `sprites` / `frameCounts`, paths
  relative to the fighter root. The Python normalizer used to write snake_case
  `sheet_paths` / `frame_counts` with absolute paths; the export converter only
  worked via a hardcoded fallback.
- `cms/pipeline/manifestSchema.js` is the shared source of truth:
  `normalizeManifest()` (legacy → canonical on read), `validateManifestSchema()`
  (backs the QA `manifest-schema` check), `hasLegacyManifestKeys()`.
- All 15 legacy manifests under `public/fighters/` were migrated
  (`scripts/migrate_fighter_manifests.mjs`, idempotent).

### Publish gate and export completeness
- `CharacterContentRepository.writeQaReport` maintains
  `characters/{id}/qa/latest.json`; the local publisher refuses to publish
  without a non-failing QA report (`force: true` overrides, and the publish
  result records the QA status it shipped with).
- `exportCharacterToRuntime` now also copies `sounds/` (generated SFX live at
  `characters/{id}/assets/sounds/`, *outside* the fighter pack) and the
  root pack files (`manifest.json`, `frameData.json`, `normalization-report.json`)
  that the assets index reads.

### Keyless operation (CLAUDE.md invariant restored)
- The text/image/sound adapter factories accept `provider: 'mock'`. The mock
  image generator returns a **real** tiny magenta row PNG (embedded base64), so
  extraction and anchoring run for real in tests. The mock text model returns a
  representative draft with a small moveset.
- New `npm run cms:fullflow:smoke` (`scripts/smoke_cms_full_flow.mjs`):
  draft → per-move row → extraction → SFX → normalize → QA gate (negative and
  positive) → publish → export → assets-index discovery, zero API keys.
- Python invocations are hardened: stderr surfaces in pipeline errors,
  zero-frame extractions throw, and the contour normalizer refuses to upload a
  partial pack.

---

## 2. Dynamically sized sprites (extending limbs)

Goal: a squid fighter whose tentacle extends far forward and grabs the
opponent — seamless with the character, not a projectile.

**Core decision: extending limbs are wider frames of the same sprite, not
separate objects.** The engine already supported this — `frameData.json` carries
per-frame `width`/`height`/`anchor` and `Fighter.syncActorVisual()` converts the
anchor to a Phaser origin with correct facing-flip math — so the work was in
gameplay and the asset pipeline, not rendering.

### Grab mechanic (`src/core/`)
- New `MoveEvent`s `grab_check` / `grab_end` with a `GrabSpec`, and a new
  `grabbed` `FighterState`.
- On hurtbox overlap, `HitResolver.resolveGrab` locks the victim to the grabber.
  The pull interpolates **from the contact point** (recorded facing-relative) to
  `holdOffsetX` over `pullFrames` — the tentacle drag-in matches wherever it
  actually connected. Release applies knockback into hitstun/juggle/knockdown.
- Grabs are unblockable but whiff on invulnerable / already-held / downed / dead
  opponents. An interrupted grabber (hit out of the move) drops the victim
  safely. `resolveFighterSpacing()` skips held pairs — the body pushbox stays
  fixed by design (limbs don't push; standard fighting-game convention).

### Hitbox keyframes (`src/core/hitboxGeometry.ts`)
- `hitbox_active` accepts optional `keyframes: [{atFrame, x?, y?, width?, height?}]`,
  linearly interpolated by frames-since-activation (an implicit keyframe at
  frame 0 carries the base geometry). The hitbox can ride a tentacle tip out
  and back instead of covering the whole reach for the whole window.
- Damage data stays on the base hitbox; only geometry animates. Deterministic
  and hand-authorable — deliberately *not* derived from the sprite silhouette,
  so regenerated art can never silently change a move's range.

### Wide sprite profile (CMS side)
- Draft moves can declare `spriteProfile: 'wide'`. The image API caps landscape
  at 1536×1024, so "wide" renders the 6 frames as a **2×3 grid** (~512px cells
  vs ~256px) rather than a wider image. `extract_row_frames.py` takes
  `--rows/--cols`.
- The contour normalizer labels connected components on a **dilated** alpha mask
  (gaps ≤ ~3px bridge) but cuts the final mask from the original alpha — thin
  tentacles separated by anti-aliasing survive isolation, the dilation halo
  stays transparent.
- frameData frames carry `reachX` (forward silhouette extent from the pivot) so
  tooling can place hitbox keyframes at the limb tip.

Deferred: camera handling for very wide frames at the stage wall (clipping is
acceptable; a both-fighters-bounds camera is an isolated future change).

---

## 3. Admin layout

- **Tabbed ops column** (Activity / Pipeline / Tools): the activity feed gets
  the full column height, adapter health is one click away, and a topbar
  health-dot strip surfaces adapter problems before a generate fails. The
  `/pipeline` workbench detour route is gone.
- **Move activity slide-over** (`#move-activity-panel`): activity logs no longer
  hijack the error modal's DOM; the modal is errors + Codex diagnosis only.
- **Move cards** group content into Frames / Data / Sounds / Source tabs; all
  workbench buttons use one delegated click handler (no per-render listener
  re-attachment). Long generated names wrap (`overflow-wrap: anywhere`) instead
  of widening the mobile layout.
- **Wizard state lives server-side** (`characters/{id}/assets/wizard/state.json`)
  once a draft exists; localStorage is a pointer/offline fallback. The newer
  copy wins on restore; publishing writes a `completed` tombstone.
- Playwright suite: 20 tests (chromium + mobile) run in ~5s against a
  mock-provider server (`ADMIN_BASE_URL=http://127.0.0.1:8799`). Against a
  Codex-backed server the same suite took 4.6 minutes — always test against
  mocks.

---

## 4. Sprite generation pipeline (audit follow-ups)

An audit found the per-row generation flow was a dead end: extracted frames
landed outside the fighter pack with no anchors and no frameData, so generated
sprites could never reach the game; the contour normalizer still expected the
removed 5×6 sheet format. Fixes, in the order they matter:

### Row normalizer — generation *is* normalization
`scripts/extract_row_frames.py` is now a true normalizer:
- **Chroma key with edge despill**: binary magenta keying, then pixels within
  2px of transparency get their r/b capped at `g + 90` — kills pink fringes
  without desaturating legitimately pink characters.
- **Anchors that keep limbs planted**: `anchor.y` sits on a fixed floor padding;
  `anchor.x` is the alpha-weighted centroid of the bottom 12% of the silhouette
  (the feet) — verified to hold ±0px while frames grow 117→189px wide.
- **Scale normalization**: `--target-height` rescales a row uniformly
  (LANCZOS) when its median silhouette height deviates >2%. The pipeline derives
  the target from the existing base row — **the base row defines the fighter's
  scale**; every other row matches it.
- Emits `reachX`, `silhouetteHeight`, edge-touch warnings (limb at a cell
  boundary = possible truncation), magenta-residue warnings, an assembled
  per-move sheet, and a `frameData` fragment.

`CharacterCreationPipeline.extractRowFrames` writes everything into
`fighter-pack/` and **merges per move**: frames replace stale ones
idempotently; the move's frameData and manifest entries merge without touching
other moves; warnings aggregate into `normalization-report.json`
(`workflow: 'row-normalizer'`).

### Reference-image conditioning
`referenceAssetKeys` used to be JSON-stringified into the *prompt text* — the
model never saw pixels. `generateSpriteSheet` now loads the bytes (non-base
rows default to the approved base row + concept art) and the OpenAI adapter
sends them as `input_image` parts with a match-this-fighter instruction. This
is the main lever for cross-row identity and scale consistency.

### QA gates
- `frame-height-consistency`: each sheet's median `silhouetteHeight` vs the
  base row — warning >15% drift, error >25%. Skips on legacy packs.
- `wide-reach-sanity`: `spriteProfile: 'wide'` moves must have max `reachX`
  exceeding the base row's, else the wide generation failed its purpose.

### Canonical frame roles
Frames 1–2 startup · 3 reaching/extending · **4 moment of contact / full
extension** · 5 follow-through/retraction · 6 recovery — pinned in both image
adapters' prompts and the `generate_sprite_sheet` tool description, so
`visualTimeline` and hitbox keyframes can be authored against known roles
(the squid's grab keyframe goes at frame 4's `reachX`).

### The wizard's normalize step is gone
Per-row generation + extraction already builds the pack, so the old
`normalize_sprite_pack` call could only destroy that work by overwriting it
with janitor fixture art. The Frames step is now a **non-destructive review**:
lists extracted rows, names missing ones, previews the pack. No placeholder
art ships silently — QA flags incomplete packs instead.
`normalize_sprite_pack` survives as a dev tool (workbench Tools tab) and its
fixture normalizer preserves row-normalized sheets (detected by the
`silhouetteHeight` signature, not just the report marker), filling only gaps.

---

## Verification

- `npx tsc --noEmit` clean; `npm run build` passes.
- Keyless smokes: `cms:pipeline:smoke`, `cms:e2e`, `cms:fullflow:smoke`,
  `cms:row:smoke`, `cms:qa:smoke`, `cms:export:smoke`, `cms:normalizer:smoke` —
  all green with zero API keys.
- Playwright: 20/20 admin tests, chromium + mobile.
- Engine logic verified headless (HitResolver/MoveExecutor/HitboxSystem are
  Phaser-free at runtime): 7 grab scenarios, keyframe interpolation math,
  extraction invariants on synthetic sheets (anchor stability, reach growth,
  despill, rescale, edge-touch detection).

## Known gaps / next steps

1. **In-game visual QA of the grab + wide-profile flow** — engine logic is
   verified headless, but nobody has watched a squid grab in the browser yet.
   `debugStartMove()` + the debug overlay (grab boxes render green) are the
   tools.
2. **Camera** doesn't account for very wide frames at stage walls.
3. **Auth/audit on admin routes** — still open (pre-existing gap).
4. **Contour normalizer (5×6 path)** is legacy: nothing produces 5×6 sheets
   anymore. Keep for re-imports or retire.
5. When testing the admin, restart any long-running `cms:admin` server —
   pipeline code changes are server-side.
