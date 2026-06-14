# Character Gym — Design Plan

A dedicated admin tool for authoring a fighter's per-frame sprite alignment and
collision data. Route: `/roster/:id/gym`. It is the precision-editing
counterpart to the testbed (`src/testbed/`), which is for playtest/measurement.

Status: design review complete (plan-design-review, 2026-06-13). Approved layout:
**B+C hybrid** (three-pane + bottom timeline). See "Approved Mockups".

---

## 1. Goal

Give a fighter author three things the reference "Character Gym" implies, mapped
to *this* engine's data model:

1. **Select which frames go into each move** — confirm grid segmentation,
   reorder/role-map the extracted frames, mark empties, resolve extractor warnings.
2. **Align frames for stable playback** — drag/nudge the per-frame feet anchor so
   the silhouette stays planted on the floor line across the animation. This is
   the value the user called "more important."
3. **Visualize and specify per-frame bounding boxes** — visual bounds, anchor
   pivot, per-state hurtboxes, per-move-phase hitboxes — with honest editing that
   survives re-normalization.

Scope (locked in review): dedicated route, **full collision authoring**.

---

## 2. What already exists (reuse, do not rebuild)

| Need | Already in repo | Reuse |
|------|-----------------|-------|
| Canvas rendering (floor line, ruler, anchor crosshair, hurt/hit boxes) | `src/testbed/TestbedScene.ts` (`drawStage`, `drawAnchor`, `drawFighterBoxes`, `drawBox`) | Extract the overlay renderer; the gym canvas is a TestbedScene variant in edit mode. |
| Frame stepping, play/pause/slow, frame counter | `TestbedScene.step/setMode/getSnapshot` | Drive from the timeline transport. |
| Per-frame anchor / dims / measured hurtbox / attackBox | `frameData.json`, emitted by `scripts/extract_row_frames.py` | Read for display; anchor is editable. |
| Draft → runtime transform | `cms/export/convertDraftToCharacterConfig.js` | The gym must round-trip through this; overrides plug in here. |
| Asset load + cache-busting | `admin/app.js` `selectCharacter`, `withCacheBust` | Reuse for frame thumbnails so edits refresh. |
| Design tokens + component vocab | `DESIGN.md`, `admin/styles.css` | All gym CSS uses existing tokens. |
| Frame-strip / sprite-row UI | `.sprite-row` in `admin/styles.css` | Timeline thumbnails reuse the vocab. |

The gym is ~70% assembly of existing pieces + a new edit/persistence layer.

---

## 3. The data-model reality (read this before building anything)

Editing surfaces split on **two axes**: granularity, and measured-vs-authored.
The reference UI only ever had per-frame, hand-authored anchor. Our full-collision
scope adds two more granularities and a derived-geometry pipeline. The UI must
make these differences visible or it will lie to the user.

| Data | Granularity | Today | Editable in gym |
|------|-------------|-------|-----------------|
| **Anchor** (feet pivot) | per-frame | hand-authored in `frameData.frames[sheet][i].anchor` | **Yes — direct.** Primary tool. |
| **Visual bounds** (w/h) | per-frame | intrinsic PNG dims (measured) | Read-only display; optional trim box (override). |
| **Hurtbox** | per **FighterState** | `generateDefaultHurtboxes()` derives from measured per-frame `hurtbox` via `STATE_BASE_FRAME`; **draft carries none** | Needs an **override layer** convert respects. |
| **Hitbox** geometry | per move **phase** (`hitbox_active` event) | `applyMeasuredHitboxGeometry()` **overwrites** from frame `attackBox` | Override layer, or "re-measure" action. |
| **Hitbox numbers** (damage/hitstun/blockstun/knockback/level) | per `hitbox_active` event | AI-authored in `draft.moves[].phases[].events` | **Yes — direct.** |

**Consequence for the UI:** the four BOUNDS modes are NOT symmetric.

- The reference's `Active this frame` checkbox only means something for **per-frame**
  data (anchor/visual). In **Hurtbox** mode the timeline/label switches to
  *"editing STATE: attack"*; in **Hitbox** mode the timeline highlights **phase
  bands**, not single frames.
- Each box mode shows a **MEASURED / OVERRIDDEN** badge. Derived values render in a
  muted "computed" style; the user clicks **Override** to author. An override that
  the convert pipeline respects is the only way `frameData`/draft edits survive the
  next normalize. Without it, "specify the box" silently reverts on re-extract —
  the trust-killer.

