# Pipeline: sprite-sprint → thousand_fighters

sprite-sprint produces the raw AI-generated source sheet. thousand_fighters' normalize script turns it into a game-ready fighter pack.

## Architecture

```
sprite-sprint                          thousand_fighters
─────────────                          ─────────────────
reference image                        normalize_fighter_sheet_contours.py
    ↓                                      ↓
AI prompt generation                   contour cleanup (background → alpha)
    ↓                                      ↓
Runway video generation                connected-component detection
    ↓                                      ↓
frame extraction (30 frames)           frame assignment to 6×5 grid slots
    ↓                                      ↓
compose 5×6 imagegen sheet             per-frame variable-size export + anchors
    ↓                                      ↓
OUTPUT: source/<id>_imagegen_sheet.png  projectile separation
                                           ↓
                                       preview sheet rebuild
                                           ↓
                                       OUTPUT: full fighter pack
```

## Handoff Contract

sprite-sprint outputs a single PNG: the 5×6 imagegen sheet.

### What sprite-sprint must produce

A single image file with these properties:

- **Grid:** 5 rows × 6 columns = 30 cells
- **Rows (top to bottom):** base, punch, kick, special_1, special_2
- **Background:** magenta chroma key (#FF00FF) or transparent alpha
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

### File placement

```
thousand_fighters/public/fighters/<character_id>/source/<character_id>_imagegen_sheet.png
```

## sprite-sprint Changes Required

### Current v1 pipeline (per-job)

```
reference image → prompt → Runway video → extract N frames → uniform grid sheet + atlas JSON
```

Output: one `sprite.png` + `sprite.json` (TexturePacker format). Uniform frame sizes. No move-slot awareness.

### What needs to change

1. **Move-aware frame extraction.** Instead of extracting N frames from one video, sprite-sprint needs to produce 30 frames organized as 5 moves × 6 poses. Two approaches:
   - **5 separate videos** (one per move) → 6 frames each → compose into 5×6 grid
   - **1 video with all moves** → extract 30 frames → arrange into 5×6 grid

2. **Character description + moveset input.** sprite-sprint needs to accept:
   - `character_id` (string)
   - `character_description` (text, used for image generation prompts)
   - `moveset` (dict of punch/kick/special_1/special_2 with name + description)

3. **5×6 grid output.** Replace the current uniform grid composer with a 5-row × 6-column layout:
   - Row 1: base poses (idle, guard, crouch, airborne, hurt, stance)
   - Row 2: punch sequence (startup through recovery, 6 frames)
   - Row 3: kick sequence (startup through recovery, 6 frames)
   - Row 4: special_1 sequence (6 frames)
   - Row 5: special_2 sequence (6 frames, including projectile in one cell)

4. **Chroma key background.** Use magenta (#FF00FF) or transparent output. The normalize script handles background removal, but clean input reduces artifacts.

5. **Output path option.** Allow specifying output directly to `thousand_fighters/public/fighters/<id>/source/`.

### What stays the same

- Runway video generation (existing integration)
- Frame extraction via ffmpeg (existing `extract_frames`)
- Background removal via rembg (existing, optional)
- The v2 pipeline's chroma key removal (existing `remove_chroma_dir`)

## Normalize Script Usage

After sprite-sprint produces the imagegen sheet, run:

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

This produces the full fighter pack:
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
    kick/kick_001.png ... kick_006.png
    special_1/special_1_001.png ... special_1_006.png
    special_2/special_2_001.png ... special_2_006.png
  projectiles/
    <projectile_id>.png
```

## Engine Wiring (after normalize)

After the pack exists, wire into the engine:

1. Add projectile texture preload in `FightScene.ts`
2. Add frame metadata in `stamptownFighters.ts` with `makeFrameMeta`
3. Add character config (sprite, hurtboxes, moves)
4. Add to `playableCharacters` array
5. Run `npm run build`
6. Verify: `/?debug=sprites&character=<id>` then `/?p1=<id>&cpu=off`

See `SPRITE_MEMORY.md` for the full engine wiring checklist.

## Prompt Pattern for 5×6 Sheet

The image generation prompt should follow this pattern (from SPRITE_MEMORY.md):

```
Create a transparent-background pixel art reference sheet for a 2D fighting game
character named <name>, high quality 16-bit arcade fighter sprite style.

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
```

Adapt the style description per character. The multiverse roster allows any visual style: replace "pixel art" with "painterly", "realistic", "cel-shaded", etc.
