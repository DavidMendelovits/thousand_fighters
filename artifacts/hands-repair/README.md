# Palimpsest hands correction attempt — September 20, 2026

One real Pruna generation, followed by workbench tuning and live engine testing. **Candidate rejected for further changes; not published.** This is an existing-character revision, not completion of the new-character acceptance milestone.

## Watch

- [Browser player](index.html): serve with Vite and open `/artifacts/hands-repair/index.html`.
- [Live current-draft grab test](live-grab.mp4): 11.8 seconds. Training move buttons summon the hands, capture/lift/throw a reactive Palimpsest dummy in Slow mode, then switch to normal playback. Eight initial loading/idle seconds are trimmed; the action itself is not time-compressed.
- [Workbench tuning and paired test](workbench-tuning.mp4): 129.4 seconds, uncut. Select provider, edit visual contact/recovery and held poses, save, inspect the active marker in the shared viewer, then test in the embedded current-draft testbed.
- [Original paid-generation browser recording](workbench-attempt.webm): 389.3 seconds, uncut, including provider/checkpoint waits and inspection pauses. This precedes the stale-thumbnail and provider-selection fixes.
- [Saved changes-requested verdict](workbench-verdict.webm): 42.8 seconds, uncut, including checkpoint wait.
- [Provider-generated source](provider-source.mp4), **not gameplay**; [20 extracted poses](contact.png); [attempt ledger](provider-attempt.json).

All screen recordings are actual browser use, not synthesized footage. The two MP4s are H.264, 1440 × 1100, 10 fps, without audio. Both were played through to `ended` in Chromium without media errors; encoded frame counts are 118 and 1,294. The long recording was replayed at 4× for QA, not encoded at that rate. Encoded contact sheets were inspected: [live test](live-grab-contact.jpg), [workbench](tuning-contact.jpg). Full-screen playback is best for reading the inspector.

## What this changed

- The edited action brief now wins over a saved/default paint recipe. Prior review feedback remains attached once. The submitted checkpoint was checked to contain the actual edited brief.
- Actor motion uses an isolated summon reference and brief, not the fighter body. The submitted reference bytes match `fighter-pack-paint-v1/sprites/hands_idle/hands_idle_001.png`.
- After this attempt, the generic paired-grip wrapper was clarified to keep its center fixed for the engine-controlled lift/swing. That clarification has unit coverage but has not bought another provider attempt; the original submitted prompt remains in its job checkpoint.
- Visual contact/recovery pose controls reuse the same retimer as motion installation. Changing damage alone preserves non-linear authored timelines. Scheduled gameplay ticks do not change when retiming poses.
- Saving shows checkpoint progress and disables repeat saves. Preview/readiness reload after the save.
- Thumbnail rows follow current frame metadata, including actor rows. Superseded PNGs remain in storage/history but no longer leak into the preview.
- The selected provider survives rerenders. Video reference accounting uses the actual actor reference and does not falsely report a missing fighter base sheet.

## Visual verdict

The new row retains two hands across its 20 poses and passes the frame-edge clipping check. In the workbench we changed contact from the automatically suggested open/recovery area to **pose 5 at tick 11**, recovery to **pose 8 at tick 16**, and the held interval to **zero-based frames 4–6**. The Reactive testbed visibly captures, lifts and releases the opponent.

It is still **changes requested**. White/pale fringe remains visible on dark backgrounds. The lower palm rotates face-on during recovery instead of returning coherently to the idle reference, and the needle changes angle during closure. Contact occlusion/alignment needs more work and testing on differently sized opponents. This was a mirror test using training buttons, not keyboard-combo acceptance, a competitive match, or roster-wide visual approval. The character remains at **0/20 current motion approvals**; earlier unversioned reviews are not silently accepted.

Next: a full-motion, no-provider-cost reprocessing branch from the retained source, with matte cleanup and a reviewed release/recovery interval. The existing legacy six-pose Re-extract action is not equivalent. Only buy another candidate if the source cannot satisfy the visual contract.

## Generation accounting

Provider/model: `pruna / p-video-2-pro`. One submission, request `fja38mqvw5rmr0d0qkybez1rgr`. No image generation, additional video retry, or publication in this pass.

| Measured stage | Time |
| --- | ---: |
| Reference upload | 1.308 s |
| Prediction submission | 0.321 s |
| Provider queue and generation | 117.653 s |
| Result lookup | 0.230 s |
| Download | 0.616 s |
| Complete transport invocation | 120.321 s |
| Sprite composition/installation | 8.780 s |
| Complete video adapter | 129.596 s |
| Complete generate tool, including checkpoints | 143.828 s |

Durations are nested, not additive. No provider cost/usage was returned: cost remains **unknown**, not zero. Benchmark success means transport succeeded, not that visual acceptance passed. The later tuning and review tool runs took 12.939 s and 13.467 s respectively, including their checkpoints.

## Recoverable local lineage

The original video was read back from its immutable SHA-256 archive and verified (729,254 bytes):

`5785d3e25c8f0f48943215ed0ee35ee66c4de3ceac474d55a845cb30e8cae5d1`

Local job: `artifacts/workbench-video-jobs/4486acf4-3680-4a25-a5ba-f24ede0522bb`, with source MP4, request/checkpoints and `motion-v2/`. Current working assets remain under `cms-data/characters/palimpsest/assets/fighter-pack-paint-v1/`. The published pack was not modified.

| Checkpoint | Version ID |
| --- | --- |
| Before generation | `2026-09-20T04-04-43-526Z-bd17ffba-e109-40c0-b23f-57781ee5e3cf` |
| After generation | `2026-09-20T04-06-58-814Z-e1664de3-17d4-4cf6-b06e-354d9bae3e23` |
| Before tuning | `2026-09-20T04-14-30-678Z-f1fb9fe2-dd2d-4c63-a0a3-f9d19275158d` |
| After tuning | `2026-09-20T04-14-38-043Z-68627d47-0922-451f-a34b-b16b48006ef7` |
| After final review | `2026-09-20T04-18-45-547Z-5d95918b-d091-41c4-b76e-68d52db22c5f` |

Final inspected fingerprint: `02518382f1b7cb8e5940235230d2bbdcf42f2e29daf2cf64d6ea8e81817bd0c5`.

These checkpoints and blobs are local CMS storage, not a newly verified off-device backup. This evidence folder additionally preserves the source MP4 and sanitized attempt record in Git; it does not contain the entire CMS archive.

## Verification

- 61 focused unit/integration tests passed: prompt precedence, SSE completion, retiming, geometry, approval invalidation, asset filtering, and lineage/recovery.
- Four desktop/mobile browser tests passed: repeated saves, provider retention, current thumbnails, preserving custom timelines, retiming and version-bound review/rejection.
- TypeScript, production build and CMS full-flow smoke passed. Existing large Phaser/runtime chunk warning remains.
- Real provider attempt and recorded UI tuning verified separately from isolated automated fixtures. No automated test spent provider credits.

The `action-sprite-game-generator` and `normalize-sprite-sheets` skills informed the actor/contact/clipping acceptance checks. `agent-browser` and `create-walkthroughs` drove the actual interface recording and encoded-video verification. They did not substitute visual approval with an API-success result.