This override layer (schema + `convertDraftToCharacterConfig` + the two measured-
geometry passes honoring overrides) is the one real piece of new architecture. It
is gated by Decision D2 below.

---

## 4. Layout — B+C hybrid

Classifier: **APP UI** (data-dense workspace, not marketing). Calm surfaces, one
accent, monospace numerics, no cards-as-decoration.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◀ Roster / Red Brawler / Gym        [overlay legend]      ● Unsaved   [Save ⌘S] │  topbar
├────────────┬───────────────────────────────────────────────┬──────────────────┤
│ MOVE NAV   │                                               │ INSPECTOR        │
│ (scales)   │              CANVAS  (Phaser, edit mode)      │ (context by mode)│
│            │   ┌─────────────────────────────────────┐     │                  │
│ search…    │   │  character on floor line + ruler     │     │ BOUNDS MODE      │
│ ▾ Base     │   │  overlays: visual / anchor / hurt /  │     │ [Vis|Anc|Hurt|Hit]│
│   · idle   │   │  hit  + draggable gizmo handles      │     │ MEASURED ▸override│
│ ▾ Normals  │   │                                      │     │                  │
│   · punch ●│   │                                      │     │ GIZMO  Move(Q)   │
│   · kick  ◐│   │                                      │     │        Scale(W)  │
│ ▾ Specials │   └─────────────────────────────────────┘     │ scope: this frame│
│   · sp_1  ○│                                               │  X  Y  W  H (mono)│
│ ▾ Combos   │                                               │ ─ context list ─ │
│ ▾ Movement │                                               │  (per-state /    │
│ [+ Move]   │                                               │   per-phase rows)│
├────────────┴───────────────────────────────────────────────┴──────────────────┤
│ TIMELINE  ◀◀ ▮▮ ▶▶   0.5× 1× 2×   onion▢      [▮1][▮2][▮3][▮4][▮5][▮6]  ▲play  │
│           frame 3 / 6 · 12 fps · anchor 110,248                                 │
└────────────────────────────────────────────────────────────────────────────────┘
```

- **Left — Move Navigator:** the answer to "scale to many moves." Not 5 tabs.
- **Center — Canvas:** TestbedScene overlay renderer in edit mode + drag gizmos.
- **Right — Inspector:** content switches with BOUNDS mode (the asymmetry above).
- **Bottom — Timeline:** filmstrip + transport + onion-skin. In Hitbox mode it
  renders phase bands; in Hurtbox mode it dims (state, not frame, is selected).

---

## 5. Move Navigator (scaling beyond 5 sheets)

Requirement (user): must handle combos, dashes, more specials — many more than 5.

- **Grouped, collapsible tree:** Base / Normals / Specials / Combos / Movement,
  plus author-added groups. Engine is 5 sheets today; the UI never hardcodes 5.
- **Per-move status dot:** ● aligned + bounds set · ◐ partial · ○ no frames. Lets
  the author scan progress across a large move set (App-UI primary-nav pattern).
- **Search field** filters by name.
- **`[+ Move]`** is forward-looking; if the engine frame contract hasn't expanded,
  adding a move beyond the 5 sheets shows an inline note ("engine supports 5 sheets
  today — this move is staged"). No dead end, honest about the constraint.

---

## 6. BOUNDS modes — inspector spec (per granularity)

| Mode | Scope selector | Inspector body | Persists to |
|------|----------------|----------------|-------------|
| **Visual** | per-frame (timeline) | W/H (read-only intrinsic only — trim box CUT, no runtime consumer per Codex #9) | — (display only) |
| **Anchor** | per-frame (timeline) | X / Y (CENTER), "copy to all frames in move", nudge hints | `frameData.frames[sheet][i].anchor` |
| **Hurtbox** | per-**state** dropdown (idle/crouch/attack/…) | box X/Y/W/H, MEASURED badge + Override, "reset to measured" | draft `hurtboxes` override layer |
| **Hitbox** | per-**phase** band (timeline) | active window, damage/hitstun/blockstun/knockback/level (authored), geometry X/Y/W/H (MEASURED badge + Override) | `draft.moves[].phases[].events` (numbers) + geometry override |

Gizmo: **Move (Q)** / **Scale (W)** act on whatever box the current mode targets.
Drag on canvas updates the numerics live; typing updates the canvas live.

---

## 7. Interaction states

| Feature | Loading | Empty | Error | Success | Partial |
|---------|---------|-------|-------|---------|---------|
| Canvas | skeleton + "Loading frames…" | "No frames for this move yet. Generate or upload its sheet." + link to row generator | engine error banner (reuse testbed pattern) + pause + Reset | sprite renders, planted on floor | per-frame "needs anchor" marker on timeline thumb |
| Move nav | shimmer rows | "No moves yet — start with Base." | "Couldn't load draft." + retry | status dots populate | mixed ●◐○ dots |
| Anchor edit | — | — | out-of-bounds value clamped + hint | feet stop drifting under onion-skin | some frames ◐ |
| Hurtbox/Hitbox override | — | "No override — using measured." | "Override conflicts with measured re-run." | OVERRIDDEN badge | mix of measured/overridden rows |
| Save | spinner on Save btn | — | toast (danger), stay dirty | dirty dot clears, toast "Saved" | — |

Empty states get a primary action, not just "none found."

---

## 8. User journey (time horizons)

- **5 sec:** lands on the gym, the fighter is already playing the selected move on
  the floor line. Foot-drift (the problem) is immediately visible.
- **5 min:** scrub → onion-skin on → drag the anchor until the feet lock → flip to
  Hurtbox/Hitbox to sanity-check collision → Save.
- **5 year:** returns to tune a new combo; the navigator's status dots show exactly
  which moves still need alignment. The tool ages into a checklist.

---

## 9. Design-system alignment

- All colors from `DESIGN.md` tokens. One accent (`--accent` green). Numerics in
  the mono stack. Radii 6–8px.
- **Overlay palette (define once, shared with testbed):** visual = cyan `#5bd6e6`,
  anchor = `--accent-2` amber, hurtbox = `--focus` blue, hitbox = `--danger` red.
  Reconcile testbed's current literals to these.
