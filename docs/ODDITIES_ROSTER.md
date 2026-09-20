# The Oddities: playable roster and motion provenance

Open `/roster` to select any two of ten original fighters. Existing fighters remain available in the game's full selector. No CMS records were replaced.

| Fighter | Identity | Distinct mechanic |
| --- | --- | --- |
| Madame Meridian | Reality-unpicking seamstress | Ground capture, sky knockdown, rear stun, forward needle |
| Brine | Coral squid dock boxer | Travelling tentacle grab, reel-in, throw, ink stun |
| Taffy Riot | Elastic candy boxer | Stretching punch and wrapping grab |
| Sister Static | Jellyfish oracle | Stun orb and projectile cage |
| Vellum | Moth archivist | Binding pages and launching razor page |
| Kilnheart | Living pottery furnace | Armored heavy strike and knockdown clinker |
| Maestro Mycel | Fungal conductor | Ground roots capture and extended root strike |
| Rivet Rook | Magnetic scrapyard crow | Projectile clamp pulls victims toward the caster |
| Widow Veil | Living empty mourning dress | Ribbon-sleeve grab and long-range slash |
| Bellwether | Bell-headed salvage diver | Pressure-wave launch and sonic stun |

All fighters also have a punch, low kick, and close catch/hold/throw. P1 uses WASD, F/G/H; F+G grabs, S+H is the alternate special. Meridian additionally uses W+H for sky and away+H for rear. P2 uses arrows and J/K/L. Hold away to guard; F2 toggles CPU.

## Where video is used

Each fighter has one generated-video signature body clip, compiled into 10–14 transparent pixel-art frames. Meridian shares her cast clip across four projectile moves: 13 moves total use video-derived animation. The source model is **Kling v3 standard image-to-video through fal**, not MiniMax H3 for these particular clips. Gemini was not used.

Approved character reference → five-second image-to-video candidate → review and frame selection → shared scale, foot anchor and palette → authored 60 Hz move timeline. One scale is applied to the whole clip, never silhouette-fit independently per frame. Veil's source contains off-canvas sleeves; those source frames are excluded from the shipped selection.

Video supplies appearance, not physics. Collision boxes, active frames, projectile origins, delays, capture trajectories, stun, damage and releases remain deterministic engine data. Extensions are drawn to the moving collision tip or captured opponent. This keeps varying opponents and distances playable instead of baking a fixed opponent into generated footage.

This is a playable prototype, **not a completed animation set**: walk, jump, normals, hurt and close-throw sequences still use a small generated key-pose pack. Video improves temporal continuity but does not guarantee stable anatomy or pixel clusters. Several signatures need further cleanup (including Vesper's baked decorative sparks); all clips retain a human-review status. No claim of final balance, full motion coverage, or production-ready pixel cleanup.

## Inspect and reproduce

- `src/characters/oddities.ts`: authored combat kits and character concepts.
- `public/fighters/<id>/art-provenance.json`: key-pose source and prompts.
- `public/fighters/<id>/video-signature/`: selected frames, fixed-anchor atlas, clip manifest, QA, preview and runtime fragment.
- `/animation-lab`: inspect all ten video signatures plus existing animation experiments.
- `artifacts/animation-video/oddities/`: local source movies, persisted provider jobs and compilation specifications (not the public deployment payload).
- `scripts/generate_oddities_videos.mjs`: resumable additional seven-character video batch; uses the existing Doppler FAL_KEY.
- `python3 scripts/compile_oddities_video.py`: compile retained source movies; preserves existing output directories.
- `npx tsx scripts/export_oddities_roster.ts`: export configs, move manifests and gallery entries after compilation.

No new Doppler variables were required. Generation incurs provider usage; reruns resume persisted jobs rather than silently submit duplicates. Existing successful clips are retained.

## Real gameplay capture

`public/replays/oddities-brine-v-meridian.mp4` is a silent capture of the actual Phaser canvas, not generated footage or an offline animation composition. Both players receive choreographed browser keyboard input for the mechanic showcase, followed by a CPU-controlled opponent. The engine decides all hits, captures and outcomes. No position, health or hit-result injection is used by the recorder.

Reproduce with `node scripts/record_oddities_gameplay.mjs --take=<new-name>`. It saves a WebM and time-stamped read-only telemetry under `artifacts/roster-oddities/<new-name>/`. Encode the canvas capture as H.264, yuv420p, 60 fps with integer 2× nearest-neighbor scaling and fast-start metadata. Runtime test fixtures have separate `training=1` hooks; the recorder never enables them.

Tests cover roster asset references, matching animation/move durations, rear-side guarding, stun, armor death, grab safety, moving limb hitboxes, actual capture/release, ground/sky/rear attacks, all ten loaded signatures, CPU input, and desktop/mobile roster layout.
