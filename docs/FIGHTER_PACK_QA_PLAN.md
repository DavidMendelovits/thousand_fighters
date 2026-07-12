# Fighter Pack QA Plan

The current sprite workflow is strong enough to make fighters, but not yet strong
enough to reject bad fighter packs automatically. This plan defines a validation
harness for the image-to-playable-character pipeline.

The target tool:

```bash
python3 scripts/validate_fighter_pack.py public/fighters/<character_id>
```

The target output:

```text
public/fighters/<character_id>/qa/
  report.json
  report.html
  contact-sheet.png
  alpha-mask-sheet.png
  edge-risk-sheet.png
  runtime-sprite-debug.png
  runtime-move-*.png
  overlays/
```

`report.json` is the machine-readable pass/fail artifact. `report.html` is the
human review artifact. The HTML report should make failures obvious without
requiring a developer to open twenty PNGs by hand.

## Goals

Catch the problems that currently slip through:

- Background removal leaves colored outlines from the source sheet.
- Background removal removes valid sprite colors, especially in projectiles.
- Frames still ship with cropped heads, feet, weapons, props, or VFX.
- Frames are assigned to the wrong animation row or move.
- Projectiles remain baked into caster frames after the projectile spawns.
- Frame metadata, manifest paths, TypeScript config, and runtime assets drift.
- Browser cache masks asset changes during manual review.

## Validation Layers

### 1. Source Sheet Contract

Validate the raw source sheet before normalization.

Inputs:

- `source/<character_id>_imagegen_sheet.png`
- `description.txt`
- `moveset.txt`

Checks:

- Source image exists and can be divided into 5 rows by 6 columns.
- Every expected slot has at least one meaningful foreground component.
- The largest component in each slot has a minimum source-cell margin.
- No foreground pixels touch the source image edge.
- Main component centers are plausible within their assigned slots.
- Character scale is roughly consistent across rows.
- Special/projectile slots contain the expected projectile or VFX slot.

Failure examples:

- A hat or guitar is already cropped in the raw image.
- A kick pose extends into the neighboring cell.
- A full-body pose is missing from a slot.

Important: if source art is already cropped, normalization cannot truly repair
it. The validator should mark this as a source regeneration problem, not a
postprocessing problem.

### 2. Background Removal QA

Validate `source/<character_id>_clean.png` after chroma/checker cleanup.

Checks:

- No saturated magenta/checker pixels remain near alpha edges.
- No large low-alpha colored halo surrounds the silhouette.
- No suspicious transparent holes appear inside the main actor silhouette.
- Foreground color histogram is not dramatically changed from raw to clean.
- Light costume pixels are preserved when the raw sheet used a magenta key.
- Projectiles retain saturated colors instead of being mistaken for background.

Suggested metrics:

- `haloPixelCount`: colored pixels within N pixels of transparent background.
- `internalHoleCount`: alpha islands inside the main component bbox.
- `foregroundColorLossRatio`: foreground pixels lost during cleanup.
- `projectileColorLossRatio`: projectile slot pixels lost during cleanup.

Pass gate:

- No visible chroma/checker halo.
- No obvious sprite-color removal.
- No projectile with missing core color or punched-out interior.

### 3. Frame Extraction QA

Validate every exported runtime frame in `sprites/<sheet>/*.png`.

Checks:

- No non-transparent pixel touches the output frame edge.
- Minimum transparent margin is at least 8 px on every side.
- Alpha bbox is not suspiciously close to frame bounds.
- Runtime frame contains one dominant actor component.
- Detached components are either tiny antialias fragments or explicitly allowed.
- Adjacent frames in a row do not have implausible bbox jumps.
- Feet/pivot anchor is stable across idle, guard, recovery, and return frames.
- Frame dimensions and anchors match `frameData.json`.

Existing normalization only detects edge-touch. The validator should use margin
distance, because a sprite that is 1 px from the edge is not meaningfully safe.

Suggested metrics:

- `edgeTouch`: current boolean edge test.
- `minTransparentMargin`: minimum distance from alpha bbox to image edge.
- `componentCount`: connected foreground components above threshold.
- `dominantComponentRatio`: dominant pixels / all foreground pixels.
- `anchorDeltaFromRowMedian`: anchor stability by row.
- `bboxJumpFromPrevious`: size/position jump between neighboring frames.

Pass gate:

- `edgeTouch == false`.
- `minTransparentMargin >= 8`.
- No unexplained detached foreground components.
- No anchor jitter that makes the character visibly slide.

### 4. Projectile And VFX Handoff QA

Validate projectile separation.

Inputs:

- `projectiles/*.png`
- `moveset.txt`
- `src/characters/stamptownFighters.ts`
- move definitions with `spawn_projectile` events

Checks:

- Every projectile referenced in TypeScript has a matching PNG preload.
- Every projectile PNG has foreground pixels and reasonable dimensions.
- Projectile frames are not accidentally blank after background cleanup.
- Caster recovery frames do not retain projectile-only art after spawn.
- Projectile visual appears once at runtime, not both baked and spawned.
- Projectile hitbox dimensions are plausible for the visual asset.

Pass gate:

- The projectile appears as an independent runtime object.
- The caster frame shows only casting/recovery after the spawn frame.

### 5. Semantic Move QA

Validate that animation rows match the game contract.

Expected row semantics:

| Sheet       | Expected content                                      |
|-------------|--------------------------------------------------------|
| `base`      | idle, guard, crouch, airborne, hurt/utility, variant   |
| `punch`     | punch startup, active, impact/extension, recovery      |
| `kick`      | kick startup, active, impact/extension, recovery       |
| `special_1` | character-specific special action                      |
| `special_2` | projectile/cast or uppercut action                     |

Checks:

- `frameCounts` has the expected count for each sheet.
- `stateFrames` maps generated base frames correctly.
- Move `animation` values reference existing sheet ids.
- Six-frame generated fighters use six-frame visual timelines.
- Move ids use the current engine convention where possible:
  - `light_punch`
  - `heavy_punch`
  - `crouch_low_kick`
  - `dash_punch`
  - `uppercut`
  - `fireball`
- The signature projectile special is on `fireball` unless intentionally
  overridden.
- `moveset.txt` names/descriptions agree with configured move display names.

Automated image semantics can start heuristic-only:

- Punch rows should show arm-forward silhouettes in at least one active frame.
- Kick rows should show leg-forward or low-leg silhouettes in at least one active
  frame.
- Projectile/cast rows should have a projectile slot or a runtime projectile
  config.

The HTML report should always show rows with expected labels so humans can catch
semantic errors quickly.

### 6. Metadata And Asset Contract QA

Validate all metadata paths and runtime config.

Checks:

- `manifest.json` exists and all listed files exist.
- `frameData.json` exists and all listed frame files exist.
- `frameData.json` dimensions match actual PNG dimensions.
- `normalization-report.json` exists.
- `normalization-report.json.warnings` is empty.
- TypeScript `CharacterConfig.sprite.frames` matches `frameData.json`.
- `basePath`, `frameCounts`, `sheets`, and `frames` are internally consistent.
- Character config is included in `playableCharacters`.
- Required projectile preloads exist in `FightScene.ts`.
- `SPRITE_ASSET_VERSION` or `?v=` cache-busting is available for browser review.

Pass gate:

- No missing paths.
- No stale frame metadata.
- No mismatch between generated assets and runtime config.

### 7. Runtime Browser QA

Validate in the actual Phaser runtime.

Browser targets:

```text
/?debug=sprites&character=<character_id>&v=<qa_run_id>
/?p1=<character_id>&p2=mic_monarch&cpu=off&v=<qa_run_id>
/?p1=<character_id>&p2=mic_monarch&cpu=off&player=1&move=fireball&v=<qa_run_id>
```

Checks:

- Sprite debug screen renders every frame.
- Anchor crosshairs align to feet/pivot.
- No frame appears visually clipped in sprite debug.
- Fight scene loads without missing texture fallbacks.
- Each debug-triggered move displays the intended row.
- Projectile move spawns one projectile entity at the expected timing.
- No duplicate baked projectile remains visible after spawn.

Artifacts:

- `runtime-sprite-debug.png`
- `runtime-fight-idle.png`
- `runtime-move-light_punch.png`
- `runtime-move-heavy_punch.png`
- `runtime-move-crouch_low_kick.png`
- `runtime-move-dash_punch.png`
- `runtime-move-uppercut.png`
- `runtime-move-fireball.png`

## Report Format

`report.json` should be stable enough for CI.

Suggested shape:

```json
{
  "characterId": "viggo",
  "status": "pass",
  "summary": {
    "errors": 0,
    "warnings": 0,
    "framesChecked": 30,
    "projectilesChecked": 1
  },
  "checks": [
    {
      "id": "frame-margin",
      "status": "pass",
      "message": "All frames have at least 8 px transparent margin."
    }
  ],
  "frames": {
    "base/base_001.png": {
      "edgeTouch": false,
      "minTransparentMargin": 24,
      "componentCount": 1,
      "dominantComponentRatio": 1.0
    }
  }
}
```

`report.html` should show, for each row:

```text
raw source slot -> clean alpha -> extracted frame -> alpha mask -> anchor preview
```

Failure overlays should use:

- Red border for edge or margin failure.
- Magenta highlight for leftover background pixels.
- Cyan highlight for transparent holes.
- Yellow crosshair for runtime anchor.
- Orange boxes for detached components.

## Initial Implementation Phases

### Phase 1: Static Asset Validator

Add `scripts/validate_fighter_pack.py`.

Implement:

- Manifest/frameData path validation.
- PNG dimension validation.
- Alpha bbox extraction.
- Edge-touch and 8 px margin checks.
- Connected-component counts.
- `normalization-report.json.warnings` check.
- JSON report.
- Basic contact sheet.

This catches the most common cut-off and stale-metadata failures.

### Phase 2: Background Cleanup Validator

Add:

- Raw-vs-clean histogram comparison.
- Magenta/checker halo detection.
- Internal alpha-hole detection.
- Projectile color-loss checks.
- Alpha-mask and edge-risk sheets.

This targets the known background removal failures.

### Phase 3: Runtime Config Validator

Add TypeScript/config checks.

Implement:

- Character is present in `playableCharacters`.
- `sprite.frames` matches `frameData.json`.
- Move `animation` values reference existing sheet ids.
- Projectile preloads match projectile config names.
- Six-frame generated fighters have visual timelines.

This targets wrong move assignment and runtime drift.

### Phase 4: Browser Screenshot Validator

Use the existing dev server and browser automation to capture:

- Sprite debug screen.
- Idle fight scene.
- One screenshot per debug-triggered move.

The script should not try to be too clever at first. The goal is to make visual
review fast and repeatable.

### Phase 5: CI Gate

Add an npm script:

```json
{
  "scripts": {
    "qa:fighter": "python3 scripts/validate_fighter_pack.py"
  }
}
```

For CI, start with static checks only. Browser screenshot checks can remain a
manual or nightly workflow until they are stable.

## Acceptance Standard

A fighter pack is shippable when:

- `normalization-report.json` has `warnings: []`.
- All frames have at least 8 px transparent margin.
- No raw source slot is visibly source-cropped.
- No chroma/checker halo remains.
- No valid sprite or projectile colors were removed by background cleanup.
- No projectile-only art remains baked into caster recovery frames.
- `frameData.json`, manifest, and TypeScript config agree.
- Sprite debug view renders all frames with stable anchors.
- Each move displays the intended animation row.

If any required check fails, the pack is either regenerated, manually repaired,
or documented as an intentional exception in the report. No mystery meat, no
secret sauce, no "trust me, it looked fine on my machine."
