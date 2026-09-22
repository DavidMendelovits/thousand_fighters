# Unified workbench engineering checkpoint — 2026-09-22

Implementation of the approved engineering review, based on `a3ea6fb`.
This is a local implementation checkpoint, **not a production/mobile release**.

## State-backed checklist

| Task | Status | Evidence / remaining gate |
| --- | --- | --- |
| T1 Baseline and reproduce combo failure | Completed with baseline limits | Unit baseline: 192/194; two outdated ledger mocks. Broad browser baseline: 99 passed / 47 failed / 20 skipped; current: 127 passed / 23 failed / 28 skipped. All current failing test names also failed in baseline; see limitations below. Sequence reproduction stopped before the first exclusive follow-up. |
| T2 Single-owner workbench session | Implemented | `WorkbenchSession` owns state, navigation, selection tokens, aborts, named feature scopes and document disposal. Repeated mount/remount tests cover listener cleanup. Legacy rendering functions live in `workbenchApplication.js`, not separate competing controllers. |
| T3 Trusted preview protocol | Implemented | Origin + source + navigation token handshake; commands wait for ready. Same-origin and standalone CMS cross-origin tests reject stale/forged events. |
| T4 Focus / All moves | Implemented | One selected animation and corresponding editor, or the complete scrollable collection. URL selection → remembered valid move → actionable row → safe fallback. |
| T5 Palimpsest migration | Activated locally | Canonical `draft.combos`; legacy route field removed only from Palimpsest. Backup and guarded rollback available. Archives and published versions preserved. |
| T6 Combo-exclusive playback | Implemented | Full three-step sequence includes exclusive rows; hit-confirm uses legal engine cancels, completes at close distance and stops on a whiff. Neutral controls do not expose combo-only moves. |
| T7 Restart-safe single worker | Verified locally | Durable stages, known-task/source recovery, kernel-lock ownership and graceful drain. Unknown provider acceptance stops for explicit resolution, never auto-resubmits. Backend tests cover helper death and concurrent takeover. |
| T8 Indexed heads and status delivery | Implemented | Indexed heads/attempts, replayable revisioned SSE, shared UI subscription per job, polling fallback, terminal/reordered-event tests. |
| T9 Phaser core / budgets | Implemented, release gate open | No Matter/Arcade; automated 250 KB gzip budget. Desktop/mobile-emulation renderer smoke passes. See performance report; physical-phone measurements are still required. |
| T10 Local verification complete; release gates open | Local checkpoint verified | Focused suites and paired desktop performance gates pass. Broad-suite limitations, physical-phone measurement and artwork review remain open below. No deployment or EAS build performed. |
| T11 Final new-character browser acceptance | In progress; publication blocked | Eventide was started from a blank browser-CMS draft. The recording, three generated projectile sprites, saved-source recovery, selected video rows, and real-engine draft playtest are indexed in [the Eventide evidence](../artifacts/eventide-workbench/index.html). After versioned base cleanup, Surveyor reprocessing, explicit idle/Lash re-review, and a bounded walk retry, 4/26 required rows have current visual approval. Totality and the rest of the playable pack remain unfinished. See CREATE-07's checklist in [the product roadmap](PRODUCT_AUDIT_AND_ROADMAP.md). |

## Operating contracts

- `/workbench?character=palimpsest&move=hands_pinch` opens an explicit move.
  Focus selection is shared by the preview and move editor, not two selectors
  controlling unrelated views. All moves retains the long scrollable inspection view.
- Sequence previews play complete animations. They intentionally do **not** claim
  an unbroken combo. Hit-confirm previews exercise the real cancel conditions.
- One selected document owns its previews, feature listeners and job watchers.
  Switching documents stops watching jobs; it does not cancel paid server work.
- Late loads cannot leave the destination inert or reopen an old character.
  Anchor row selections made during loading replay after readiness. Persisted
  Back/Forward-cache pages retain working controllers and preview channels.
- Generation admission retains the submission nonce across a lost response.
  Subsequent stream reconnects and fallback polling only read persisted status.
- For split-origin production hosting, set `VITE_STUDIO_PARENT_ORIGINS` to a
  comma-separated list of exact trusted CMS origins at build time. Same origin
  is trusted by default; development additionally trusts the same host on 8787.
  A `studioParent` URL parameter cannot add trust by itself.
- Build ownership is single-host, not a distributed lease. Multiple hosts or
  serverless replicas require the deferred lease work in `TODOS.md`. See
  [BUILD_JOB_RUNTIME.md](BUILD_JOB_RUNTIME.md) for Python 3/Unix requirements,
  lock-helper failure behavior and safe shutdown.
- Recovery of partial multi-frame image runs still needs manual assembly.
  Video recovery requires the original pinned prompt/reference and saved task
  checkpoint. Recovered candidates still require review before publication.

## Palimpsest migration / rollback

