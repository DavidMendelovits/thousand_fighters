# Animation clips: source motion to normalized sprites

The Animation Lab is available at `/animation-lab` in the Vite app (`npm run dev`). The CMS header links to it using the same configurable base URL as the Character Gym. It is a review workspace, not an automatic fighter publisher.

This implementation supports arbitrary action ids, variable frame counts/holds, intentionally changing anatomy and size, disconnected parts, shared-coordinate layers, root displacement, sockets and event markers. Existing six-frame provider adapters and shipped fighter assets remain available.

## Try it

Open `http://127.0.0.1:5173/animation-lab`. Select a clip, scrub or step through poses, slow playback, switch the background, inspect anchors, and hide/show individual effects. Root displacement is independently switchable for extracted-motion clips. Open any compiled clip URL with the Open clip button or `?clip=/path/clip.json`.

The included library clearly distinguishes:

- **Generated video candidates:** two real Kling image-to-video runs using the existing Janitor reference, compiled to 15 selected poses each. The vault includes inversion and landing; the transformation melts and reforms. Neither is production-approved. Inspect prop continuity and framing; the transformation did not fully reach the requested monster design.
- **Procedural fixtures:** 24-frame acrobatics with known root motion; separated droplets becoming a larger creature; and independent body, aura and projectile layers. These are reproducible geometry tests, not evidence that AI generated those layers.

The clip compiler intentionally reports `needs-review`, even when its mechanical checks pass. A good transparency mask is not proof of good animation.

## Generate source video

Use the existing `FAL_KEY` in Doppler. No additional secret is required for this path. The active legacy image provider is not changed.

```sh
python3 scripts/prepare_animation_reference.py \
  public/fighters/janitor/sprites/base/base_001.png \
  --output artifacts/animation-video/my-reference.png

doppler run -- npm run animation:generate -- \
  --provider fal --mode image-to-video \
  --image artifacts/animation-video/my-reference.png \
  --duration 5 --prompt "Describe one original action, its key poses, and the fixed camera." \
  --output artifacts/animation-video/my-action-v1

doppler run -- npm run animation:generate -- --resume artifacts/animation-video/my-action-v1
```

Kling requires references at least 300×300. The preparation command pads an approved sprite, preserves its design, and only enlarges by integer nearest-neighbor factors. It refuses overwrite and refuses to shrink an oversized reference; use a larger canvas instead.

For a precisely directed performance, choose `--mode motion-control --motion path/to/driver.mp4` and omit `--duration`. For a transformation with an approved final form, image-to-video accepts `--end-image`. Provider completion, successful download, and visual acceptance are separate states. A persisted request can be resumed without a new generation. See [transport details](ANIMATION_VIDEO_GENERATION.md).

## Compile a clip

Create a JSON specification alongside the source MP4 or PNG sequence. All source paths are relative to that specification. This minimal example preserves the video's internal movement:

```json
{
  "id": "elastic_strike",
  "displayName": "Elastic strike",
  "kind": "morph-attack",
  "playback": "once",
  "tickRate": 60,
  "rootMode": "baked",
  "scale": 0.25,
  "padding": 6,
  "paletteSize": 32,
  "intent": {
    "topologyChanges": true,
    "scaleChanges": true,
    "paletteChanges": false
  },
  "layers": [{
    "id": "body", "role": "body", "z": 0,
    "source": {
      "video": "source.mp4",
      "anchor": { "x": 480, "y": 780 },
      "background": "#ff00ff",
      "backgroundMode": "chroma"
    }
  }],
  "selection": [
    { "frame": 0, "durationTicks": 8 },
    { "frame": 20, "durationTicks": 4 },
    { "frame": 45, "durationTicks": 3,
      "event": { "type": "impact", "label": "Full extension" } },
    { "frame": 75, "durationTicks": 6 },
    { "frame": 110, "durationTicks": 10 }
  ],
  "provenance": { "method": "generated-video", "description": "Unapproved candidate" }
}
```

Anchor coordinates and source-frame indices must be measured for the actual video. The numbers above illustrate the contract, not automatic pose detection.

```sh
npm run animation:compile -- artifacts/animation-video/my-action-v1/compile.json \
  --output public/animation-lab/elastic-strike-v1
```

Open `/animation-lab?clip=/animation-lab/elastic-strike-v1/clip.json`. Output directories are immutable: choose a new version for revisions. Compilation writes to staging and publishes only when complete, leaving accepted assets untouched.

### Selection and timing

Explicit selections retain precisely the requested source frames, order, repetitions and holds. `durationTicks` is an integer number of **60 Hz gameplay ticks**, not source-video frames. Slow source motion can become a quick attack without changing combat timing.

For a first pass, replace the array with:

