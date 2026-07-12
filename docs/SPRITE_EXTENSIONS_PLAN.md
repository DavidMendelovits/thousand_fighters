# Plan: Sprite Sheet Preview Fix + Variable-Extent Sprite Support

## Context

Two issues from the first real codex-generated fighter (octopus warrior):

1. **Broken preview segmentation** — The create UI slices the sprite sheet at fixed 150×150 cells, but AI output doesn't align to a rigid grid.

2. **Extended poses get clipped** — Characters like the octopus have tentacle swings that extend well beyond the base idle pose. The normalizer's contour detection already finds these naturally, but the current min-size/padding logic standardizes all frames to a uniform size, potentially clipping or over-padding extended poses.

### Key insight: extensions are not separate sprites

Every character pose — including tentacle swings, weapon arcs, dramatic kicks — already lives in the 5×6 sheet. The normalizer's contour detection extracts each pose at its natural bounding box. The frame data format already supports per-frame variable dimensions and anchors. **No additional generation step or separate extension sheets are needed.**

The fix is:
- Make the preview show what the AI actually generated (not a broken grid)
- Make the normalizer preserve the natural extent of each pose
- Ensure the runtime renders variable-size frames correctly relative to the anchor

---

## Part 1: Sprite Sheet Preview Fix

**`admin/create.js`**
- Add `ctx.sheetNaturalWidth` / `ctx.sheetNaturalHeight`
- Add `loadSheetDimensions()` — `new Image()` to read actual dimensions after sheet URL is set
- Rewrite `renderRowFrames(rowIndex)`:
  - Row height = `naturalHeight / 5`, use actual sheet width
  - Single div per row showing the full strip via `background-image` + `background-position`
  - 5 dashed vertical guide lines overlaid at 1/6 column intervals
  - Aspect ratio preserved, no fixed pixel assumptions
- Reset dimensions in `onCreateAnother()`

**`admin/create.css`**
- `.sprite-row-strip` — relative container, `overflow: hidden`
- `.sprite-row-guide` — absolute-positioned dashed vertical lines (`rgba(255,255,255,0.2)`)

---

## Part 2: Variable-Extent Sprite Support

### Normalizer Changes (`scripts/normalize_fighter_sheet_contours.py`)

The `frame_from_component()` function (line 188) currently enforces:
```python
min_width = 220
min_height = 286
width = max(crop.width + 80, min_width)   # Always at least 220
height = max(crop.height + 58, min_height) # Always at least 286
```

This produces uniform frames for most characters but clips or over-pads extended poses.

**Changes:**
- Remove the hard `min_width`/`min_height` clamps — let each frame be as large as its contour needs
- Keep the padding (80px horizontal, 58px vertical) — this provides breathing room
- Keep `floor_padding = 38` — the anchor convention stays
- The anchor formula stays: `(width // 2, height - floor_padding)` — center-x, feet position
- Each frame's actual dimensions get written to `frameData.json` as they already are

Result: a tentacle-extended special_1 frame might be 480×320 while an idle frame is 220×286. Both have correct anchors. This is already the intended design — `frameData.json` stores per-frame width/height/anchor precisely for this reason.

### Runtime Changes (`src/core/Fighter.ts`)

Check how `syncActorVisual()` uses `frameMeta`:
- Verify that `setOrigin()` is recalculated per-frame based on `frameMeta.anchor` / frame dimensions
- Verify that wider frames don't cause the character to shift — the anchor (feet position) should remain stable
- If the runtime currently caches texture dimensions at load time rather than reading per-frame, fix it to use per-frame `frameMeta`

**`src/scenes/FightScene.ts`** — Verify frame loading:
- Frames are loaded as individual textures keyed as `{characterId}:{sheetId}:{frameIndex}`
- Each texture naturally has its own dimensions from the PNG file
- Phaser `setTexture()` + `setOrigin(anchorX/width, anchorY/height)` handles variable sizes

### Hitbox Authoring

Hitboxes in move definitions are already relative to the character position (not frame bounds):
```typescript
hitbox: { x: 30, y: -60, width: 80, height: 40, ... }
```

These offsets are from the character's world position. A wider frame doesn't affect hitbox placement — it just means more visual content is visible. No hitbox changes needed.

### What This Enables

With variable-extent frames:
- **Tentacle swing**: special_1 frames are naturally wider, showing the full tentacle arc
- **Weapon reach**: punch frames can extend further when the character lunges
- **Aura effects**: special_2 frames include the aura as part of the character's contour
- **Jump attacks**: aerial kick frames can be taller to show the full trajectory

All within the existing 5×6 sheet, existing normalization pipeline, existing frame data format. No new asset types, no new generation steps, no new actor system.

### Draft Schema — Optional `frameHints`

For AI generation quality, the CMS draft can optionally include hints about which moves should have extended frames:

```json
{
  "sprite": {
    "frameHints": {
      "special_1": { "extendedWidth": true, "description": "Tentacle swing extending far right" },
      "special_2": { "extendedHeight": true, "description": "Upward tentacle lash" }
    }
  }
}
```

These hints get folded into the sprite generation prompt so the AI knows to give those rows more space. The normalizer doesn't need them — it extracts whatever contours exist.

**`admin/create.js`** — `buildSpritePrompt()` can include frame hints:
```
"Row 4 (special_1) should show extended reach — tentacle swing animation extending far to the right."
```

---

## Verification

**Part 1:**
- Generate a sprite sheet via codex, verify preview shows full-row strips with column guides
- Upload a non-standard-dimension sheet, verify it adapts

**Part 2:**
- Modify `frame_from_component()` to remove min clamps, normalize a sheet with extended poses
- Verify frameData.json has variable frame sizes (e.g., special_1 frames wider than idle frames)
- Load the fighter in-game, verify extended frames render correctly at anchor position
- Verify idle → extended → idle animation transitions don't cause visual jumping (anchor stability)
- Run `npm run build` to confirm TypeScript still passes (no type changes needed)
