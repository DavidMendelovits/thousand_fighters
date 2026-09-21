# Unified workbench audit — September 20, 2026

Scope: the current local draft workflow, primarily Palimpsest, at desktop and narrow mobile browser sizes. This is an implementation-backed audit, not a claim of production readiness or blanket art approval.

## Result

The supported entry point is `/workbench?character=palimpsest`. `/animation-lab` remains compatible and contains the same workbench plus a standalone clip library. Character-specific motion, move specifications, combo/projectile authoring, anchor/bounds editing, identity/forms, generation, release checks and history now operate on one selected draft. The engine viewers are embedded modules, not rewritten duplicate renderers.

## Findings and repairs

| Finding | Repair and evidence |
| --- | --- |
| Empty generic base/punch/grab/throw cards looked like missing Palimpsest animations. | Row cards now derive from authored bindings, moves, motion rows and active assets. Palimpsest has 20 groups, without those phantom cards. |
| There was no focused alternative to the long animation list. | Scrollable/focused toggle shares one animation selection with the motion viewer. View, row and workspace section survive refresh in the same browser session. |
| The old combat workspace inspected a published roster and defaulted to an archived fighter. | Combat/legacy links now enter the selected draft workspace. No separate stale combat data panel. |
| Large plans and job panels buried the animation editor. | Six workbench sections expose motion/moves, combos/effects, anchors/bounds, identity/forms, build/publish and history. Motion now has two honest, mutually exclusive views: one live preview plus one editor, or the complete scrollable move library without the duplicate preview. Mobile roster can collapse. |
| `comboRoutes` were absent from the CMS combo list; testbed routes were text-only. | Both combo formats are visible and previewable. Sequence plays complete moves; hit-confirm mode uses `MoveExecutor.tryCancel`, hit conditions, actor ownership and meter checks. Stops/misses are surfaced. |
| Anchor editing opened another page and omitted custom animation rows. | Same-workbench anchor editor, shared selected row, dynamic row navigation, saved-draft invalidation and retained unsaved edits across tabs. |
| Gym selected the first matching metadata/frame suffix, including archived revisions. | Active `assetRoot` now scopes frame metadata and images together. Regression test places stale metadata before active metadata and verifies the active custom row wins. |
| Gym was completely blocked below 1,100 px. | Responsive canvas/timeline/inspector layout, including numeric anchor edits on mobile. |
| HTTP tailnet generation could fail before admission because WebCrypto SHA-256/randomUUID require a secure context. | Portable SHA-256 preserves existing idempotency storage keys; nonce uses `getRandomValues`. Compatibility vectors and browser test cover missing `subtle`/`randomUUID`. |
| Starting/progress/error feedback was inconsistent or buried in Activity. | Immediate disabled/loading actions, inline row/reference status, bounded durable-job requests, and a persistent dismissible error notice. Section generation actions guard duplicate clicks. |
| Hidden previews could continue playing; selecting another view could discard anchors. | Pause hidden viewers, preserve Gym document across tabs, warn before destructive refresh/navigation, reload other previews after a successful Gym save. |
| Testbed keyboard capture consumed arrow keys intended for the distance slider. | Editor input events no longer reach gameplay handlers; verified Home → ArrowRight changes 40 to 42. |
| Source labels always claimed fal Kling and six poses, irrespective of lineage. | Removed fabricated provenance labels; retained actual source video and History. |
| Published-fight shortcut requested an archived Brine opponent. | Shortcut now uses the selected published character for both fighters. |

## Verification

- `npm run build` and `npx tsc --noEmit` passed. Existing large Phaser chunk warning remains.
- 32 desktop/mobile browser regressions cover the real draft interface, current-row geometry, focused/scroll views, refresh persistence, preserved edits, combo execution, visible failure states for all four generation entry points, durable generation/reload, deduplication, move tuning, library/archive behavior and version-bound publish review.
- 27 focused Node/TypeScript tests cover active-revision Gym loading, library/review contracts, durable build jobs and portable submission keys.
- Gym save smoke: 18 checks, including storage reread, converted collision parity and partial save failure. Combo smoke: 16 checks.
- The live Palimpsest audit suite intercepts **all writes**. Its anchor Save check verifies the UI/request contract with a controlled response; actual persistence is verified separately by the isolated Gym smoke test. No Palimpsest draft/assets were changed by tests.
- Durable-job browser fixtures execute the real server, storage and extraction against controlled image output. They do not measure paid provider performance or art quality.
- Agent-browser recording: actual UI actions on the existing Palimpsest draft. Anchor adjustment undone; no live save, generation, approval or publication. The encoded 21.4-second MP4 was opened and played in-browser, including combo playback and the final History view, with no playback error. See `/artifacts/studio-audit/`.

## Still open — do not confuse working UI with accepted content

- Palimpsest's current motion approvals include unversioned/stale reviews. Retained source identity/edge contamination and needle/contact continuity still need targeted art review. This change does not approve or regenerate those assets.
- A successful cancel preview is not a proof of uninterrupted hitstun or matchup balance. The 80 px route makes three contacts; the 120 px first jab misses and the strict route stops. Add frame-by-frame escape-window and matchup assertions before calling routes guaranteed true combos.
- Advanced identity/combat/forms authoring still includes JSON. Spatial anchors, hurtboxes, hitboxes and guard bounds have a visual editor; a general timed victim-socket/grip-path editor remains roadmap work.
- Combo authoring now creates a stable custom row for every described follow-up, marks those moves cancel-only with an explicit predecessor, and replaces its owned moves idempotently when re-authored. The authoring request itself is still synchronous, but the resulting rows use the durable, provider-selectable motion build path. Projectile generation and the text-authoring request still need full durable-job migration before claiming every generation path is disconnect-safe.
- Palimpsest's `Living Margin` route is the first production-shaped example: Ribbon Flick opens into two moves unavailable from neutral (`Margin Crossing`, then `Crown From Below`). Both have versioned 20-frame Pruna rows and complete a three-contact engine-validated cancel route at 40 px. Their motion reviews remain deliberately unapproved pending final art direction.
- A completely new complex character created, reviewed, published and played entirely through the browser remains the end-to-end acceptance milestone. This recording repairs/reviews an existing character, not that milestone.
- Authenticated public CMS deployment, worker/storage architecture and physical-phone memory profiling are separate production gates. This turn verifies local web operation, not a new deployment or EAS build.
- Lost-response idempotency is scoped to the browser origin. Changing between localhost and a tailnet hostname creates separate browser storage; inspect the server's Build activity before starting replacement work.

## Repeat the audit

With Vite and CMS running locally:

```sh
ADMIN_BASE_URL=http://127.0.0.1:5173 STUDIO_BASE_URL=http://127.0.0.1:5173 npx playwright test tests/studio-audit.spec.js tests/unified-studio.spec.js tests/build-jobs.spec.js tests/publish-readiness.spec.js tests/workbench-motion-tuning.spec.js
npx playwright test tests/admin-cms.spec.js tests/workbench-library.spec.js
npx tsx --test tests/gym-active-revision.test.ts tests/workbench-library.test.ts
node --test tests/submission-key.test.js tests/build-jobs.test.js
npm run cms:gym:smoke
npm run cms:combo:smoke
```
