# Character Creation Workflow

This is the canonical, explicit workflow for turning a character idea, reference
image, or generated sheet into a playable Thousand Fighters character.

Related docs:

- `docs/STYLE.md`: engine-level fighter art contract.
- `docs/PIPELINE.md`: sprite-sprint handoff contract for raw 5x6 sheets.
- `docs/sprite-generation-memory.md`: historical sprite-generation notes and
  character-specific cleanup lessons.
- `docs/FIGHTER_PACK_QA_PLAN.md`: validation plan and known failure modes.
- `docs/CMS_PIPELINE_ARCHITECTURE.md`: pluggable CMS/admin architecture.

## Short Version

```text
brief/reference image
  -> character draft
  -> concept/source sprite prompt
  -> 5x6 source sheet
  -> contour normalization
  -> fighter pack assets
  -> QA
  -> runtime config
  -> playable roster entry
  -> browser validation
```

The target authoring path is the CMS/admin platform. The older direct-runtime
path still exists and is useful for debugging, but new work should move through
CMS storage and pipeline tools whenever possible.

## Source Inputs

A new character starts from one or more of these:

- A text brief: identity, silhouette, costume, prop, fighting style, signature
  gag, and expected projectiles.
- A reference image uploaded to the CMS.
- A raw generated 5x6 sprite sheet.
- A hand-edited fighter pack.

The workflow should always produce the same game-ready contract regardless of
input source.

## Required Fighter Pack Shape

Every fighter pack should contain:

```text
public/fighters/<character_id>/
  description.txt
  moveset.txt
  manifest.json
  frameData.json
  normalization-report.json
  source/
    <character_id>_imagegen_sheet.png
    <character_id>_clean.png
  sheets/
    base.png
    punch.png
    kick.png
    special_1.png
    special_2.png
  sprites/
    base/base_001.png ...
    punch/punch_001.png ...
    kick/kick_001.png ...
    special_1/special_1_001.png ...
    special_2/special_2_001.png ...
  projectiles/
    <projectile_id>.png
```

In the CMS, the same files live under:

```text
characters/<character_id>/assets/fighter-pack/
```

`frameData.json` is the runtime source of truth for frame files, dimensions, and
anchors. Preview sheets are convenient review artifacts; the Phaser runtime loads
individual frame PNGs.

## Step By Step

### 1. Pick the stable character id

Choose a lowercase, URL-safe id such as `janitor`, `viggo`, or
`new_fighter_name`. This id becomes the CMS key, public asset folder, runtime
character id, sprite texture prefix, and query-param value.

### 2. Write the character brief

Capture:

- Display name.
- Visual identity and readable silhouette.
- Art style.
- Prop, weapon, or signature object.
- One punch concept.
- One kick concept.
- One close/movement special.
- One projectile/cast special.
- Projectile id and what frame should release it.

Keep the brief specific. The image model needs to know what must stay visible,
what can become a separate projectile, and what cannot be cropped.

### 3. Create the CMS draft

Use the admin dashboard, `POST /api/tools/create_character_draft`, or the local
Codex CMS module. The draft is stored through `CharacterContentRepository` and
contains display copy, stats, sprite expectations, move definitions, generation
metadata, and later asset references.

Relevant tool:

```text
create_character_draft({ characterId, brief })
```

The text model behind this can be local deterministic output, OpenAI Responses,
or a future provider. The pipeline only calls the `textModel` port.

### 4. Generate or upload concept/source art

If starting from an image, upload it as a character asset and optionally call:

```text
describe_character_image({ characterId, imageBase64, contentType })
```

Then generate concept art or go straight to a source sprite sheet:

```text
generate_character_concept({ characterId, prompt })
generate_sprite_sheet({ characterId, prompt })
```

The source sheet prompt should request:

- 5 rows by 6 columns.
- Rows in this exact order: `base`, `punch`, `kick`, `special_1`, `special_2`.
- Full-body poses facing the same direction.
- Generous transparent or magenta gutters.
- No text, borders, UI, shadows, or scene background.
- Projectile/VFX shown in the intended release slot, not repeated forever.

