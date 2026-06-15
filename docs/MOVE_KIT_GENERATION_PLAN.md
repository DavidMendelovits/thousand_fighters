# Move Kit Generation + Admin Authoring — Implementation Plan

Status: IMPLEMENTED + tested. Reviewed by /codex (consult), verified against the runtime.

## Implementation summary (what shipped)

Phase 1 — pipeline:
- `cms/pipeline/adapters/characterContentDraftSchema.js` — single shared, strict-mode
  schema (+ guidance) imported by both real text adapters; move `animation` enum =
  `MOVE_SHEET_IDS`; adds `combos`, `projectiles`, event `projectileId`/offsets,
  walk/grab/throw frameCounts. Killed the two duplicated copies.
- `CharacterCreationPipeline.createCharacterDraft` persists combos + projectiles,
  derives `projectile.animation`, and self-heals (prune invalid, warn on dangling).
- `applyComboChaining` derives the full cancel graph (cancelInto + cancelFrom +
  allowedStates+='attack' + window) so generated combos FIRE. convertEvent defaults
  projectileId offsets. Mock adapter emits a full kit.
- Tests: new `scripts/smoke_cms_creation_kit.mjs` (10) + combo cancel-graph test.

Phase 1b — walk_forward/walk_back state-driven LOOPING rows (registry + engine
STATE_ROW_MAP/loop + Fighter + prompt profiles + admin MOVE_IDS/MOVE_ORDER + smokes).

Phase 3 — generated projectile runtime rendering: `src/core/projectileAssets.ts`
helper; FightScene dynamic preload (hardcoded list kept for hand-authored fighters);
testbed `projectileUrls` (runtimeConfig → TestbedScene); exporter copies
`draft.projectiles[].sourceKey` → `/fighters/<id>/projectiles/<animation>.png`.
Test: export-smoke projectile-copy assertion.

Phase 2 — admin Kit section (`admin/app.js` + `styles.css`): combos add/delete,
projectiles generate/edit-numbers/delete, generation warnings surfaced; assertRowId
on generate_combo. DEFERRED: full move trigger/phase GUI editor (moves come from
generation; gym tunes hitboxes; chat patches moves) — tracked follow-on.

frameCounts fix (advisor): creation declares only the canonical 5; buildSpriteConfig
overlays the manifest's extracted counts so generated rows (walk/grab/throw/jump/
crouch/...) render once their sprites exist — and a fighter doesn't "own" (→ missing
texture) a row it hasn't generated. Also closed the pre-existing latent gap where
generated jump/crouch never rendered for CMS fighters.

## /codex review (diff) — findings folded in

- [P1] payload-less `spawn_projectile` (projectileId null) would reach the runtime as a
  bare event and crash ProjectilePool → convertEvent now neutralizes it to hitbox_end
  (+ regression test).
- [P1] empty combo-member trigger.sequence = wired-but-dead combo → schema `minItems:1`
  on sequence + healGeneratedKit warns.
- [P1] admin projectile delete could silently orphan spawn moves → deleteProjectile
  warns/confirms when moves still reference it.
- [P2] define_projectile could create a non-renderable entity → now derives
  `animation` (and preserves prior animation/sourceKey on number-only edits).

## Verified vs. NOT verified

Verified: all CMS smokes (phase4 aggregate + export 62 + pipeline + full-flow +
creation-kit 10), tsc clean, full `npm run build`. Two /codex passes + advisor.
NOT verified: live in-engine visuals (projectile sprite rendering, walk loop, combos
firing during play, admin Kit clicks against a running server). Manual check:
`npm run dev` → playtest an existing fighter with a projectile to confirm the dynamic
preload path; `npm run cms:admin` → create/generate to exercise the Kit UI.

---

(original plan retained below)

Status: reviewed by /codex (consult) + verified against the runtime. Combos solved on paper.

## Problem

Two gaps, both confirmed in code:

1. **Creation only seeds 4 attacks.** `create_character_draft` → text model →
   `characterContentDraftSchema()` caps `moves[].animation` to
   `['punch','kick','special_1','special_2']`, requires `moves` only, and emits
   **no `combos` and no `projectiles`**. The full kit (grab/throw moves, combos,
   projectiles) never gets generated at creation time.
