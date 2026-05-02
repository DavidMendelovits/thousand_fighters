# Sprite Generation Memory

This file is the working memory for producing fighter sprites for the Phaser fighting game. Update it whenever feedback changes the process, visual standard, or engine contract.

## Current Goal

Create game-ready 2D fighter character packs that can be dropped into `public/fighters/<character_id>` and wired into `src/characters/stamptownFighters.ts`.

The output must preserve:

- High-quality pixel-art / 16-bit fighting-game readability.
- Full-body poses with no cropped head, feet, props, weapons, or special effects.
- Variable-size frames when attacks need more room.
- Per-frame anchor metadata so the feet/pivot stay stable in-game.
- Separate projectile/VFX sprites for anything that leaves the character.

## Required Skills

Use these skills together:

- `fighting-game-sprite-generator`: character pack structure, move slots, descriptions, moveset, manifest, sheets.
- `generate2dsprite`: image-generation prompt discipline and sprite postprocessing expectations.
- `normalize-sprite-sheets`: frame extraction, alpha cleanup, edge checking, variable-size frames, anchor metadata.

## Fighter Pack Layout

Each fighter pack lives at:

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

`frameData.json` is the runtime source of truth. Sheets are preview artifacts.

## Frame Counts

Use 6 frames per sheet for current game characters:

- `base`: idle, guard, crouch, airborne, hit/taunt/utility, stance variant.
- `punch`: startup, active, extended/impact, recovery, utility variants.
- `kick`: startup, active, extended/impact, recovery, utility variants.
- `special_1`: character-specific close or movement special.
- `special_2`: projectile/cast special, but projectile-only frames must be exported separately.

## Prompt Pattern

Generate a whole reference sheet first when speed matters:

```text
Create a transparent-background pixel art reference sheet for a 2D fighting game character named <name>, high quality 16-bit arcade fighter sprite style like classic Capcom/SNK.
Character design: <brief from references>.
Full body side-view / 3-quarter fighting stance, consistent proportions, strong readable silhouette, feet aligned to a shared baseline.

Make a 5 row by 6 column sprite sheet, each cell containing one full-body sprite pose with generous transparent padding and no cropping.
Rows: base; punch; kick; special_1; special_2.
Include oversized weapon/special frames where needed, but keep the character full body visible.
No text, no UI, no borders, no shadows, no background scene.
Crisp pixel art, limited palette, transparent background, game-ready readability.
```

Important: image generation may return a fake checkerboard background instead of real alpha. Treat the raw output as source art only.

## Normalization Rules

Do not trust raw grid crops. AI sheets often spill across cell boundaries or include fake checkerboard backgrounds.

Current robust process:

1. Copy the generated source sheet to `source/<character_id>_imagegen_sheet.png`.
2. Remove fake checkerboard / light neutral background into alpha.
3. Detect foreground connected components on the full cleaned sheet.
4. Assign frame components by the intended 6x5 slot, using component centers rather than raw cell crops.
5. For runtime character frames, keep the dominant character component and any connected/nearby weapon component. Remove detached neighbor fragments.
6. For projectile/VFX sprites, export the projectile component separately from the source slot.
7. Export variable-size transparent PNGs with generous padding.
8. Anchor every frame at the logical feet/pivot, measured from top-left.
9. Rebuild preview sheets from exported frames.
10. Write `frameData.json` and `normalization-report.json`.

Current repo script:

```bash
python3 scripts/normalize_fighter_sheet_contours.py \
  public/fighters/_archive/pre_contour_cleanup_YYYYMMDD_HHMMSS/viggo/source/viggo_imagegen_sheet.png \
  public/fighters/viggo \
  --character-id viggo \
  --projectile-id hi_vis_vest \
  --projectile-index 28 \
  --description /tmp/viggo-description.txt \
  --moveset /tmp/viggo-moveset.txt \
  --special2-indices 24,25,26,27,29,29
```