The generated source asset is stored under:

```text
characters/<character_id>/assets/source/<character_id>_imagegen_sheet.png
```

or, for the legacy runtime path:

```text
public/fighters/<character_id>/source/<character_id>_imagegen_sheet.png
```

### 5. Normalize the source sheet

Never ship raw grid crops. Raw AI sheets commonly have fake checkerboards,
colored outlines, bad alpha, cross-cell bleed, and detached projectile pieces.

Run the normalizer through the CMS pipeline:

```text
normalize_sprite_pack({
  characterId,
  sourceAssetKey,
  projectileId,
  projectileIndex,
  special2Indices
})
```

The real local normalizer adapter wraps:

```bash
python3 scripts/normalize_fighter_sheet_contours.py \
  public/fighters/<character_id>/source/<character_id>_imagegen_sheet.png \
  public/fighters/<character_id> \
  --character-id <character_id> \
  --projectile-id <projectile_id> \
  --projectile-index <0-based projectile slot> \
  --description <path-to-description.txt> \
  --moveset <path-to-moveset.txt>
```

What normalization does:

- Converts magenta or light checker backgrounds into alpha.
- Uses connected components over the whole cleaned sheet.
- Assigns components to the intended 5x6 slots by component center.
- Keeps the dominant actor component for runtime character frames.
- Removes visible neighboring fragments from character frames.
- Extracts detached projectile/VFX art separately into `projectiles/`.
- Exports variable-size transparent PNGs with padding.
- Writes per-frame anchors into `frameData.json`.
- Rebuilds preview sheets.
- Writes `manifest.json` and `normalization-report.json`.

### 6. Check that sprites are clean and not cut off

The minimum cleanup gate is:

- `normalization-report.json` exists.
- `normalization-report.json.warnings` is empty.
- No non-transparent pixel touches any exported frame edge.
- Every frame has real transparent margin, not merely zero edge contact.
- The full head, hands, feet, props, weapons, and VFX are visible.
- Projectiles are not accidentally erased by background removal.
- Projectiles are not still baked into caster recovery frames after spawn.
- Neighboring shoes, hands, props, splash fragments, and outlines are gone.

The reason we use contour normalization instead of raw cell cropping is exactly
this: a rectangle crop can include fragments from adjacent poses, while contour
selection can keep the actor and discard unrelated foreground pieces.

### 7. Validate the fighter pack

Run the QA port:

```text
validate_fighter_pack({ characterId, normalizedKey })
```

Current QA checks include manifest presence, `frameData.json`, sprite files,
sheet files, frame count consistency, frame metadata dimensions, anchor stability,
normalization report status, projectile assets, and minimum frame counts.

The broader QA plan also calls for visual/runtime checks for:

- Colored source-sheet outlines left by background removal.
- Valid sprite colors accidentally removed.
- Cropped heads, feet, props, weapons, and projectiles.
- Animation rows assigned to the wrong moves.
- Projectile handoff mistakes.
- Runtime config and asset drift.

### 8. Review animations by move set

Group assets by move-set row:

- `base`: idle, guard, crouch, airborne, hit/utility, stance variant.
- `punch`: startup, active, impact/extension, recovery, utility, return.
- `kick`: startup, active, impact/extension, recovery, utility, return.
- `special_1`: character-specific close or movement special.
- `special_2`: projectile/cast or special action.

For each row, review:

- Individual frames in `sprites/<sheet>/`.
- The rebuilt sheet in `sheets/<sheet>.png`.
- The animation playback.
- The moves using that animation.
- The move phases, hitboxes, events, cancels, and stats.

Six-frame generated fighters should use `visualTimeline` so gameplay phase timing
and visual pose timing line up. Do not blindly distribute the six frames evenly
over every move.

### 9. Export or wire runtime config

The CMS export path is:

```bash
npm run cms:export -- <character_id>
```

