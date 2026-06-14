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
- [ ] **T11 (P1, human: ~4h / CC: ~45min)** — collision inspector — per-state hurtbox +
  per-phase hitbox editing, MEASURED/OVERRIDDEN badges, reset-to-measured (unset via
  `save_gym_edits`). Handle multi-id/actor/synthesized-end/keyframe-by-age + `modify_hurtbox` (A8).
  - Surfaced by: §6/A8, Codex #7/#8. Verify: state/phase selectors edit correct entries.
- [ ] **T12 (P1, human: ~3h / CC: ~30min)** — `save_gym_edits` set/unset + partial-failure
  (A2/A3) — atomic-ish two-store write, ordered frameData→draft, per-half result.
  - Surfaced by: §11, A2/A3, Codex #3/#4/#12. Files: `createCmsTools.js`, `createCmsServer.js`.
  - Verify: single-field edit doesn't clobber moves array; delete-override works; partial-fail reported.
- [ ] **T13 (P1, human: ~3h / CC: ~30min)** — contract tests (Codex #13) — export smoke,
  runtime-config matches saved draft+frameData+published assets, QA-adapter update.
  - Surfaced by: §3, Codex #13. Verify: `npm run cms:pipeline:smoke` + new runtime-config test green.
- [ ] **T14 (P1, human: ~2h / CC: ~20min)** — publish path (A5) — `publish_character`
  carries anchors+overrides into `public/fighters/<id>/`; A1 recompute runs pre-publish.
  - Surfaced by: §11/A5. Verify: publish → public frameData has tuned anchors + overrides.

### Deferred (P3)
- [ ] **T15 (P3)** — re-segmentation from the gym (adjust grid, re-run extractor).
- [ ] **T16 (P3)** — lift `SpriteSheetId` from a 5-member union (engine workstream that
  makes the navigator's "many moves" real — A7).

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