2. **Admin UI has no authoring surface.** `admin/app.js` "move cards" only
   generate the sprite row + show move data **read-only**. No controls for move
   trigger/phases/hitboxes, combos, or projectiles — even though the tools exist
   and the server exposes every tool via `POST /api/tools/<name>`.

User goal: pipeline first, then admin UI. Full scope = move defs + combos +
projectiles. No gaps. Combos are the delicate part.

## Combos — the real mechanism (verified in runtime)

Wiring `cancelInto` alone does NOT make a generated combo fire. The runtime cancel
path (`Fighter.ts:246-248` → `findTriggeredMove(true)` at `Fighter.ts:318`) requires
ALL of:
- the current phase is `cancellable` — comes free: convert defaults
  `cancellable: phaseName === 'recovery'` (convert:877), and every move has a recovery phase;
- the next move's `trigger.allowedStates.includes('attack')` — **the blocker.**
  convert defaults `allowedStates` to `['idle','walk_forward','walk_back']`
  (convert:612). No `'attack'` ⇒ the cancel candidate is rejected;
- the input is still in `trigger.window` — convert pins it to **6** (convert:615);
  Fighter's `?? 15` never fires post-convert. 6 frames is too tight to land a cancel;
- `cancelInto` lists the next move (the only piece applyComboChaining does today).

**Solution (do it ALL in `applyComboChaining`, derived from the combo descriptor —
not the schema, not the model):** for each adjacent pair a→b:
- `a.cancelInto += b`  (exists)
- `b.trigger.cancelFrom += a`  ← **load-bearing.** The `cancelFrom` check at
  `Fighter.ts:319` is `forCancel`-guarded, so b still triggers normally from neutral
  (standalone behavior preserved), and on the cancel path b only cancels from a — not
  from *any* attack. Adding `allowedStates+='attack'` WITHOUT `cancelFrom` is the footgun.
- `b.trigger.allowedStates += 'attack'`  (deduped)
- `b.trigger.window = max(b.trigger.window ?? 6, 14)`  (room to land the cancel)

This is principled inside `applyComboChaining`: it's the same cancel graph derived from
the same descriptor as `cancelInto`, non-persisted, re-derived cleanly when a combo is
edited. Update `define_combo`'s description (currently says "author the cancel windows
separately" — no longer true).

## Key facts established from the code

- **Draft contracts** (consumed by `cms/export/convertDraftToCharacterConfig.js`):
  - `draft.moves[]`: `{ id, displayName, description, animation, trigger:{sequence,allowedStates?,window?,cancelFrom?}, phases:[{name,frames,cancellable?,events:[{frame,event}]}], cancelInto?, ... }`
  - `draft.combos[]`: `{ id, displayName?, segments:[moveId,...] }` (>= 2)
  - `draft.projectiles[]`: `{ id, animation, sourceKey?, width, height, speed, velocity:{x,y,relativeToFacing}, gravity?, lifetime, hitbox:{x,y,width,height,damage,hitstun,blockstun,knockback:{x,y},level}, pierces?, clashesWithProjectiles? }`
  - Spawn events reference a projectile by `projectileId`; convert resolves it.
- `frame` vs `onFrame`: convertPhase maps `onFrame: e.frame ?? e.onFrame ?? 0` (convert:854). No mismatch.
- **Convert already supports combos + projectiles** (reused by publish + live runtime-config).
- **Schema duplication is OpenAI + Codex only.** `mockAdapters.js` is a literal fixture,
  not a schema copy; `localAdapters.js` text model just throws. (Codex P2 corrected the count.)
- `shared/animationRows.js` exports `MOVE_SHEET_IDS` (`punch,kick,special_1,special_2,grab,throw`) — the enum source.
- Validators exist: `validateCombos`, `validateProjectiles`, `validateProjectileReferences`.
- `createCharacterDraft` builds `content` with only `moves` — drops `combos`/`projectiles` even if generated.

## /codex findings — dispositions (all verified)

