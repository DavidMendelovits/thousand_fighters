# Hands: edge refinement and interaction stress tests

September 20, 2026. **Draft candidate; changes requested, not published.**

## Watch

- [Evidence player](index.html)
- [Real engine drills](stress-drills.mp4): 42.4 seconds. Left wall, right wall, injected six-tick hit, forced summoner KO, accelerated expiry. Actual testbed buttons, Slow mode and a Reactive Palimpsest mirror dummy. The injection cases pause briefly while choosing the test control. Not a competitive match or generated fight movie.
- [Workbench reprocess](workbench-refinement.mp4): 50 seconds, uncut including actual checkpoint waits and final success. One reprocess, zero provider requests.
- [Matched edge comparison](edge-comparison.png), [all 20 poses](contact.png), [mobile controls](controls-mobile.png), [saved review](review-saved.png).

Both recordings use agent-browser. The live candidate installation and review submission went through the UI, not API/file mutations. Independent test fixtures use direct setup writes. `record-drills.mjs` reproduces the UI drills; it only modifies the distance input through DOM events. Its hit/KO/expiry actions click the same labeled controls available to a user. Earlier capture attempts missed scene readiness; they are retained outside this delivery in `generated/hands-stress-failed-captures/`.

## Pipeline changes and result

The pale speckling exists in the transparent isolated-hands reference **before** video generation. The prepared white-background reference hides it; the video carries it forward. Another generation from that reference would not be a reliable correction.

Added opt-in **Refine pale boundary pixels using nearby paint colors** to the existing offline workbench reprocess. The compiler estimates alpha only where a nearby foreground color explains a boundary pixel as a mixture with the flat background. It preserves foreground cores and leaves incompatible colors alone, then removes background RGB contribution. No hard erosion, new imagery, per-pose fitting or component deletion is introduced. Thin grey props, lavender and intentional pale areas still require visual inspection; this is not a universal matte solution.

The exact source remains frames 0–64 of 124; output remains 20 unique poses, zero reported clipping, fixed root, expanded canvas and shared scale 1.5537190082644627. Contact/recovery remain poses 8/13, with held poses 8–12. Collision timings are unchanged.

`compare_paint_edges.py` measures matching frame sets and creates matched-crop review boards. Across 20 poses, the heuristic pale-edge alpha coverage fell from 3636.12 to 676.39 (**81.4%**). Total alpha coverage fell about 2%. This measures a narrowly defined class of pale boundary pixels; legitimate paint can match it. It is not a quality gate, and the remaining bright wrist speckles are visible.

## Engine and acceptance

The held-grip sampler previously never reached its final authored pose. It now samples the inclusive interval, including its endpoint before release (short multi-tick holds included). Existing reviews for actor-grip moves become stale under this playback revision; ordinary row fingerprints remain unchanged.

The testbed now exposes center-left/right and both wall placements, summon/hold tick readouts, and explicit interruption/KO/expiry controls. Reset preserves selected spacing and size, restores facing and clears intervention state. Controls do not edit the saved fighter. The injected hit routes through the real resolver, KO through the real state transition, and expiry through the next normal simulation tick.

| Check | Current-draft result |
|---|---|
| Facing right / left | Captures and naturally releases |
| Right / left wall | Captures and naturally releases; attachment follows the constrained victim |
| Six-tick injected hit while holding | Summon removed, victim freed |
| Forced summoner KO while holding | Summon removed, victim freed; Reset restores health |
| Timer set to one while holding | Next simulation tick expires summon and frees victim |
| Mobile KO/reset and layout | Browser check passes; 390px control screenshot inspected |

These are same-character mirror checks at normal size. The preceding slice recorded 70/100/140% scaled mirrors. Neither establishes anatomical contact against different fighter bodies. This slice did not change the planar sprite-splitting occlusion model, generate victim poses, or solve the recovery/idle handoff.

## Lineage and measurements

- Source SHA: `5785d3e25c8f0f48943215ed0ee35ee66c4de3ceac474d55a845cb30e8cae5d1` (same retained Pruna source; no new attempt).
- Reference SHA: `1e47f308072a2ee0db4408a495f0bfe702ce6dfadb0fdb00975a01f19a193d31`.
- Compiler SHA: `f61261708d5f65ff62918df80a5d4196f3d96cf8c48f35a90f7f87bb62ca28f3`.
- Before checkpoint: `2026-09-20T05-24-13-968Z-709d6d63-cb52-48e4-82be-ba05f35f3344`.
- After checkpoint: `2026-09-20T05-24-32-196Z-e152733c-85ed-4682-9c84-eb0a889a014e`.
- Working root: `characters/palimpsest/assets/revisions/b6ed3277-b4df-46ba-92e3-42f2959485ac`.
- [Reprocess event](reprocess-event.json): `2026-09-20T05-24-40-747Z-c80451a0-3551-4f0b-8901-785b36c5c686`; links the retained prior source artifact.
- Compile **13,370 ms**, full history operation **40,736 ms**, provider requests **0**. One local sample with other checks running, not a controlled speed comparison or provider average.
- Final saved review: **changes requested**, fingerprint `63f7a0b886a98022e1902f8fc0d97e41334b60710f7adfd627f38c3efb3fa0c5`. Readiness confirmed **0/20 current approvals**, publishing blocked.
- Compiled candidate: `artifacts/workbench-video-jobs/reprocess-SklUvW/compiled`. Complete versioned assets remain in local CMS storage. Off-machine backup is not verified.

## Verification and next checklist items

64 focused checks passed: 23 pipeline/history Node tests; 12 release/readiness tests; 9 Python matte/component tests; 3 TypeScript grip/layout tests; 2 desktop/mobile workbench tests; 7 current-draft grab cases; 1 mobile current-draft KO/reset case; 7 existing published-game regressions. The workbench payload tests mock the repair HTTP response; the Node actual-video test and recorded UI run do not. TypeScript, production build and CMS full-flow smoke passed. The existing large-bundle warning remains.

Encoded MP4 filmstrips inspected, including the final workbench success frame. Both final MP4s played to completion in-browser without media errors. Desktop and mobile controls inspected, with no horizontal overflow. The normalization skill guided conservative matte/shared-scale checks; sprite/action guidance kept paired contact separate from single-row quality; browser/walkthrough guidance required actual UI recording and encoded-video QA.

ART-03/04/06 and PIPE-06 advanced; not complete. Next: correct and version the isolated hands identity reference in the workbench, then make one targeted continuity candidate only if needed. Review needle orientation, closure and exact idle handoff; verify contact with different body types before approval. ART-02 and CREATE-07's completely new fighter, generated/reviewed/published through the browser, remain open. Do not bulk-generate the remaining roster around a contaminated reference.