What the script does:

- Converts fake light checkerboard backgrounds into transparency.
- Current contour script also treats saturated magenta (`#FF00FF`-style) as chroma-key transparency for generated sheets that follow the `generate2dsprite` prompt rules.
- Finds connected foreground contours on the whole source sheet.
- Assigns contours to the intended 6x5 source slots by contour center.
- For runtime character frames, keeps only the exact pixels of the dominant contour from the assigned slot. Do not mask by bounding rectangle, because a rectangle can still capture unrelated shoes, hands, mop heads, splash scraps, and other bleed inside the crop.
- For projectile/VFX exports, keeps all contours in the projectile slot so droplets/trails survive.
- Rebuilds `sprites/`, `sheets/`, `frameData.json`, `manifest.json`, and `normalization-report.json`.

Preservation rule: before running destructive normalization, archive the previous pack:

```bash
mkdir -p public/fighters/_archive/pre_contour_cleanup_<timestamp>
cp -R public/fighters/viggo public/fighters/_archive/pre_contour_cleanup_<timestamp>/viggo
cp -R public/fighters/janitor public/fighters/_archive/pre_contour_cleanup_<timestamp>/janitor
```

Best future workflow: generate individual frame PNGs first whenever possible. Full 5x6 sheets are fast, but they increase bleed risk because the image model may place limbs/props across cell boundaries. If using full sheets, ask for much larger gutters between cells and still run contour normalization.

Legacy fixed-frame packs can be cleaned without regenerating art when the source only exists as `sprites/<sheet>/*.png`: archive the pack, copy the old sheets into `source/`, expand 4-frame move rows to 6 runtime frames with anticipation/recovery poses from `base`, trim every frame to alpha bounds, and preserve the old pivot as the new per-frame anchor. Do not keep legacy frames that are already visibly cut off; replace them with readable adjacent poses or regenerate the move.

QC gate:

- `normalization-report.json` must have `warnings: []`.
- No non-transparent pixel may touch an exported frame edge.
- Character runtime frames should contain one dominant connected component. Very tiny components can be tolerated only when they are internal anti-alias fragments, not visible neighbor bleed.
- No projectile-only art should remain baked into caster recovery frames.
- Preview sheets should not show orphan shoes, hands, splash fragments, or neighboring weapon pieces.
- Phaser asset URLs should include a cache-busting version query. Current loader uses `SPRITE_ASSET_VERSION` plus any page `?v=` override so stale browser-cached PNGs do not masquerade as bad normalization.

## Runtime Anchor Contract

The engine renders each frame at:

```text
fighterPosition - frame.anchor
```

Current metadata shape:

```json
{
  "anchorConvention": "frame anchor is the character pivot/feet, in pixels from each PNG top-left",
  "frames": {
    "base": [
      {
        "file": "sprites/base/base_001.png",
        "width": 220,
        "height": 286,
        "anchor": { "x": 110, "y": 248 }
      }
    ]
  }
}
```

Use variable-size frames for large props, swords, mops, mallets, thrown clothing, water splashes, and crosses. Do not shrink the character to fit the largest attack.

## Runtime Animation Timing

Move phases drive gameplay, but visual frame playback should not be evenly distributed over the whole move. Use `Move.visualTimeline` for six-frame generated fighters so key poses can be held deliberately:

- Light attacks snap quickly into contact and spend more time on follow-through/recovery.
- Heavy attacks hold the impact/follow-through frames longer.
- Projectile specials align the release sprite frame with the `spawn_projectile` phase.
- Uppercuts hold the launch/readability frame during active frames and then settle into recovery.

If a fighter only has older four-frame sheets, leave `visualTimeline` off or write a separate four-frame timeline. Do not apply six-frame timing to four-frame sheets.

## Projectile Handoff Rule

If an object leaves the body, it becomes a projectile/VFX entity.

Examples:

- Mr Cardboard's Cardbross Cross: caster frames conjure/release, then the cross projectile owns the big cross visual.
- Viggo's yellow traffic vest: caster frames show the strip-off and re-vest gag, while `hi_vis_vest.png` owns the flying vest.
- Janitor's water wave: caster frames show bucket/mop action, while `bucket_wave.png` owns the traveling splash.

Do not duplicate a spawned projectile in the caster animation after the spawn frame. If the move needs a handoff, end the baked-in special art one frame earlier or replace later frames with recovery/stance frames.

If the projectile contour is connected to the caster hand by spell trails, do not ship the whole contour. Crop or extract the detached VFX region only, then update `normalization-report.json` so the projectile dimensions reflect the handoff asset.

## Engine Wiring Checklist

After creating assets:

1. Add projectile texture preload in `src/scenes/FightScene.ts`.
2. Add projectile debug preview in sprite debug view.
3. Add frame metadata in `src/characters/stamptownFighters.ts` with `makeFrameMeta`.
4. Add a character config with `sprite.frames`, `frameCounts`, `scale`, hurtboxes, and moves.
   - If the generated base row is `idle, guard, crouch, jump, hurt, taunt`, set `sprite.stateFrames` so runtime states do not rely on the engine fallback layout.
   - Current generated layout mapping: `idle: [0,1]`, `crouch: 2`, `airborne/juggle: 3`, `hitstun/knockdown/dead: 4`, `getup/landing: 2`.
5. Use the normal engine move ids:
   - `light_punch`
   - `heavy_punch`
   - `crouch_low_kick`
   - `dash_punch`
   - `uppercut`
   - `fireball`
6. Put the signature projectile special on `fireball` so existing QCF/debug keys work.
7. Add the config to `playableCharacters`.
8. Run `npm run build`.
9. Check in browser:
   - `/?debug=sprites&character=<character_id>`
   - `/?p1=<character_id>&p2=mic_monarch&cpu=off`
   - `/?p1=<character_id>&p2=mic_monarch&cpu=off&player=1&move=fireball`

## Current Character Notes

### Mr Cardboard

- Uses variable-size frames successfully.
- Cardbross Cross is a separate projectile.
- Important feedback: special projectile should look exactly like the sprite source, not a procedural substitute.
- Important feedback: do not show both baked-in cross and projectile cross at the same time.

### Guitar Shredder

- Older imported pack originally used fixed 256x256 frames and four-frame move rows.
- Current cleanup expanded every move sheet to six runtime frames and added `frameData.json` / `normalization-report.json`.
- Legacy `special_1_001` and `special_1_002` are not used at runtime because their heads are cut off in source art.
- Legacy `special_1_004` is treated as projectile/VFX-only timing and not used as caster recovery art.
- Follow-up cleanup also rejects legacy `base_006` because the extended show hand is cropped in source art, and rejects legacy `special_2_002`/`special_2_004` because their spotlight effects are visibly cut by the old cell. Alpha-edge checks still pass for these, so visual source-crop QC is required.
- Current imported fighter id: `guitar_shredder`.

### Viggo

- Visual identity: wiry performer, black shirt/trousers, messy spiky hair, yellow reflective vest.
- Signature special: removes yellow traffic vest, throws it, shows black shirt, then reveals a fresh yellow vest.
- Projectile: `hi_vis_vest`.
- Special animation must avoid duplicate flying vest after projectile spawn.
- Costume continuity rule: Viggo keeps the yellow hi-vis vest on for all melee/base/uppercut animation rows. Only projectile `special_2` may show him taking the vest off, throwing it, and putting/revealing it back on.
- Current imported fighter id: `viggo`.
- Current generated projectile asset: `public/fighters/viggo/projectiles/hi_vis_vest.png`.
- Latest contour normalization report has no edge-touch warnings.
- Previous pre-contour output was archived under `public/fighters/_archive/pre_contour_cleanup_20260501_022251/viggo`.

