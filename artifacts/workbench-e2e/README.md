# Latch: actual workbench acceptance run

Recorded on September 16, 2026 using agent-browser. Latch was a new character, created through **New Fighter**. No prebuilt character was uploaded or copied into its draft. Character-specific changes were made through workbench controls, including the character-definition editor. Read-only inspections and regression tests supplemented the UI run.

## Watch and try

- `latch-workbench-to-fight.mp4`: edited actual UI recording, all footage at normal speed. Provider waits and implementation/debugging gaps are cut and disclosed onscreen. `edit-map.json` identifies every original segment and timestamp.
- `review.html`: chaptered player for the same encoded video.
- `07-live-fight.webm`: uncut, real keyboard-controlled Latch versus CPU Brine. Both fighters take damage. This is not a video model imagining a fight.
- `08-final-input-proof.webm`: uncut jump and projectile check with CPU off. Brine drops from 1080 to 1015 health.
- The other numbered WebM files are raw creation, generation, review, debugging, and publishing takes. Earlier takes intentionally retain bugs discovered and subsequently fixed; they are not all final-state demos.
- Studio: http://127.0.0.1:5173/animation-lab.html?workspace=characters&character=latch
- Game: http://127.0.0.1:5173/?p1=latch&p2=brine

## Delivered character

Latch is a purple hermit-crab locksmith with a brass key claw. The published pack contains 30 transparent fighter frames: six base poses plus four six-pose attack rows. Key Jab is F, Boot Sweep is G, Vault Breaker is H, and Spare Key is Down then H. WASD moves/jumps. The projectile is an independent sprite and entity with its own damage, stun, knockback, and impact effect.

The base is image-generated. **All four attack rows came from actual fal Kling image-to-video jobs**, anchored to the same extracted base frame. Their source MP4s, provider metadata, and durable job records are retained. The workbench Source tabs expose the motion videos. The current compatibility path samples six key poses from each five-second source; it does not export the entire video at 30 fps.

## Gaps repaired by this run

- Exposed video motion as a per-row generation option, preserving provider provenance and source playback.
- Changed the default normalizer from fixture copying to real contour extraction.
- Preserved the full original visual brief and included character-specific move descriptions in default prompts.
- Added a character-definition editor and **Re-extract** controls, so tuning and cleanup do not require another paid generation.
- Video extraction uses one reference pivot and one global scale; a kick effect no longer pulls the fighter's pivot sideways. Nearest-neighbor scaling preserves pixel edges, and connected video chroma spill is removed without globally deleting purple interiors.
- Serialized extraction merges to protect the shared manifest when rows finish together. Duplicate in-flight video requests are rejected; uncertain saved jobs are not silently replaced by another paid job.
- Extraction/export failures now surface as failures. A failed Codex subprocess no longer leaves chat unresolved forever.
- Normalized jump magnitudes, corrected Latch's projectile spawn through the UI, and retained short direction/jump taps between simulation ticks.
- Cleared scene-owned keyboard handlers on shutdown to avoid stacked handlers after restarting.
- Generated projectile textures now respect authored display dimensions, not the source PNG's native resolution.
- QA checks draft-declared projectile assets, including those not listed in the old manifest projectile section.

## Acceptance evidence and limits

- UI creation, base generation, four video requests, independent projectile generation, extraction, definition editing, QA, publishing, and opening the published fighter were recorded.
- Actual keyboard tests verified jumping, projectile contact/damage, melee hits and a two-hit sequence. A separate live CPU fight verified damage in both directions. Gameplay footage did not invoke training/reset-state hooks or inject damage.
- Final metadata QA: **12 checks passed, 2 warnings, 0 errors**. The remaining warnings concern the rising uppercut's varying local anchor Y on variable-height frames and normalization/rescaling notes. They are visible in the video; this is not a zero-warning claim.
- The pivot now stays fixed in source-video coordinates, but automated metadata checks do not certify artistic quality. Video can still change details, add effects, or turn the character during wind-up. Human pose review remains necessary.
- This is a functioning initial pack, not a complete production animation set: walking/jumping/hurt states currently use base fallbacks, the attacks have six sampled poses, and no new transformation or sound pack was authored for Latch.
- The record/QA skills required actual encoded-video inspection and gameplay verification. The sprite-normalization skill drove fixed-pivot/global-scale handling rather than fitting every pose independently.

## Verification

Final results: `npm run build` passed (existing large-bundle warning); **22 browser tests, 23 combat/input unit tests, and 2 Python extraction tests passed**, plus the CMS creation/export/row/video/workbench smoke tests. The workbench smoke test includes a real failing subprocess and makes no billable provider calls. The gameplay browser test uses the published Latch artifact and real keyboard inputs. The restart test waits for the new scene and uses physical-duration key presses; earlier zero-duration/too-early mobile test attempts were unreliable and were corrected before the final passing run.

The final video is H.264 at 1440 x 1072, with a caption strip added below the captured viewport. It was decoded with FFmpeg, inspected across the edit, and played/seeking-checked in the chaptered browser player. No credentials appear in the capture.
