# Combat and sprite quality checkpoint

## What changed

- Dedicated Oddities stun specials: Meridian 6 ticks (100 ms), Brine 8 (133 ms), Bellwether 10 (167 ms), Vesper 12 (200 ms), replacing 42–54 ticks. These interrupt an attack; they do not guarantee a subsequent grab.
- Explicit `stun` now overrides `hitstun` instead of taking the larger number. Ordinary hitstun, launcher reactions, grabs and knockdowns remain separate mechanics. Combo-link hitstun is deliberately unchanged so the existing hit-confirm routes still work.
- Default impact pause is 1–4 ticks, down from 3–9. A move's explicit `hitstop` (including zero) still wins.
- Melee export preserves stun, hitstop, launch, knockdown and impact fields; these previously could be discarded while projectile equivalents survived.
- The workbench move summary displays reaction timing in ticks and milliseconds. The definition editor exposes `sprite.relativeHeight` and `sprite.scaleAdjust`. `combatStats.size` / runtime `stats.size` scale collision and art together; power-ups can modify size temporarily.
- Video extraction treats each tile as an independent captured moment. It checks every cell boundary, not just the outside of the assembled sheet, and retains `sourceClipped` in frame metadata. QA fails and publish/export rejects known clipped sources, including with stale QA. Older unaudited frames receive a warning, not a clean certification.
- Pixel resizing uses nearest-neighbor. Video generation requests a body-only pass without baked explosions and reserves more canvas room (40% maximum body occupancy in the reference). Prompts reduce risk; source review and boundary checks are still necessary.

## Confirmed remaining art problem

Latch's original `special_2` (Spare Key) source clips its flash at frame 4's right camera edge. The new extractor reproduces that finding from `cms-data/characters/latch/assets/source/latch_special_2_sheet.png`. Transparent padding does not reconstruct the missing explosion. The published prototype has **not** been represented as repaired, regenerated or clipping-free. No paid generations were submitted during this checkpoint. The previous gameplay recording documents the older build.

Re-extracted Spare Key through the actual workbench and ran QA through its button: Latch now visibly fails the source-boundary check in the CMS. The previously published playable build is retained, not overwritten by failed-quality art. Evidence: `artifacts/combat-polish/latch-clipping-qa.png`.

Next art pass: regenerate the affected body actions with smaller reference occupancy, and create muzzle flashes / explosions as independent VFX with their own bounds, anchor and lifetime. Inspect the entire source video as well as exported key poses. Internal camera letterboxing, detached off-screen effects and unsampled motion can evade a simple boundary test. Audit existing roster sources before declaring the whole roster clean.

## What I would prioritize next

1. **Finish one excellent pair before expanding the roster.** Dedicated walk, jump, hurt, block, grab and recovery art; more selected motion poses where needed. Keep gameplay timing independent from the number of sprite frames.
2. **Readable, separated VFX.** Body / attached extension / projectile / impact / aura layers; effects never determine body scale or body hurtboxes. Add editable sockets and effect previews to the workbench.
3. **A proper move inspector.** Named controls for startup, active frames, recovery, damage, hitstun, blockstun, hitstop, knockback, meter cost and cancel rules. Show frame advantage and validate routes against actual spacing. The JSON editor is functional, not the final authoring UX.
4. **Measure loss of control.** Training-mode counters for time in hitstun, bind, knockdown and global hitstop; test repeated special pressure. Keep grabs visibly distinct from a brief interrupt, and consider diminishing returns or a resource-cost escape only if those measurements warrant it.
5. **Pixel discipline.** Agree on native pixel density and preferred integer presentation scales. Nearest-neighbor avoids blur but does not add detail; fractional zoom can produce uneven pixel widths. Never rescale each pose to fit an explosion.

## Verification

Regression coverage includes internal-cell clipping, neighboring video-cell ownership, retained global scale/pivots, export rejection, authored height/collision scaling, preserved melee reaction fields, short stun overrides, and real-engine attack interruption/recovery. Existing combo, form, movement, projectile, restart and workbench tests remain in the verification run.

Passed: production build (existing bundle-size warning), 30 TypeScript unit tests, 4 Python extraction tests, 26 browser checks across desktop/mobile (24 regression checks plus 2 editor validation checks), and CMS pipeline, QA, export (62 assertions), row generation and workbench-acceptance smoke tests. Desktop/mobile editor screenshots were inspected; the definition editor now fits its grid track. Legacy standalone CMS overflow elsewhere is not claimed as fully audited.