### Janitor

- Visual identity: bald, gray-bearded, stocky janitor in blue-gray coveralls.
- Weapon: long mop.
- Specials should exploit mop reach and bucket/water gag.
- Projectile: `bucket_wave`.
- Mop swing frames need variable-size canvases because the mop extends far beyond the body.
- Current imported fighter id: `janitor`.
- Current generated projectile asset: `public/fighters/janitor/projectiles/bucket_wave.png`.
- Latest contour normalization report has no edge-touch warnings.
- Previous pre-contour output was archived under `public/fighters/_archive/pre_contour_cleanup_20260501_022251/janitor`.

### Martin Urbano

- Visual identity: shoulder-length dark wavy hair, black overshirt over white graphic tee, dark pants, white sneakers.
- Prop rule: no microphone in-game. He uses only a notepad and pen as spellcasting tools.
- Signature projectile: `firebolt`, spawned by `Firebolt Draft` on the normal `fireball` move.
- Second special: `Pen Is Mightier`, a giant glowing pen-blade slash using variable-width `special_2` frames.
- Sorcerer-only control rule: Martin should not feel like a punch/kick character. The normal engine move ids remain for input compatibility, but his current moves spawn magic: `Ink Spark` on light punch, `Ground Rune` on crouch low kick, `Run-On Spark` on dash punch, `Firebolt Draft` on fireball, and `Lightning from the Sky` on heavy punch.
- Sky-strike mechanic: the engine now supports `spawn_projectile_from_sky`, which targets the opponent's current x-position but spawns the projectile above them. `ProjectileConfig.velocity` then lets the projectile fall vertically instead of using the default horizontal speed.
- Targeted projectile rule: use `spawn_projectile_at_target` for instant target-centered effects and `spawn_projectile_from_sky` for objects or spells that visibly descend before striking.
- Current imported fighter id: `martin_urbano`.
- Current generated projectile assets: `public/fighters/martin_urbano/projectiles/firebolt.png`, `ink_spark.png`, `ground_rune.png`, `lightning_from_sky.png`.
- Normalization note: source sheet used solid magenta background and required a manual projectile crop because the first contour export included the caster hand attached to the firebolt trail.
- Latest contour normalization report has no edge-touch warnings.

### Jack Tucker

- Visual identity: wiry cabaret comedian in a black suit jacket, open white shirt, loose blue tie, black trousers, and star-accent boots.
- Weapon: handheld microphone.
- Signature special: tosses a red apple, bats it with the microphone, and fires apple fragments at the opponent.
- Projectile: `apple_shards`.
- Current imported fighter id: `jack_tucker`.
- Current generated projectile asset: `public/fighters/jack_tucker/projectiles/apple_shards.png`.
- Latest contour normalization report has no edge-touch warnings and no multi-component character frames.
- For the apple special, caster frames use source indices `24,25,26,29,29,29`; source index `28` is exported as the projectile. This avoids baking the flying apple fragments into Jack's body animation.
- The apple special needs intentional caster-side prop staging before projectile handoff: frames 1-2 keep the tossed apple near Jack, frame 3 starts the mic swing, frame 4 composites the mic impact/explosion, and the spawned `apple_shards` projectile takes over from that impact beat. Detached props in this move are intentional until the projectile spawn frame; do not strip them as bleed during normalization.

### Dylan

- Visual identity: slim purple-suited sax performer with long curls, dark cap, sunglasses, gold chains, tan/gray sneakers, and a gold saxophone.
- Weapon: gold saxophone.
- Signature projectile: `purple_note_wave`, a purple/gold sonic blast from the sax.
- Current imported fighter id: `dylan_sax`.
- Current generated projectile asset: `public/fighters/dylan_sax/projectiles/purple_note_wave.png`.
- Projectile handoff note: source index `27` is exported as the sound-wave projectile, while caster `special_2` uses source indices `24,25,26,28,29,29` to avoid showing the detached wave in the character animation after spawn.
- Latest contour normalization report has no edge-touch warnings.

