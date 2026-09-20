# Workbench review integration — September 19, 2026

Watch `workbench-review-demo.mp4`: 52.4 seconds, H.264, 1440 × 1000, silent. Actual agent-browser operations in the local CMS, edited to omit idle waits. No synthetic interaction or generated fight footage. The source takes are retained alongside it.

## Recorded beats

| Time | Action and visible result | Checked |
|---|---|---|
| 0–6 s | Review the complete, uncropped Skein reference; save rejection notes and see REJECTED replace UNREVIEWED. | Pass |
| 6–16 s | Archive three empty test fixtures. The draft count drops; archived count rises. | Pass |
| 16–29 s | Pause/step Palimpsest's current draft in the shared motion viewer; change background and inspect timing. | Pass |
| 29–33 s | Switch to the separate needle-thrust hands row. | Pass |
| 33–52 s | Use the embedded live testbed, trigger Ribbon Flick, then Borrowed Hands; see the hands entity and control timer. | Pass |

Cuts skip waits and navigation; they do not measure generation speed. The preview supports Fit and native zoom. Native zoom can exceed the viewport; use Fit to see the complete canvas. This is a review/testbed demonstration, not a full match or a completed new-character creation run.

## Changes and verified state

- Reference art is one proportion-preserving image, no invented front/profile/back slices. Review status and notes refer to exact image bytes. Replacing formats or restoring a branch resolves the same active reference in the viewer and generation pipeline.
- Rejected current identity references prevent new row-generation submissions. Replacement images become unreviewed; existing assets remain intact.
- Library: 13 animated entries, one unfinished draft (Skein), three archived fixtures. Animated means frames exist, not that the fighter has complete or approved coverage. Archive is reversible and deletes nothing.
- Motion preview uses the current CMS sheet, authored timing, anchors and summon identity. Variable-size legacy frames are padded and pivot-aligned; modern fixed-canvas video frames retain their geometry. Missing source timestamps are labelled TIME UNKNOWN.
- The embedded testbed reads the current draft. Empty drafts cannot masquerade as playable fighters. Published copies are separate links.
- Default browser tests use disposable storage and mock generation with provider credentials removed.

## Verification

- 33 focused tests: workbench library/reference handling, advanced creation contract, combat geometry, Palimpsest export, material generation and motion pipeline.
- Nine browser checks: seven desktop and two mobile, including reference rejection/reload and archive/restore. No horizontal overflow at a 390 px viewport, including the embedded viewer.
- TypeScript, Vite production build, CMS full-flow smoke and diff whitespace checks pass. Existing large-bundle warning remains.
- `npx tsx scripts/audit_workbench_previews.mjs`: 157 rows, no geometry/schema failures. This does not assess every pose's visual quality.
- Final MP4 inspected across its duration using decoded contact sheets and actual browser playback, including reference, frame stepping/background changes, hands preview and live summon. The player decoded 1,138 frames during the playback/seek check. No credentials appear in the inspected recording.

## Still open

Skein's source art is inconsistent and was rejected, not regenerated. Legacy fighters still need per-row visual and gameplay review; no blanket approval was applied. Full reference-to-published-match creation acceptance remains open on the product roadmap. No paid image or video generation was performed for this repair.
