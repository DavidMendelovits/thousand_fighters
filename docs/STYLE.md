# Style Canon

Thousand Fighters is a multiverse roster. Any art style is valid: pixel art, painterly, realistic, cel-shaded, paper cutout. A 64-color pixel character can fight a fully rendered one. Style diversity is the feature, not a bug.

These five constraints are what make any style work on the same stage.

## 1. Frame Contract

Every fighter has exactly 5 sheets: `base`, `punch`, `kick`, `special_1`, `special_2`.

The standard for new fighters is **6 frames per sheet**. The engine supports variable counts per sheet via `sprite.frameCounts` (Mic Monarch uses 4-frame move sheets). Frame assignments:

| Sheet       | 6-frame assignment (standard)                                    |
|-------------|------------------------------------------------------------------|
| `base`      | idle, guard, crouch, airborne, hurt/taunt, stance variant        |
| `punch`     | startup, active, extended/impact, recovery, utility, return      |
| `kick`      | startup, active, extended/impact, recovery, utility, return      |
| `special_1` | character-specific close/movement special (6 poses)              |
| `special_2` | projectile/cast special (6 poses, projectile exported separately)|

`FightScene.preload` iterates `sprite.frameCounts` per sheet and loads individual frame PNGs keyed as `{character_id}:{sheet}:{frame_index}`.

## 2. Per-Frame Anchor Metadata

Every frame gets its own bounding box and anchor point in `frameData.json`:

```json
{
  "anchorConvention": "frame anchor is the character pivot/feet, in pixels from each PNG top-left",
  "frames": {
    "base": [
      { "file": "sprites/base/base_001.png", "width": 220, "height": 286, "anchor": { "x": 110, "y": 248 } }
    ]
  }
}
```

Frames are variable-size. A mop swing can be 350px wide while an idle pose is 220px. The engine renders at `fighterPosition - frame.anchor`, so the feet stay planted regardless of frame size.

This is how different art styles coexist on the same floor line. A pixel character at 150px and a realistic one at 300px both anchor at their feet on `FLOOR_Y`.

## 3. Projectile Separation

Anything that leaves the character's body becomes a separate PNG in `projectiles/`. The engine spawns it as an independent entity with its own hitbox and lifetime.

Examples from the current roster:
- Mr Cardboard's cardboard cross
- Viggo's thrown hi-vis vest
- Janitor's bucket water wave
- Jack Tucker's apple shards

The caster animation should NOT show the projectile after the spawn frame. Recovery frames show the character returning to stance, not the flying object.

## 4. Per-Character Hurtboxes

Style flexibility requires per-character hurtbox tuning. A stocky pixel character and a tall realistic one occupy different collision volumes. Every `CharacterConfig` must define hurtboxes per `FighterState`:

```typescript
hurtboxes: {
  idle:         { x: -25, y: -122, width: 50, height: 122 },
  crouch:       { x: -28, y: -82,  width: 56, height: 82  },
  attack:       { x: -26, y: -120, width: 52, height: 120 },
  // ...per state
}
```

These are relative to the fighter's pivot point. Tune them per character; do not copy from another fighter without checking visual fit.

## 5. Silhouette Legibility

Regardless of rendering style, every fighter must read clearly at game scale (~150-300px tall on a 800x450 stage). This means:

- **Clear action poses.** The viewer should identify idle vs punch vs kick vs special from silhouette alone.
- **No cropping.** Full body visible in every frame: head, hands, feet, weapons, props.
- **Distinct identity.** Each character's silhouette should be recognizable without color. A mop, a guitar, a kilt, a cardboard sword: the prop IS the character.
- **Contrast against stage.** The character should read against the dark stage background (#141820).

Style-specific guidance:
- Pixel art: hard edges read well at small scale. Limited palettes help.
- Realistic/painterly: ensure enough contrast in the rendered sprite. Soft edges can blur at game scale.
- Mixed media: test in-game with `/?debug=sprites&character=<id>` and at fight scale with `/?p1=<id>&cpu=off`.

## Roster

Current fighters and their styles:

| Fighter         | Style              | Status    |
|-----------------|--------------------|-----------|
| Guitar Shredder | Classic 16-bit     | Playable  |
| Mr Cardboard    | AI-pixel-rendered  | Playable  |
| Mic Monarch     | AI-pixel-rendered  | Playable  |
| Viggo           | AI-pixel-rendered  | Playable  |
| The Janitor     | AI-pixel-rendered  | Playable  |
| Jack Tucker     | AI-pixel-rendered  | Playable  |
| Martin Urbano   | AI-pixel-rendered  | In source |

New fighters can be any style. The constraints above are what make them engine-compatible.