### Corey

- Visual identity: stocky red-haired, red-bearded performer in an open pale yellow shirt, bare chest, blue jeans, brown boots, and red-and-white cans.
- Props: cans and white foam/milk splash effects.
- Signature projectile: `foam_wave`, a rolling white splash wave with tossed can bits.
- Current imported fighter id: `corey`.
- Current generated projectile asset: `public/fighters/corey/projectiles/foam_wave.png`.
- Projectile handoff note: source index `27` is exported as the foam-wave projectile, while caster `special_2` uses source indices `24,25,26,29,29,29` to keep the projectile out of recovery frames.
- Latest contour normalization report has no edge-touch warnings.

### Juggling Joe

- Visual identity: blond tuxedo stage juggler with short curls, short beard, black tuxedo, white shirt, black bow tie, and polished black shoes.
- Prop: white juggling balls.
- Specials must stay juggling-themed. Current `uppercut` is `Juggle Cyclone`; current `fireball` is `Juggling Barrage`.
- Signature projectile: `juggling_balls`, a cluster of white balls with blue-white motion trails.
- Current imported fighter id: `juggling_joe`.
- Current generated projectile asset: `public/fighters/juggling_joe/projectiles/juggling_balls.png`.
- Projectile handoff note: source index `27` is exported as the ball-barrage projectile, while caster `special_2` uses source indices `24,25,26,28,29,29` to keep the projectile out of recovery frames.
- Latest contour normalization report has no edge-touch warnings.

### Rubber Chicken

- Visual identity: classic rubber chicken toy come to life with bumpy yellow body, long neck, red comb/wattle, orange beak/feet, blue eyes, and a green collar.
- Movement identity: elastic, squeaky, rubbery, and absurd.
- Signature close special: `Elastic Neck Snap`, a long connected beak strike using wide variable-size frames.
- Signature projectile: `squeak_storm`, yellow-orange squeak rings, rubber feathers, and an egg-shaped shockwave.
- Current imported fighter id: `rubber_chicken`.
- Current generated projectile asset: `public/fighters/rubber_chicken/projectiles/squeak_storm.png`.
- Projectile handoff note: source index `27` is exported as the squeak-storm projectile, while caster `special_2` uses source indices `24,25,26,28,29,29` to keep the projectile out of recovery frames.
- Latest contour normalization report has no edge-touch warnings.

## Feedback Log

- Sprite frames must not wrap or show bleed from neighboring cells.
- Sprites must not be cut off at top, bottom, or sides.
- Use variable-size frames plus anchors instead of one uniform frame size for oversized attacks.
- Projectiles and lingering effects should be separate entities, not baked into every character frame.
- Generated character art should match the high-quality pixel-art fighter style of the existing roster.
- For visual gag details, preserve the defining prop/silhouette exactly enough that it reads at game scale.
- Full-sheet image generation may create good art but bad frame separation. When the sheet includes stray shoes, mop heads, or splash fragments from neighboring cells, do a dominant-component cleanup on each runtime frame while keeping projectile components separately.
- Feedback from Viggo/Janitor sprite debug: reports with no edge-touch warnings can still have visible bleed. Edge checks are necessary but not sufficient; component-count / contour checks are required too.
- Follow-up feedback: if the in-browser view still shows old bleed after files are regenerated, confirm the Phaser loader is appending a cache-busting query to individual frame URLs. The runtime uses `sprites/<sheet>/<frame>.png`, not the preview `sheets/*.png`.
- Follow-up feedback: Viggo/Janitor initially displayed the hurt/impact base frame while crouching because the engine fallback assumed frame 4 was crouch. Generated sheets now need explicit `sprite.stateFrames`; never rely on a hardcoded base-row interpretation for generated characters.
