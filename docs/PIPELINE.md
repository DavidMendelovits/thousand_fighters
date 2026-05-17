# Pipeline: sprite-sprint → thousand_fighters

sprite-sprint produces the raw AI-generated source sheet. thousand_fighters' normalize script turns it into a game-ready fighter pack. sprite-sprint supports two generation paths (image-gen and video); both output the same 5×6 sheet format.

## Architecture

```
sprite-sprint (PATH A: image-gen)      sprite-sprint (PATH B: video)
────────────────────────────────       ─────────────────────────────
reference image + prompt               reference image + 5 move prompts
    ↓                                      ↓
single-shot AI image generation        5 Runway video generations
    ↓                                      ↓
OUTPUT: 5×6 imagegen sheet             6 frames extracted per video
                                           ↓
                                       compose 30 frames → 5×6 grid
                                           ↓
                                       OUTPUT: 5×6 imagegen sheet

            ↓ same handoff for both paths ↓

thousand_fighters: normalize_fighter_sheet_contours.py
    ↓
contour cleanup (chroma/checker background → alpha)
    ↓
connected-component detection
    ↓
frame assignment to 5×6 grid slots
    ↓
per-frame variable-size export + anchors
    ↓
projectile separation
    ↓
preview sheet rebuild + frameData.json + manifest.json
    ↓
OUTPUT: full fighter pack
```

The normalize script does not care how the sheet was made. Both paths produce the same input format.

## Generation Paths

### Path A: Image Generation (single-shot)

Best for: pixel art, stylized characters, static pose sets.

Uses sprite-sprint's `RunwayImageClient` to generate the full 5×6 sheet in one API call from a prompt + reference image. This is how the existing roster (Viggo, Janitor, Mr Cardboard, Jack Tucker, Martin Urbano) was made.

- One API call per character (~$0.10-0.50)
- Direct control over pose layout via prompt
- Fast (seconds, not minutes)
- Poses are static; no motion flow between frames
- AI may not follow grid layout perfectly; bleed between cells is common

### Path B: Video Generation (per-move)

Best for: realistic characters, dynamic motion, natural movement arcs.

Generates 5 separate Runway videos (one per move), extracts 6 key frames from each, then composes the 30 frames into the 5×6 grid. This leverages sprite-sprint's core video pipeline.

- 5 video generations per character (~$2.50+)
- Natural motion continuity within each move
- More dynamic poses with real weight and momentum
- Slower (minutes per video)
- Frame selection requires curation (existing v2 contact sheet + selection UI)

### User Choice

The user picks per character. The sprite-sprint UI presents both options. A pixel-art throwback uses Path A. A realistic newcomer uses Path B. The output format is identical.

## Handoff Contract

sprite-sprint outputs a single PNG: the 5×6 imagegen sheet. The normalize script does all downstream processing.

### What sprite-sprint must produce

A single image file:

- **Grid:** 5 rows × 6 columns = 30 cells
- **Rows (top to bottom):** base, punch, kick, special_1, special_2
- **Background:** magenta chroma key (#FF00FF) or transparent alpha. sprite-sprint should output with the background intact; the normalize script's `is_background()` handles both magenta and light-grey checkerboard removal.
- **Cell content:** one full-body character pose per cell, facing right
- **No cropping:** full body visible in every cell (head, feet, weapons, props)
- **Generous gutters:** leave space between cells to reduce cross-cell bleed
- **Consistent character scale:** same character size across all 30 poses
- **Projectile row:** special_2 row includes the projectile in one cell (the normalize script separates it)

### What sprite-sprint does NOT need to produce

- Per-frame anchors (normalize script calculates from contours)
- Individual frame PNGs (normalize script extracts from sheet)
- Preview sheets (normalize script rebuilds from extracted frames)
- `frameData.json` or `manifest.json` (normalize script generates both)
- Variable-size frame cropping (normalize script handles via contour bounding boxes)
- Background removal (normalize script handles chroma/checker → alpha)

### File placement

```
thousand_fighters/public/fighters/<character_id>/source/<character_id>_imagegen_sheet.png
```

## sprite-sprint Changes Required

### Current pipeline

```
reference image → prompt → Runway video → extract N frames → uniform grid sheet + atlas JSON
```

Output: one `sprite.png` + `sprite.json` (TexturePacker format). Uniform frame sizes. No move-slot awareness. Single generation path.

### New capabilities needed

1. **Fighter pack job type.** A new job mode alongside the existing sprite sheet mode. Accepts:
   - `character_id` (string)
   - `character_description` (text, for prompts)
   - `moveset` (dict: punch/kick/special_1/special_2, each with name + description)
   - `generation_path` ("image" or "video")
   - `art_style` (freeform: "pixel art", "realistic", "cel-shaded", etc.)

2. **Path A: image-gen mode.** Use `RunwayImageClient.generate_image()` with the 5×6 sheet prompt pattern (see below). Output the raw sheet directly.

3. **Path B: video mode.** Generate 5 videos (one per move row). For each:
   - Build a move-specific prompt from character description + moveset entry
   - Generate Runway video
   - Extract 6 frames via existing `extract_frames`
   - Compose 30 frames into 5×6 grid (new composer function)

4. **5×6 grid composer.** Takes 30 frame PNGs (or accepts a raw image-gen sheet) and arranges into the 5-row × 6-column layout. For Path B, this composes extracted video frames. For Path A, the image-gen already produces the grid (this step is a passthrough or validation).

5. **Output path option.** Allow specifying output directly to `thousand_fighters/public/fighters/<id>/source/`.

### What stays the same

- Runway video generation (existing, used by Path B)
- Runway image generation (existing, used by Path A)
- Frame extraction via ffmpeg (existing `extract_frames`, used by Path B)
- Background removal via rembg (existing, optional pre-processing)
- v2 pipeline's contact sheet and frame selection UI (useful for Path B frame curation)

## Normalize Script Usage

After sprite-sprint produces the imagegen sheet:

```bash
cd thousand_fighters

python3 scripts/normalize_fighter_sheet_contours.py \
  public/fighters/<character_id>/source/<character_id>_imagegen_sheet.png \
  public/fighters/<character_id> \
  --character-id <character_id> \
  --projectile-id <projectile_id> \
  --projectile-index <0-based index of projectile cell> \
  --description <path to description.txt> \
  --moveset <path to moveset.txt>
```

Output:
```
public/fighters/<character_id>/
  manifest.json
  frameData.json
  normalization-report.json
  source/
    <character_id>_imagegen_sheet.png
    <character_id>_clean.png
  sheets/
    base.png, punch.png, kick.png, special_1.png, special_2.png
  sprites/
    base/base_001.png ... base_006.png
    punch/punch_001.png ... punch_006.png
    (etc.)
  projectiles/
    <projectile_id>.png
```

## Engine Wiring (after normalize)

1. Add projectile texture preload in `FightScene.ts`
2. Add frame metadata in `stamptownFighters.ts` with `makeFrameMeta`
3. Add character config (sprite, hurtboxes, moves)
4. Add to `playableCharacters` array
5. `npm run build`
6. Verify: `/?debug=sprites&character=<id>` then `/?p1=<id>&cpu=off`

See `SPRITE_MEMORY.md` for the full engine wiring checklist.

## Prompt Patterns

### Path A: Image-gen sheet prompt

```
Create a <art_style> reference sheet for a 2D fighting game character named <name>.

Character design: <description>.

Full body side-view fighting stance, consistent proportions, strong readable
silhouette, feet aligned to a shared baseline.

5 rows × 6 columns, each cell one full-body pose with generous padding:
Row 1 (base): idle, guard, crouch, airborne, hurt, stance variant
Row 2 (punch): <punch_name> - startup, windup, strike, impact, follow-through, recovery
Row 3 (kick): <kick_name> - startup, windup, strike, impact, follow-through, recovery
Row 4 (special_1): <special_1_name> - <special_1_description> in 6 beats
Row 5 (special_2): <special_2_name> - <special_2_description> in 6 beats

No text, no UI, no borders, no shadows, no background scene.
Magenta (#FF00FF) background.
```

### Path B: Per-move video prompt

```
A <art_style> 2D fighting game character named <name> performing <move_name>.
Character design: <description>.
Side-view, full body visible at all times. <move_description>.
The sequence shows: startup anticipation, active strike, impact, follow-through, recovery to stance.
Clean background, no camera movement.
```