or the tool:

```text
export_character_config({ characterId, copyAssets: true })
```

This writes:

```text
public/fighters/<character_id>/config.json
```

and can copy `sheets/`, `sprites/`, and `projectiles/` into
`public/fighters/<character_id>/`.

The older manual path is to edit `src/characters/stamptownFighters.ts` directly:

- Add frame metadata from `frameData.json`.
- Set `sprite.basePath` to `/fighters/<character_id>`.
- Set `sprite.frameCounts`.
- Set `sprite.frames`.
- Set `sprite.stateFrames` for generated base rows.
- Set `sprite.scale`.
- Add per-character hurtboxes.
- Add moves with correct `animation` row ids.
- Add `visualTimeline` where needed.
- Add the config to `playableCharacters`.

### 10. Wire projectiles

Anything that leaves the body belongs in `projectiles/` and should be spawned by
a move event, not left baked into later caster frames.

Runtime work:

- Add projectile image preload in `src/scenes/FightScene.ts`.
- Reference that projectile key in the move event.
- Tune projectile hitbox, velocity, lifetime, damage, and spawn offset.
- Verify that the caster frame and spawned projectile do not duplicate the same
  visual after release.

### 11. Build and test

Run:

```bash
npm run build
```

For CMS/pipeline work, also run the relevant smoke tests:

```bash
npm run cms:pipeline:smoke
npm run cms:normalizer:smoke
npm run cms:qa:smoke
npm run cms:export:smoke
npm run cms:e2e
```

### 12. Browser QA in the real game

Start the game:

```bash
npm run dev
```

Then check:

```text
/?debug=sprites&character=<character_id>&v=<qa_run_id>
/?p1=<character_id>&p2=mic_monarch&cpu=off&v=<qa_run_id>
/?p1=<character_id>&p2=mic_monarch&cpu=off&player=1&move=fireball&v=<qa_run_id>
```

What to verify:

- Every sprite frame loads.
- Anchor crosshairs sit on the feet/pivot.
- No frame is clipped.
- The character does not slide from frame to frame.
- The selected move uses the intended animation row.
- Hitboxes line up with the visible attack.
- Projectile moves spawn one projectile at the right time.
- Browser cache is busted with `?v=<qa_run_id>`.

## How The Game Loads The Result

The live Phaser game currently loads built-in characters from
`src/characters/stamptownFighters.ts`.

During `FightScene.preload`, it iterates each character's `sprite.frameCounts` and
loads individual PNGs from:

```text
<sprite.basePath>/<frameData.frames[sheet][index].file>
```

or the fallback:

```text
<sprite.basePath>/sprites/<sheet>/<sheet>_<frame>.png
```

That means the playable runtime needs the public fighter files plus a
`CharacterConfig` that correctly points to them. CMS storage alone does not make a
character playable until it is exported or otherwise loaded into the runtime
roster.

## Current CMS Tool Flow

The admin dashboard and chat agent use the same tool registry:

```text
list_characters
get_character_draft
get_character_assets
create_character_draft
update_character_draft
generate_character_concept
describe_character_image
generate_sprite_sheet
add_character_asset
normalize_sprite_pack
validate_fighter_pack
publish_character
export_character_config
get_pipeline_status
```

Each tool calls the API/pipeline. The pipeline calls ports. Provider-specific
work lives in adapters. That is the replacement boundary for OpenAI, Anthropic,
Runway, R2, Supabase, local scripts, or queue-backed workers.

## Current Gaps To Keep In Mind

- CMS-created characters still need a reliable runtime roster loading path, not
  just export files.
- Large production uploads should eventually use signed direct uploads instead
  of proxying every byte through the admin server.
- Semantic image QA for "this row is really a punch/kick/special" is still mostly
  a human review step.
- The game has explicit projectile preloads today, so new projectile ids still
  need runtime wiring unless that loader is generalized.
- Auth, permissions, and audit trail are still needed before treating the admin
  as a production content system.