Only the local draft was migrated. No runtime publication occurred.

Backup directory:

```text
cms-data/migrations/palimpsest-combos-v1/2026-09-22T04-55-08-475Z-4e787232-0bfe-49dc-af92-061901ad3918
```

Original draft SHA-256:
`07c320b7a1fc5d3e85b86449066eba5fdbb0218b4f8b131e1300bf63e0b648d5`

Migrated draft SHA-256:
`2f5765ee80118bcf1b14fdb2fb513b424d3ac1932e0823fe3b71f6f31b26355a`

The migration tool requires writers to be stopped, validates its backup and
candidate hashes, refuses stale/conflicting changes, and preserves archives
and immutable releases. See `scripts/migrate_palimpsest_combos.mjs --help` and
`tests/palimpsest-combo-migration.test.js` before a rollback. Do not overwrite
subsequent user edits with an old backup.

## Verification commands

```sh
node --import tsx --test tests/*.test.js tests/*.test.ts
npx playwright test tests/workbench-library.spec.js tests/workbench-motion-tuning.spec.js
STUDIO_BASE_URL=http://127.0.0.1:5173 ADMIN_BASE_URL=http://127.0.0.1:8787 npx playwright test tests/unified-studio.spec.js tests/workbench-session.spec.js tests/combo-preview.spec.js
npm run build
npm run build:fight
```

The live suites require Vite on 5173 and CMS on 8787. `TEST_CMS_PORT` can isolate
the fixture server from a concurrent baseline run (default 8798).

## Evidence and honest limits

- Latest unit/integration run: **227 passed, 0 failed**. Two original failing
  material-generation tests used obsolete lineage mocks; they now use isolated
  durable storage and preserve their cost/no-resubmission assertions.
- Required isolated workbench tests: **4/4 passed**. Live unified-studio and
  sequence/hit-confirm tests: **10/10 passed**. Session/handshake/navigation
  regression tests after all fixes: **8/8 passed**.
- A combined final live studio run, including keyboard-tab accessibility and
  history disclosure, passed **22/22**. Production WebGL/Canvas smoke passed
  **4/4**. Mobile touch, cancellation, pause and restart tests passed **10/10**
  after pointing them at the running clean-route app and waiting for the new
  scene after restart (rather than calling the destroyed scene's debug API).
- Legacy CMS UI tests: **20/20 passed** after correcting fixture routing,
  selecting the relevant view and intercepting the current durable-job endpoint.
  These tests no longer route temporary characters into the everyday live CMS.
- History, combat-authoring and pipeline workbench tests: **14/14 passed**.
  They navigate visible tabs and use disposable authoring fixtures, preserving
  archived character originals rather than writing to the everyday CMS.
- Production app and fight-only builds both pass. Clip-library browser tests
  passed **10/10**, including unsafe URL rejection and continued playback.
- Broad browser runs: original **99 passed / 47 failed / 20 skipped**; current
  **127 passed / 23 failed / 28 skipped**. Every current failing test name also
  failed in the baseline. The current run began before fixture/selector repairs;
  the focused reruns above verify those repairs, but this is **not an all-green
  full-suite result**. Expanded David motion and oddities summon/stun checks
  remain failing in both runs and need separate diagnosis.
- Baseline limitation: isolated CMS tests used the original detached checkout,
  but older engine tests hardcode the shared development server on 5173. The
  checkout also resolved a different local Node version. Therefore the broad
  comparison is failure triage, not proof of zero runtime regressions. The
  separate paired production benchmark compares full/core engine builds.
- Export smoke: **62/62**. Combo-authoring smoke: **11/11**, updated to assert
  dedicated custom combo rows instead of the obsolete six-row reuse ceiling.
- `npm run rows:smoke` still fails for missing `idle` / `landing` prompt profiles;
  this was reproduced in both the original checkout and this implementation.
- Browser workflow recording: `artifacts/workbench-engine-20260922/workbench.webm`.
  It shows existing Palimpsest move selection, Focus/All moves and combo preview;
  it is **not** a new paid character-generation run.
- Performance details and reproducible measurements:
  [PHASER_RUNTIME_BUDGET.md](PHASER_RUNTIME_BUDGET.md).
  The final version-2 paired desktop run passed the unchanged 5% regression
  gates: median startup 1,337.2 → 1,284.1 ms, first movement 14.9 → 13.9 ms,
  worst-run p95 frame interval 9.1 ms for both builds. All fourteen samples moved
  on the first simulation tick without page errors. Host CPU activity remained
  54–62%; this was a browser-test-free window, not a claim of an idle machine.
- No new paid image/video requests were made for this engineering checkpoint.
- Current row reviews remain stale/unversioned or missing; this work does not
  approve artwork, fix every existing sprite defect or publish those candidates.
- Mobile emulation is not proof of physical-device frame time, input or audio.
