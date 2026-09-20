# Palimpsest motion review — September 19, 2026

Recorded browser workflow, not generated footage, a playable demo, or a new-character creation run.

- [Watch the MP4](palimpsest-review.mp4) — 41.9 seconds, 1440 × 1100, no audio.
- [Browser player](index.html) — serve the repository with Vite, then open `/artifacts/motion-review/index.html`.
- Original recording: `palimpsest-review.webm`.

## Recorded actions and verified outcome

| Approximate time | Visible action and result |
|---|---|
| 0–4 s | Palimpsest hands pinch in game timing, with authored phase/contact markers and a 46-tick timeline. |
| 4–11 s | Switch to all extracted poses, scrub the source sequence, and inspect the needle/hand continuity problem. The source sequence is 72 extraction ticks, not source-video duration. |
| 11–16 s | Enter specific corrections and confirm inspection, then request changes. |
| 16–37 s | Real checkpoint/save wait, retained in the recording. No provider call occurs. |
| 37–41.9 s | Reopen the review; saved notes remain on the current row. |

The MP4 was played in the browser to its end (419 decoded frames, no media error); changed motion and final saved feedback were inspected. An encoded contact sheet covered the recording, not just a live-app screenshot. Readability is best in full screen. The visible save wait is actual latency, not a frozen or omitted generation.

## What changed

- CMS move previews and gameplay now share visual-frame selection. Variant/phase timing is preserved rather than spreading source frames over a different duration.
- Game timing and all-extracted-pose inspection are separate controls. Interactive grabs, hitstop, cancels and movement still require the live testbed.
- Fit artwork frames all poses with a stable camera, preserving transparent source margins and pixel data.
- Request changes is a version-bound, restorable review decision. Current feedback blocks publication and reaches the next explicitly requested image/video attempt.
- Owned dash/summon idle rows are included in coverage. Review fingerprint version 2 invalidates older preview-contract approvals.

## Real saved review

`hands_pinch`: needle detached in extracted pose 3; third hand in pose 8. Require two continuous hands, a visibly pinched needle, stable empty torso space, and closure/lift/release without baking an opponent into the actor pass. Reinspect both the revised row and the paired grab in the testbed.

- Row fingerprint: `2d3f70364d82397c6e57fabf25d7dd9303daad7bc3f024ade69ab8a4c8a36b38`.
- Before checkpoint: `2026-09-20T02-51-20-101Z-60cc7b03-2a49-455d-aa49-1ef3eab6f372`.
- After checkpoint: `2026-09-20T02-51-32-698Z-a4caa95b-5df1-4e4b-90b8-8287e02a789f`.
- Lineage comparison: only `motionRows` changed; all 546 assets unchanged.
- Current readiness: 0/20 approved, `hands_pinch` changes requested, publication blocked.
- Checkpoint IDs use UTC; recording date above is local New York time.

## Verification and limits

Passed: **138 unit/integration tests**, **14 desktop/mobile browser checks**, TypeScript, Vite production build, and CMS full-flow smoke. The two review browser cases were rerun after the narrow-toolbar fix, with nested-overflow assertions.

Automated checks use isolated fixtures, not paid providers. Tests cover review/runtime tick parity, legacy export normalization, variants, event markers, current/stale feedback, approvals, publication blocking, and prompt feedback. Desktop/mobile browser tests cover the review workflow and the Animation Lab, including the nested preview viewport. A 390 px live review exposed a clipped zoom selector; the narrow embedded toolbar now wraps and dense markers expose their full labels on selection instead of overlapping. TypeScript, the production Vite build and the CMS full-flow smoke test pass. The existing large runtime-bundle warning remains.

No character images or videos were generated, no artwork was edited, and no release was published. This is not exhaustive visual acceptance of the roster. Provider quality after applying corrections, the revised hands art, opponent contact/occlusion and the complete new-fighter browser-to-match journey remain unverified.
