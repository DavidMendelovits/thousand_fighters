# Offline hands repair and size drills

September 20, 2026. Current draft only; **changes requested, not published**.

## Watch

- [Evidence player](index.html)
- [Workbench reprocess](workbench-reprocess.mp4): 32.1 seconds, uncut UI recording including the real checkpoint wait. Success is visible in the last frame.
- [Three-size engine drills](size-drills.mp4): 29.1 seconds, uncut testbed recording. Normal 100%, small 70%, large 140%, in that order. Slow playback, training move buttons and a Reactive dummy. These are real runtime capture/lift/release interactions, not generated gameplay or a competitive match.
- [Contact sheet](contact.png), [compiler report](motion.json), [desktop controls](controls-desktop.png), [mobile controls](controls-mobile.png).

The workbench action used agent-browser. No direct API mutation or filesystem replacement was used to install the live candidate or submit its final review. API/storage reads verified the result afterward. The independent test fixtures do use direct setup writes.

## Delivered pipeline changes

Video-backed move cards now expose **Reprocess saved video · no generation**, replacing the misleading legacy six-pose Re-extract action for those rows. Controls cover a continuous 0-based inclusive source interval, 8–48 output poses, looping, paint soft-edge cleanup, and 1-based contact/recovery poses. Held-grab poses are remapped to that contact/recovery interval. Invalid ranges and stale draft/source versions are rejected.

Paid generation and offline reprocessing share actor-reference and style/key/root/canvas settings. Summoned hands cannot silently use the body reference. Source discovery follows the row's SHA across paginated character history. Archived bytes are integrity checked. The compiler does not import a provider transport or need a key.

Compilation succeeds before any draft assets change. A frozen safety version is materialized into a private working root; frames and metadata are installed there, then the draft is switched. A second checkpoint pins the result. Prior roots, published files and source bytes remain intact. New motion always needs visual review. Compiler options, reference/source hashes, selected frames, stage timings and parent event are recorded.

Paint cleanup decontaminates partial-alpha edge RGB only. It does not erode the mask, remove opaque lavender/grey pigment, or discard disconnected hands/props. It **does not** fix opaque baked-in fringe or invent a better recovery pose.

The testbed adds 70% / 100% / 140% dummy-size controls and size/state readouts. The dummy gets its own configuration; size affects its rendered art and collision, not the player or saved draft. Changing size resets the drill; Reset preserves the selected distance.

## Live result and lineage

- Reused provider source SHA: `5785d3e25c8f0f48943215ed0ee35ee66c4de3ceac474d55a845cb30e8cae5d1`.
- Original provider request: Pruna `p-video-2-pro`, `fja38mqvw5rmr0d0qkybez1rgr` from the preceding task. **No new image/video attempt this turn.**
- Parent video event: `2026-09-20T04-06-58-789Z-a1fb6939-0f32-4597-96c5-1d00a3c25a93`.
- Isolated hands reference SHA: `1e47f308072a2ee0db4408a495f0bfe702ce6dfadb0fdb00975a01f19a193d31`.
- Source interval: 0–64 of 124 decoded frames; 20 unique output poses, no clipping, fixed root, expanded canvas, one shared reference scale.
- Contact: pose 8 / active tick 11; recovery: pose 13 / tick 16. Held poses: zero-based 7–11. Collision timings unchanged.
- Compile: **4,984 ms**. Full reprocess history operation: **25,465 ms**. Provider requests: **0**. This is one local measurement, not a provider-speed average.
- Before checkpoint: `2026-09-20T04-52-07-070Z-5ed81b2f-15b8-42d1-835c-2791f72e0150`.
- After checkpoint: `2026-09-20T04-52-20-944Z-d76a0d71-1720-4271-806d-d94c0c9b36fb`.
- Working root: `characters/palimpsest/assets/revisions/8cdd6432-7ed8-4235-9447-f2638e9acb29`.
- Reprocess event: `2026-09-20T04-52-27-422Z-cf51d245-2fb0-46eb-9772-dca12e795c47`.
- Saved review fingerprint: `c63d68f4c514177811ff0f0080be6b61bb5d8456f22393ce6708b5862b9fde37`.
- After-review checkpoint: `2026-09-20T04-57-17-776Z-886aeab0-84b4-4454-a2df-d6258d0b3ee9`.

The complete candidate is in local CMS storage and `artifacts/workbench-video-jobs/reprocess-tTmfdc/compiled`. This evidence folder retains the report and contact sheet; it is not a replacement for backing up the full local CMS archive. Off-machine backup remains unverified.

## Verdict and next checklist items

The selected interval removes the late face-on lower-palm rotation. Both hands and the needle remain visible in the extracted row. All three scaled-mirror drills capture, lift/swing with the victim, and release without a stuck hold. The small case shows the palm overlap most clearly; the large case still needs visual contact polish.

**Not approved:** pale jagged source-edge contamination remains, the needle changes angle during closure, and the final pose is not an exact idle-reference match. The final feedback was saved through the browser. No published pack was changed.

Next: inspect source/reference opaque-edge contamination without erasing the needle; improve the idle/attack handoff and contact silhouette; verify left-facing, wall, interruption, KO and expiry cases with different body types. If the source cannot satisfy continuity, request one explicit targeted generation with the saved feedback. ART-02/03/04/06 and PIPE-06 have progressed, not passed overall. CREATE-07's complete new-fighter browser journey remains open.

## Verification

- 23 focused Node tests passed: actor/reference settings, input/stale validation, actual-video compilation, paginated source lookup, checkpoints, original-root preservation, no provider ledger entry, and failed compile/private asset-write isolation.
- 7 Python motion-component tests passed, including alpha preservation and opaque lavender/grey-needle protection.
- 2 Playwright cases passed (desktop/mobile): repair controls, validation, payload, disabled legacy extraction, and existing move-timing/provider persistence. The repair HTTP response is mocked in these two UI tests; the Node test and recorded live run exercise the actual compiler.
- TypeScript, production build and CMS full-flow smoke passed. The existing large bundle warning remains.
- Desktop and 390px mobile screenshots inspected; no horizontal overflow. Capture probe checked first. Encoded MP4 filmstrips inspected across each clip, including the workbench final success frame. Both final MP4s played to completion in a browser without a video error.

The sprite/action and normalization skills guided identity, component and shared-scale preservation. The UI-polish and visual-loop skills guided responsive controls and error states. The walkthrough/agent-browser skills guided real UI capture and final-video inspection; no art was auto-approved by those checks.