- **New components:** `.gym-shell`, `.gym-move-nav`, `.gym-canvas`, `.gym-timeline`,
  `.gym-inspector`, `.gym-gizmo`, `.gym-bound-row`, `.gym-status-dot`. Each reuses
  existing panel/row/segmented-toggle styling — no new visual language.
- Anti-slop check: workspace layout, not a card mosaic; no gradients, no decorative
  icons, no centered hero. Passes.

---

## 10. Responsive & accessibility

- **Desktop-first pro tool. Min usable width ~1100px.** Below that, show an honest
  "Character Gym needs a wider screen (≥1100px)" panel rather than a broken cramped
  layout. (Decision D-default-A.) Tablet landscape works; phone gets the message.
- **Keyboard map:** `Q` move gizmo · `W` scale · `Space` play/pause · `.`/`,` step
  fwd/back · `←↑↓→` nudge box 1px (`Shift` = 10px) · `1`–`6` jump frame · `⌘/Ctrl+S`
  save · `Esc` deselect gizmo.
- Numeric fields are real `<input type=number>` (SR + keyboard friendly), with
  **visible labels** (X/Y/W/H), never placeholder-as-label.
- Canvas is inherently non-SR; provide a **live region** echoing frame index +
  active box values, and full keyboard control so it's operable without a mouse.
- Focus rings use `--focus`. Transport touch targets ≥44px. Body text ≥ tokens
  (no <16px low-contrast values; box numerics use `--text`, labels `--muted`).

---

## 11. Persistence model

Eng review surfaced that edits span **two stores** with **no shared transaction**,
and that the existing `update_character_draft` tool (`deepMerge`, `createCmsTools.js:317`)
**replaces arrays wholesale and cannot delete keys**. Resolved decisions:

- **Dedicated `save_gym_edits` CMS tool (A2/A3).** One tool call does both writes and
  returns a per-half result so the UI knows exactly what persisted:
  - frameData (anchors + recomputed boxes + visual trim) → asset store (`writeAsset`).
  - draft hitbox numbers + `overrides` block → draft `content.json` (`saveDraft`).
  - **set/unset semantics** so "reset to measured" can actually *delete* an override
    key (deepMerge can't). Single-field edits don't require re-sending whole arrays.
  - Save order: frameData first, then draft; on draft-write failure, report partial
    state (frameData saved, draft not) and keep the gym dirty for the draft half.
- **A1 — anchor edits recompute boxes (MANDATORY).** frameData per-frame
  `hurtbox`/`attackBox` are anchor-relative (`extract_row_frames.py` `x: left - anchor_x`).
  When the gym writes a new anchor it MUST shift the frame's stored boxes by
  `Δ = oldAnchor − newAnchor` (pure translation, exact). Without this, every anchor
  nudge silently offsets the derived runtime hurt/hitboxes.
- **Save model:** explicit **Save** with dirty-state dot + nav-away guard (reuse the
  `confirm()` pattern in `admin/app.js`). Not autosave. After save, bust the asset
  cache (`withCacheBust`) so thumbnails/canvas refresh.
- **Override layer (D2):** `convertDraftToCharacterConfig` applies the draft `overrides`
  block **after** the measured passes (`generateDefaultHurtboxes`,
  `applyMeasuredHitboxGeometry`); measured passes skip overridden entries. A hitbox
  geometry override is a **static box that clears `keyframes`** (A4) — what you draw
  is what ships.
- **A5 — publish path:** `publish_character` must carry edited anchors + overrides into
  `public/fighters/<id>/`; the A1 box-recompute must run before publish or published
  collision drifts from the draft.

---

## 12. NOT in scope (deferred, with reason)

- **Editing the sprite art itself** (pixels) — the gym aligns/bounds frames; art
  generation stays in the row generator / Codex pipeline.
- **Authoring move *triggers*/input sequences** — that's move-logic, not sprite/
  collision; belongs to a move editor.
- **Multi-fighter / batch editing** — one fighter per route; revisit if it becomes
  a chore.
- **Mobile/phone editing** — desktop tool by nature (see §10).
- **Projectile authoring** — projectiles are separate entities (STYLE.md §3); out
  of the per-frame gym.
- **Lifting the 5-sheet contract** — the navigator scales in UI, but making "many
  moves" real engine-wide (combos/dashes as new sheet ids) is a separate workstream
  (T16/A7), not part of the gym build.
- **Visual-trim override** — cut; no runtime consumer (Codex #9).
- **Collision editing in Phase 1** — overlays are read-only until Phase 2.

---

## 13. Decisions

Design review (2026-06-13), then eng review (cross-model) which **reversed D3**.

- **D1 — Frame-selection depth → REORDER/SKIP + WARNINGS.** Reorder/role-map the 6
  extracted frames, mark empties, surface extractor warnings. Re-segmentation deferred
  (P3). Note (Codex #11): reorder changes `visualTimeline` meaning and measured-hitbox
  generation (conversion maps gameplay ticks → sprite frame index), so reorder is NOT
  independent of the collision work — it lands in Phase 1 but its convert-time effects
  are tested against Phase 2.
- **D2 — Collision override layer → BUILD IT (Phase 2).** Draft gains an `overrides`
  block; `convertDraftToCharacterConfig` applies it **after** the measured passes;
  measured passes skip overridden entries. Hitbox geometry override = static box,
  clears `keyframes` (A4).
- **D3 — Build sequencing → PHASE IT (reversed from one-pass).** Cross-model: Codex +
  design advisor both flagged that one-pass ties a usable anchor editor to a
  draft/runtime contract migration, made riskier by the new P1 blockers below.
  - **Phase 1 — Anchor gym:** Vite gym route, anchor alignment, frame reorder/skip,
    extraction-warning surfacing, collision overlays **read-only**, anchor persistence
    + re-extraction survival (A6). First usable tool.
  - **Phase 2 — Collision migration:** override layer (D2), per-state hurtbox + per-phase
    hitbox editing, `save_gym_edits` tool, full contract tests.
- **D4 — Canvas runtime → VITE-BUILT GYM ROUTE (Codex #5).** The gym is a Vite/TS entry
  like the testbed (reuses the game build + Phaser + the extracted renderer), reached
  from the admin with `?id=`. NOT part of static `admin/app.js` (which can't import TS/
  Phaser). Supersedes the design-review "admin SPA route" assumption.

**New eng-review findings folded:**
- **A6 [P1] — anchors must survive re-extraction (Codex #2).** `CharacterCreationPipeline.js:270`
  overwrites `frameData.frames[moveId]` wholesale on re-normalize, clobbering hand-tuned
  anchors. Re-extract must **preserve manual anchors and fill only gaps** (mirror the
  existing fixture-normalizer "preserve row-normalized, fill gaps" pattern, commit f65a92b),
  or anchors move to an override block too. Phase 1 cannot ship without this.
- **A7 [P1] — navigator scaling needs the 5-sheet contract lifted (Codex #10).** Sheet ids
  are hardcoded in `types.ts:187`, `runtimeConfig.ts:17`, `admin/app.js:386`, normalizers,
  engine. The grouped navigator UI is built to scale, but "many moves" is a **separate
  engine workstream** (lift `SpriteSheetId` from a 5-member union), not gym UI. `[+ Move]`
  shows the honest "staged — engine supports 5 sheets today" note until then.
- **A8 [P2] — collision depth (Codex #7/#8).** Phase 2 hitbox editing must handle multiple
  hitbox ids, actor routing, synthesized `hitbox_end`, and keyframe-by-activation-age;
  hurtbox editing must account for `modify_hurtbox` events + multi-actor. Per-phase band /
  per-state are the fallback layer, not the whole model.
- **CUT — visual-trim override (Codex #9).** `SpriteFrameMeta` has no runtime consumer for
  a trim box; dropping it. BOUNDS "Visual" mode is read-only display of intrinsic w/h.
- **C1 — renderer needs a coordinate adapter (Codex #6).** Frame-pixel boxes → world units
  (× scale) → Phaser origin. The shared renderer takes plain frame-pixel descriptors;
  the adapter is explicit, not implied by "drag gizmos."

Defaults (no question): desktop-only ≥1100px guard (§10); explicit Save + dirty + nav-guard (§11).

---

## 14. Implementation Tasks

Phased per D3. Phase 1 ships the usable anchor gym; Phase 2 is the collision
contract migration. Run with Claude Code or Codex; checkbox as you ship.

### Phase 1 — Anchor gym (first usable tool)

- [ ] **T1 (P1, human: ~3h / CC: ~30min)** — Vite gym route (D4) — new Vite/TS entry
  (`src/gym/`, sibling to `src/testbed/`) + `gym.html`; admin links to it with `?id=`.
  Three-pane + timeline shell.
  - Surfaced by: §4, Codex #5. Files: `src/gym/`, `gym.html`, `vite.config.ts`, `admin/app.js` (link).
  - Verify: gym route loads a fighter via `?id=` against `cms:admin`.
- [ ] **T2 (P1, human: ~4h / CC: ~40min)** — overlay renderer + coordinate adapter (C1) —
  extract the box/anchor draw primitives from TestbedScene into a renderer that takes
  **frame-pixel box descriptors**; adapter maps frame-px → world units → Phaser origin.
  - Surfaced by: §2/§6, Codex #6. Files: `src/gym/`, `src/testbed/TestbedScene.ts`.
  - Verify: renders editable boxes from plain descriptors, not a Fighter.
- [ ] **T3 (P1, human: ~3h / CC: ~30min)** — anchor gizmo + timeline — draggable anchor,
  CENTER X/Y inputs, filmstrip + transport + onion-skin (±2 frames).
  - Surfaced by: §4/§6. Verify: drag/type updates live; feet stay planted under onion-skin.
- [ ] **T4 (P1, human: ~3h / CC: ~30min)** — anchor persistence + box recompute (A1) —
  write `frameData` anchors via `save_gym_edits`; shift stored `hurtbox`/`attackBox` by
  `Δanchor` on every anchor write; cache-bust refresh; dirty + nav guard.
  - Surfaced by: §11, A1. Files: `src/gym/`, new `save_gym_edits` tool, `createCmsTools.js`.
  - Verify: edit anchor → Save → reload persists; derived boxes consistent (unit test).
- [ ] **T5 (P1, human: ~4h / CC: ~45min)** — anchor survival on re-extraction (A6) —
  `extract_row_frames`/`CharacterCreationPipeline` preserves manual anchors, fills only
  gaps (mirror commit f65a92b pattern).
  - Surfaced by: A6, Codex #2. Files: `cms/pipeline/CharacterCreationPipeline.js`, `scripts/extract_row_frames.py`.
  - Verify: hand-tune anchor → re-normalize move → anchor survives (test).
- [ ] **T6 (P1, human: ~2h / CC: ~20min)** — move navigator — grouped/searchable tree,
  status dots, honest `[+ Move]` staged note (A7).
  - Surfaced by: §5/A7. Verify: groups collapse, search filters, dots reflect state.
- [ ] **T7 (P1, human: ~2h / CC: ~20min)** — frame selection (D1) — reorder/role-map/skip
  + extractor-warning surfacing; recompute `visualTimeline` implications (Codex #11).
  - Surfaced by: §1/§3. Verify: reorder persists; warnings shown; visualTimeline stays valid.
- [ ] **T8 (P1, human: ~2h / CC: ~20min)** — collision overlays READ-ONLY — render
  measured hurt/hitboxes for inspection (no editing in Phase 1).
  - Surfaced by: §6, D3. Verify: overlays match runtime convert output.
- [ ] **T9 (P1, human: ~2h / CC: ~20min)** — a11y + Phase-1 tests — keyboard map, canvas
  live region, ≥1100px guard; unit test for `Δanchor` box recompute + anchor-survival.
  - Surfaced by: §10/§3. Verify: full keyboard op; narrow viewport guard; tests green.

### Phase 2 — Collision migration

- [x] **T10 (P1) — override layer (D2)** — DONE. `draft.overrides.{hurtboxes,hitboxes}`
  applied in `convertDraftToCharacterConfig` *after* the measured passes (override wins);
  hitbox override is a static box that clears `keyframes` (A4). **Overrides are stored
  frame-px, anchor-relative** (same space as measured `hurtbox`/`attackBox`); convert
  applies `× scale` — scale-robust, no unit conversion at the gym↔draft boundary. T11/T12
  must author overrides in this space.
  - Files: `cms/export/convertDraftToCharacterConfig.js`.
  - Verified: `npm run cms:export:smoke` (§9 — hurtbox/hitbox override wins, keyframes
    cleared, non-overridden states untouched, override survives a fresh frameData).
- [x] **T11 (P1) — collision inspector** — DONE. Per-state hurtbox + per-activation hitbox
  editing in `src/gym/` (`main.ts`, `GymScene.ts`, `loadGymData.ts`). Inspector switches by
  BOUNDS mode (§6 asymmetry): Hurtbox = per-`FighterState` dropdown, canvas jumps to the
  state's base frame; Hitbox = per move+id activation dropdown, geometry override (static,
  clears keyframes) + authored numbers (damage/hitstun/blockstun/knockback/level). Editable
  box has a Move/Scale gizmo (Q/W) in frame-px anchor-relative space (the override space);
  MEASURED/OVERRIDDEN badge driven by key existence; Override seeds from measured, Reset
  unsets. Multi-id handled (per-id activations); per-activation static-box is the A8 fallback
  layer (per-keyframe-age / `modify_hurtbox` authoring remain measured-pass-derived).
  - Files: `src/gym/main.ts`, `src/gym/GymScene.ts`, `src/gym/loadGymData.ts`, `gym.html`.
  - Verified: `tsc` + `vite build` clean; persistence covered by `cms:gym:smoke`.
- [x] **T12 (P1) — `save_gym_edits` set/unset + partial-failure** — DONE. Two-store write
  (frameData→asset store, overrides+numbers→draft), ordered frameData first, per-half
  `{frameData, draft}` result. `overrides` replaces `draft.overrides` wholesale (unset =
  key absent, which deepMerge can't do); `hitboxNumbers` patches matching `hitbox_active`
  events in place (no moves-array clobber, preserves knockback shape). Errors are returned,
  not thrown, so a partial failure keeps the unsaved half dirty in the gym.
  - Files: `cms/tools/createCmsTools.js`. Verified: `npm run cms:gym:smoke` (12 tests).
- [x] **T13 (P1) — contract tests** — DONE. `scripts/smoke_cms_gym_save.mjs` (round-trip:
  gym edit → tool → FileCmsStorage → reload → convert reflects it; set/unset; in-place
  number patch; partial-failure). `smoke_cms_export.mjs` §10 (ship path carries tuned
  anchors + overrides). QA-adapter needs no change: overrides live on the draft, not the
  pack QA validates; the extra `anchorEdited` flag on frameData is inert to anchor-stability QA.
  - Verified: `npm run cms:export:smoke` (52) + `npm run cms:gym:smoke` (12).
- [x] **T14 (P1) — publish path (A5)** — DONE. The admin Publish action now also runs
  `export_character_config` after `publish_character`, shipping the converted config (gym
  overrides folded in by convert) + the copied tuned frameData to `public/fighters/<id>/`.
  No separate A1 recompute at publish: the gym bakes the Δanchor box shift into frameData at
  save time, so stored frameData is already consistent (asserted in export smoke §10).
  - Files: `admin/app.js`. Verified: `smoke_cms_export.mjs` §10.

### Phase 3 — collision-model gaps (from the reference "character gym")

Surfaced by a reference walkthrough (2026-06-14): the reference gym authors a **guard box**
and a **collision/ground box** that our model lacks. Our engine fakes high/low blocking via
`hitbox.level` + crouch state (`HitResolver.isBlocking`, `HitResolver.ts:117-119`); there is
no authored guard geometry and no character pushbox.

- [x] **T17 (P2) — guard box** — DONE. Per-state guard bounds resolve high/low guard by
  geometry. OVERRIDE-ONLY (no measured/default pass), so existing fighters with no guardbox
  keep byte-for-byte legacy blocking. `guardboxes?` on `CharacterConfig` (`types.ts`);
  `applyGuardboxOverrides` in convert (frame-px → `× scale`); `HitResolver.isBlocking` enters
  the guard branch only when `defender.getGuardboxWorld()` is non-null and requires the
  attacker hitbox world AABB to overlap (pure `guardCovers` helper); a Guard BOUNDS mode in
  the gym (`overrides.guardboxes`, NONE/OVERRIDDEN badge). Verified: `engine:guard:smoke` (18,
  real `guardCovers`/`isBlocking` via tsx incl. backward-compat), `cms:export:smoke`,
  `cms:gym:smoke`.
- [x] **T18 — pushbox / ground-collision box — SKIPPED (user decision 2026-06-14).** The
  reference gym's "collision/ground box" is ground planting, already handled by the feet
  anchor + floor line. A true char-vs-char pushbox is a separate combat-feel change the video
  doesn't describe; deferred until explicitly wanted. No fighters collide today.
- [x] **T19 (P3) — hit `level` visualization** — DONE. `GymScene.setHitLevel` draws a faint
  high/mid/low band in Hitbox mode, driven from the activation's `level`.

### Phase 4 — Animation-row generation module (NEW, requested 2026-06-14)

Goal (user): a **full-featured generation module** that adds move rows / gen items beyond the
5 sheets, with unit tests and a `/codex` review. Scope:

1. **New animation rows / gen items:** `jump`, `crouch`, `dash_forward`, `dash_back`,
   `block`, `grab`, `throw` — each generated as its own sheet/row like the existing 5.
2. **Combos as sequential animations:** a combo of N moves is generated **sequentially** so
   move K+1's start pose overlaps move K's end pose (pose continuity across the chain).
3. **Projectile specials generate the projectile too:** a special with a projectile generates
   the projectile sprite/entity and exposes it for editing **like any other move** (lifts the
   §12 "projectile authoring out of scope" cut).
4. **Block/grab/throw rows** wired to the existing engine states (`blockstun`, grab/throw
   events already exist in `convertEvent`).

**HARD PREREQUISITE — T16 (lift the 5-sheet `SpriteSheetId` contract).** `SpriteSheetId` is a
5-member union hardcoded in `src/schema/types.ts`, `src/testbed/runtimeConfig.ts`,
`admin/app.js`, the normalizers, and the engine (A7). Every new row depends on making the
sheet/animation set **data-driven** (a registry), not a fixed union. This is the first task of
Phase 4, and it is a cross-cutting engine change — do it on its own, behind tests, before any
row-generation work.

- [x] **T20 (P1) — animation-row registry (lifts T16). DONE.** Replaced the `SpriteSheetId`
  union with a data-driven row registry in `shared/animationRows.js` (id, label, group,
  frameCount, role, moveAnimation) + a `.d.ts` sidecar so the Vite/TS engine, Node CMS, and
  scripts all read ONE copy with no build step. `SpriteSheetId` kept as `type = string` so the
  ~40 `as SpriteSheetId` casts go inert (minimal diff). Derived from the registry: `SHEET_IDS`
  (runtimeConfig, loadGymData), `MOVE_SHEETS` (Fighter), gym `SHEET_GROUPS`/`SHEET_LABELS`.
  `stamptownFighters.uniformFrameMeta` keeps its literal 5 (it's the fixture's actual row data,
  not the contract). `admin/app.js` is a browser file behind a static server (can't import the
  module) — keeps its `MOVE_IDS`/`MOVE_ORDER` literals guarded by `scripts/smoke_animation_rows.mjs`
  (`npm run rows:smoke`); wired to a registry endpoint in T21. Verified: rows:smoke, `tsc`,
  `npm run build`, cms:pipeline:smoke, engine:guard:smoke (18/18), cms:row:smoke, cms:gym:smoke
  (15/15) — all green, no behavioral delta to existing fighters.
- [x] **T21 (P1) — new row gen items + engine playback. DONE** (user chose to include engine
  playback). Added `jump`/`crouch`/`dash_forward`/`dash_back`/`block`/`grab`/`throw` to the
  registry (Movement/Defense/Grapple groups — navigator auto-groups via `sheetGroups()`).
  **Engine playback** (`src/core/animationRowPlayback.ts`, pure/Phaser-free): `STATE_ROW_MAP`
  plays jump (airborne/jump_startup), crouch (crouch/crouch_transition), block (blockstun) —
  but ONLY when the fighter owns the row (`frameCounts[row]>0`), else falls back to base
  byte-for-byte. `stateRowFrame` is one-shot-hold-last. grab/throw are `moveAnimation:true`
  (in `MOVE_SHEETS`, latent until a move references them). **dash_forward/dash_back have no
  `FighterState` and cannot play yet — generatable/authorable only (gap: needs a
  movement-system change with input + physics; future task).** **Prompt profiles**
  (`cms/pipeline/rowPromptProfiles.js`): per-row description + frame roles read by both image
  adapters; frame roles agree with the engine's hold-last convention (state rows end on the
  held pose). CMS tool descriptions + admin source-sheet regexes (`:846`/`:1716`) now derive
  from the registry; `:1899` projectile fallback left for T23. Tests: `engine:rows:smoke`
  (12, pins the fallback invariant), `rows:smoke` (profile drift guard + grab/throw-in-MOVE_SHEETS),
  `cms:row:smoke` (generates+extracts a `block` row end-to-end). Visual-polish follow-ups
  (jump arc, crouch-squash interaction with the 0.58 body scale) deferred — no test gates
  whether a row *looks* good. Pre-existing unrelated failure noted: `cms:openai:image:smoke`
  (`fighter-5x6-sheet` branch absent from the adapter; fails identically without T21 edits).
- [ ] **T22 (P1) — sequential combo generation.** A combo descriptor (ordered move ids); the
  generator produces each segment conditioned on the previous segment's end frame so poses
  overlap. Persist combo metadata on the draft; convert chains them. Unit-test the chaining +
  pose-continuity contract.
- [ ] **T23 (P1) — projectile generation + editor.** Projectile specials generate the
  projectile sprite + a projectile entity on the draft; a projectile editor in the gym edits
  it like a move (geometry, lifetime, velocity, hitbox numbers). Convert already emits
  `spawn_projectile`; extend it to consume authored projectile entities. Unit-test.
- [ ] **T24 (P1) — module tests + `/codex` review.** Full smoke coverage for T20–T23; run
  `/codex review` and fold findings.

Sequencing: T20 first (unblocks all), then T21/T23 in parallel, T22 after T21, T24 last.

### Deferred (P3)
- [ ] **T15 (P3)** — re-segmentation from the gym (adjust grid, re-run extractor).
- [ ] **T16 — SUPERSEDED by T20** (lifting `SpriteSheetId` is now Phase 4's first task).

---

## Approved Mockups

| Screen | Mockup Path | Direction | Notes |
|--------|-------------|-----------|-------|
| Character Gym | ~/.gstack/projects/DavidMendelovits-thousand_fighters/designs/character-gym-20260613/variant-B.png | 3-pane pro-tool (frame browser / canvas / inspector) | Base shell |
| Character Gym | ~/.gstack/projects/DavidMendelovits-thousand_fighters/designs/character-gym-20260613/variant-C.png | bottom timeline + onion-skin | Graft timeline onto B |
| Character Gym | ~/.gstack/projects/DavidMendelovits-thousand_fighters/designs/character-gym-20260613/variant-A.png | reference-faithful single rail | Reference parity |

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | issues_found | 14 findings, 6 folded as P1 |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 13 issues, 1 critical gap |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | issues_open | score: 5/10 → 9/10, 3 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

Eng review (Architecture 5 · Code-quality 2 · Tests 8-gap diagram · Perf 0) reversed the
design review's D3: build is now **phased** (Phase 1 anchor gym, Phase 2 collision
migration), canvas runs as a **Vite/TS route** (D4). Critical gap folded as mandatory:
anchor edits silently corrupt anchor-relative collision boxes (A1) and don't survive
re-extraction (A6) — both fixed in Phase 1. `save_gym_edits` tool replaces the deepMerge
path (A2/A3). Visual-trim cut (no runtime consumer). Coverage starts 0/8 — override layer
+ Δanchor recompute get unit tests; contract/runtime-config smoke added.

- **CODEX:** 14 findings; 6 new P1s folded (anchor re-extraction survival, admin build gap,
  navigator-needs-contract-lift, trim cut, collision depth, contract tests). Confirmed A2/A3
  (atomicity, deepMerge trap).
- **CROSS-MODEL:** Codex + design advisor both recommended phasing D3; user accepted the
  reversal. Both independently flagged the two-store atomicity gap.
- **VERDICT:** DESIGN + ENG + CODEX CLEARED — ready to implement Phase 1. "issues_open"
  reflects findings folded into the phased plan (T1–T16), 0 unresolved decisions.

NO UNRESOLVED DECISIONS