```json
{
  "mode": "motion",
  "startFrame": 0,
  "endFrame": 120,
  "frameCount": 16,
  "durationTicks": 3,
  "markers": [{ "frame": 74, "durationTicks": 6, "event": "impact" }]
}
```

Motion mode allocates samples by coarse frame differences, preserving endpoints and required markers. It is **not** a semantic detector: it cannot know which frame is a punch contact or distinguish camera movement from acting. Review its output. `uniform` and `all` are also supported; `all` is capped at 240 output frames.

Events use zero-based output ticks. Markers attached to selected source frames automatically acquire the correct output tick. Timing remains separate from collision rules. The runtime fragment supplies visual timing; it does not invent hitboxes or balance.

### Coordinate and layer rules

Each layer supplies `source.frames` (an ordered path list) or `source.video`. PNG sources may set `fps` for provenance timestamps; video frames retain decoder timestamps. All frames within one source must share dimensions. Layers have the same source frame count, or a single static frame repeated across the clip. Layer timing is synchronized to the primary layer's selection. Resample independently timed effects to the shared source timeline before compilation.

`source.anchor` is the reference pivot in source pixels. Optional `source.rootTrack` contains one `{x,y}` per source frame:

- `in-place`: subtract the tracked root to stabilize the character; export no world displacement.
- `extract`: subtract the root and export its absolute displacement from the reference anchor. The Lab can reapply that displacement.
- `baked`: retain movement inside the source canvas using the fixed reference anchor. Do not also apply the same jump/displacement in-game.

Without a root track the anchor is constant; the compiler does not pretend to infer a pelvis from feet during an inversion. No per-frame centroid alignment is applied.

Optional `source.sockets` maps names to per-source-frame `{x,y}` tracks; use `null` where an attachment is absent/occluded. The compiler transforms these into output canvas coordinates. Body, front/back aura, trails and projectiles can have independent layers, `z` order and `blend` (`normal` or `add`). Additive composition is honored in the Lab; the static contact sheet/APNG uses source-over and emits a warning for additive layers.

Every selected pose and layer contributes to one root-relative union canvas. A long limb, detached droplet, or growing body expands that canvas. No frame is shrunk independently, and no connected component is discarded. Frame atlases store rectangles explicitly rather than assuming six cells or a single row.

### Alpha, pixels and palette

Transparent PNG alpha is preserved. For keyed sources:

- `connected` (default) removes only key-colored pixels connected to the outer canvas. It protects isolated costume details but leaves keyed enclosed holes.
- `all` removes all pixels within `keyTolerance` of the key color.
- `chroma` removes saturated magenta or green even across changing brightness/shadows. Only use when that hue is absent from the intended foreground; it can destroy matching costume colors.

All geometric scaling uses nearest-neighbor and one shared scale. Optional `paletteSize` fits one palette across the selected layers/frames with dithering disabled, preserving alpha. Alternatively pass an explicit `palette` array of hex colors. A shared palette can include a planned transformation's colors; palette changes do not require per-frame palette fitting. Downsampling cannot fix anatomy or missing source pixels.

The compiler bounds source frame count, decoded pixels, transformed pixels, canvas and atlas sizes. Large videos should first be trimmed/downscaled as deliberate preprocessing. Requirements: Python 3, Pillow, FFmpeg and ffprobe.

## Output package

```text
clip.json                  # versioned composition/timing/provenance/QA contract
runtime-fragment.json      # body sprite paths, 60 Hz visualTimeline, frame metadata
frameData.json             # anchors and durations for every layer
source-spec.json            # exact compilation settings
sprites/<layer>/*.png       # normalized transparent per-frame files
layers/<layer>.png          # packed atlas, rectangles in clip.json
contact-sheet.png           # whole-clip inspection
preview.png                 # lossless animated PNG, source-over composition
```

`runtime-fragment.json` is a reviewed import aid, not an automatic publish operation. Sprite paths are relative to the package. Map its animation id into a fighter's row/move configuration, copy the assets, and deliberately bind root motion, sockets and effect events. Existing fighter registries and CMS validation still govern published moves. The Animation Lab's generic evaluator can play all clip ids without requiring that registration.

## Verification and next steps

```sh
npm run animation:test
npx tsx --test tests/animation-clip.test.ts
npx playwright test tests/animation-lab.spec.js
```

The deterministic fixtures can be rebuilt into a fresh directory with `npm run animation:demos -- --output /tmp/my-new-animation-demos`. Their source geometry is in `scripts/build_animation_lab_demos.py`; their temporary PNG inputs are disposable, while their compiler source hashes and regeneration script remain available.

This delivery establishes transport, normalized clip packaging, inspection and test coverage. It does not claim autonomous art acceptance, trained morph models, automatic pose/alpha tracking, or published gameplay integration for every new action. Next experiments should compare motion-control drivers and start/end transformation references using the same review surface and acceptance criteria. Measure accepted actions and correction time, not only successful downloads.