- [P1] Combo state-gating — **FIX via applyComboChaining cancel graph above.** (verified Fighter.ts:246/318)
- [P1] `recovery` cancellable not enough; window too tight — **FIX: bump window in applyComboChaining.** (verified convert:615)
- [P1] generate_combo conflates move-id vs row-id; no `assertRowId` — **FIX: combo sprite gen maps move.animation→rows (deduped); add assertRowId to generate_combo.** (verified createCmsTools.js:144)
- [P1] projectileId spawn events get no `offsetX/offsetY` defaults (inline path does) — **FIX: default offsets in convertEvent projectileId branch.** (verified convert:976 vs 986)
- [P1] OpenAI strict-output: new props must be `required` + nullable via `anyOf:[T,{type:'null'}]` — **FIX: follow the existing hitbox/projectile null pattern; nothing truly "optional".**
- [P1] grab/throw moves need their rows — **VERIFIED graceful: missing row ⇒ missing-texture box, not a crash (moveVisualFrame defaults frameCount→4). Move data may precede sprite. FIX: add grab/throw to frameCounts; admin nudges row generation.**
- [P1] Generated projectile art not loaded at runtime — **PRE-EXISTING T23 ENGINE GAP (see decision below).** (verified runtimeConfig loads 0 projectile textures; FightScene hardcodes keys; ProjectilePool falls back to rectangle)
- [P1] Admin delete via define_* (upsert-only) — **FIX: delete via update_character_draft full-array replace.** (verified createCmsTools.js:114)
- [P2] schema-copy count — corrected above.
- [P2] validateProjectiles too weak — **FIX: require animation + velocity + hitbox + damage.**
- [P2] event `type` free string — **FIX: enum the spawn/hitbox event types in the schema.**

## Plan — Phase 1: Pipeline (generate the full kit)

1. **Shared schema module** `cms/pipeline/adapters/characterContentDraftSchema.js`:
   import `MOVE_SHEET_IDS` for `animation` enum; add `combos` + `projectiles`;
   add `projectileId`/`offsetX`/`offsetY` to the event schema (required + nullable);
   enum the event `type`; add `grab`/`throw` to `frameCounts`. Both
   `openAiResponsesTextModelAdapter.js` and `codexTextModelAdapter.js` import it.
2. **System prompt** (both real adapters): author moves across all move rows incl
   grab/throw; every move has startup/active/recovery phases; emit `combos`
   referencing only generated move ids (>=2); emit `projectiles` and reference them
   from spawn events via `projectileId`. (Do NOT ask the model for
   allowedStates/cancelFrom — convert derives them from the combo descriptor.)
3. **Persist** combos + projectiles in `createCharacterDraft.content` (the dropped-field fix).
4. **Validate + self-heal at creation**: prune structurally-invalid combos/projectiles,
   warn on dangling projectile refs; surface `content.generation.warnings`. Never hard-fail.
5. **applyComboChaining**: extend to the full cancel graph (cancelInto + cancelFrom +
   allowedStates+='attack' + window bump).
6. **convertEvent**: default `offsetX/offsetY` for the projectileId branch.
7. **validateProjectiles** hardening.
8. **Mock adapter parity**: grab/throw move + 1 combo + 1 projectile (projectileId ref).
9. **Tests**: `scripts/smoke_cms_creation_kit.mjs` (mock → createCharacterDraft → assert
   combos/projectiles/grab-throw persisted, validators pass, convert wires cancelInto +
   cancelFrom + allowedStates + resolves projectile). Keep smoke_animation_rows green.

## Plan — Phase 2: Admin authoring UI (front-end forms → existing tools)

- **2A Move authoring**: editable Data tab → trigger.sequence, phases, hitbox events,
  optional spawn_projectile (projectileId picker). Save via `update_character_draft` (arrays replace).
- **2B Combos**: list/add/edit/delete (delete = update_character_draft array replace);
  segment picker from live move ids → `define_combo`; "Generate combo sprites" maps
  segment move.animation→rows (deduped) → `generate_combo`.
- **2C Projectiles**: list; "Generate projectile" (id+prompt) → `generate_projectile`;
  "Edit numbers" → `define_projectile`; delete via array replace; show ref warnings.

## The one open decision (everything else: build per "no gaps")

**Runtime rendering for generated projectiles.** Generated projectile sprites are not
preloaded by the testbed (playtest) or FightScene, so they spawn as colored rectangles
(pre-existing T23 gap, separable engine work).
- (A) In scope now: dynamic projectile texture preload from `draft.projectiles`/config in
  testbed + FightScene, + publish copies the sprite into `/fighters/<id>/projectiles/`.
  True no-gaps end to end; larger, engine-side.
- (B) Defer: generate + author + convert-resolve the entity now (correct numbers, editable
  in gym/admin, spawns as rectangle), track runtime texture loading as a tracked follow-on.
