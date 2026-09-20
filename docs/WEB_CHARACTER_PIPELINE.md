# Web character-building pipeline

Updated September 20, 2026. This is an implementation plan and acceptance contract, not a claim that the app is production-ready.

## Product outcome

A creator should build an unusual, playable fighter entirely in the workbench: describe its material and movement, supply references, review identity, author a comprehensive moveset with character-specific inputs, generate motion, repair/reject candidates, test interactions, and publish a version they can restore. Refreshing the browser must not lose the work or silently buy it again.

The optimization target is **time and total spend to an accepted, playable character**, not the fastest isolated video. A cheap generation that requires three reruns and manual alignment can be the expensive option.

## What this slice delivers

The existing identity and animation-row Generate buttons now use `POST /api/characters/:id/build-jobs`. The server saves an immutable request before execution, claims it once, generates/saves the source, extracts image-row frames, and journals the result. Video rows already return compiled frames and skip the image extractor. Both paths retain the existing tools, checkpoints, provider adapters and publish gates.

- Browser refresh: persisted jobs remain visible. The submitted job continues server-side, including extraction. Reloading saved draft data is an explicit action in the reconnected panel.
- Lost submission response: the browser retains its nonce. Repeating the same submission reuses the job; it does not automatically fall back to the old streaming endpoint.
- Duplicates: the same nonce is bound to exact inputs; matching active inputs reuse the existing job even with a new nonce. A different build for that fighter is rejected while work is active or uncertain.
- Process interruption: old queued/running/extracting jobs become `needs-recovery`. Startup does **not** replay them. An operator must verify the old worker stopped and inspect output/provider history before resolving the job.
- Extraction failure: the saved source is retained in the job. Recovery can use existing History tools; resolving the job itself neither recovers output nor submits a retry.
- Timing: elapsed admission-to-finish, generation/tool-save and local extraction duration are visible. These include application/checkpoint work; they are not all pure provider latency. Available attempt observations and estimated costs are retained; unknown cost is not shown as free.
- Bulk button: confirms paid work before creating a missing base, then submits rows sequentially. Refresh preserves the submitted job but **does not resume the unsubmitted remainder**. It stops on failure or character navigation.

### Storage and recovery contract

```text
build-jobs/<characterId>/<uuid>/
  request.json          immutable inputs, draft timestamp, admission identity
  claim.json            atomic execute-once claim
  events/000000.json    queued
  events/000001.json    running
  events/...           source saved / extracting / completed / needs-recovery / resolved
```

Requests and revisions use the existing storage adapter's create-only writes. Source media and frozen character versions stay in the existing asset/lineage stores, not duplicated as inline media in the job record. Job results carry source keys, extraction results and attempt observations. Legacy generations are still in History and are not backfilled as new build jobs.

The mutation lock is reentrant for nested generator/extractor tools, retaining one lock across the complete job. Other writes for that character wait. A draft timestamp changed while queued blocks execution before generation. A filesystem-listing race discovered during polling was fixed: unpublished `.pending`/`.tmp` siblings are excluded and disappearing files do not break a listing.

Live startup inspection also found roster discovery recursively scanning 84,624 character-tree files, including old revisions. Local draft discovery now lists character directories only, summaries list the active pack, and file traversal reuses directory entry types instead of issuing a stat per file. The same live roster endpoint went from a 20-second timeout to a 0.172-second response in one local check. This is a measured spot check, not a stable latency percentile or a claim about remote storage performance.

## Boundaries — do not deploy this as a public service yet

- One CMS process owns this executor, with one running build globally and a bounded pending queue. Different processes are **not** coordinated by a distributed lease. An immutable claim stops the same job executing twice; it does not stop two different job IDs submitted concurrently through separate servers.
- No automatic task reconciliation/download resumption, cancellation, durable batch itinerary, tenant budget or fair scheduling yet. A permanently hung provider needs operator intervention; do not label it cancelled just because a browser stopped polling.
- The durable record is job-level admission, **not a complete fail-closed per-provider-attempt ledger**. Existing callbacks still have best-effort persistence paths. PIPE-02 remains open, including direct scripts and non-row tools.
- Legacy direct tools, chat and standalone scripts are not forced through this job API. The new protection covers the workbench's identity and row controls only.
- Requests save prompts/settings and the draft timestamp; a complete immutable dependency graph with reference/version hashes at admission is still needed. Existing tool lineage captures actual execution artifacts.
- Job listing currently reads storage records and the panel shows eight recent/unresolved jobs. A queryable index/pagination is needed before a large multi-user workload.
- CMS authentication, authorization, abuse limits, worker isolation and verified off-machine recovery remain release blockers. Keep the CMS bound to localhost. No new public endpoint/tunnel or production deployment was created.

## Next roadmap order

| Order | Deliverable | Evidence required before calling it done |
|---|---|---|
| 1 | Provider recovery and durable attempt admission (PIPE-01/02) | Kill a worker before/after accepted task ID, during download and during extraction. Recover the exact output with zero second paid submissions; reconcile every ledger state, including storage failures. |
| 2 | Review-first build plan with budget (CREATE-04/06, PIPE-05) | Preview dependencies, estimated/unknown spend and missing rows. Pin identity/move/reference versions; reserve a bounded budget; pause for identity review and representative motion approval. Closing the browser preserves the unsubmitted plan. Explicitly reject stale plans after edits. |
| 3 | Benchmark dashboard and controlled model trials (PIPE-03/04) | Join all attempts to review outcomes and character versions. Show p50/p95 generation, queue, download, processing and checkpoint latency; rejection/retry rate; unknown costs; total spend per accepted row/character. Compare the same references/actions, not unrelated demos. |
| 4 | Complete browser creation acceptance (CREATE-07) | Record a new unusual fighter from references through rejected candidate, targeted retry, restore, all required animations, summon/form interaction tests, QA, publication and a real match. No shell-only content edits in the acceptance run. |
| 5 | Authenticated hosted beta (PROD-01 and dependencies) | Tenant ownership tests on every asset/job/history route; authenticated reviewer identity; distributed queue leases and quotas; signed media upload/download; backup restore drill; a full remote-browser creation run. |

Auth can be designed alongside the first three items, but public exposure waits for its acceptance tests. Existing Palimpsest art defects and its current review debt remain visible; this pipeline work does not approve that art.

## Efficiency experiments worth running

1. **Review a small representative set before buying the full kit.** Identity, locomotion, a far-reaching/morphing attack, and a paired grab expose different failure modes. Which representative set best predicts the rest is an experiment, not a universal four-row limit.
2. **Reuse source before regenerating.** Try source interval selection, pose sampling, material-aware matte cleanup, anchors and grip timing against the saved video. Record processing time and acceptance separately from another provider request.
3. **Separate actor/effect assets when they need independent runtime control.** Summon motion, held-target contact, projectile travel/impact and transformations need their own animation contracts. Do not buy a spectacular composite video the engine cannot use.
4. **Compare configured image/video APIs by motion family.** Use fixed identity references and equivalent output requirements for locomotion, acrobatics, paint morphing, extension attacks and paired grabs. Record failures and discarded candidates. Choose defaults only after the measured trial; no new provider/model winner is asserted here.
5. **Profile local work before increasing API concurrency.** Existing history checkpoints can dominate a short generation. Measure snapshot/archive/normalization stages and storage round trips; optimize shared immutable references and indexing without weakening restore guarantees.

For each experiment, preserve prompt/settings/reference hashes, provider task ID, source, extraction version, reviewer verdict/reason, runtime test evidence and total elapsed/cost. Mark estimates and missing prices explicitly. Keep training/fine-tuning as a later measured option if repeated identity/motion failures justify a curated, licensed dataset; do not make it a prerequisite for this usable web workflow.

## Verification

- `node --test tests/build-jobs.test.js tests/character-history.test.js tests/publish-readiness.test.js tests/material-generation.test.js` — 40 checks.
- `npx tsx --test tests/workbench-library.test.ts` — 12 library and reference/preview checks, including no recursive archive scan during roster discovery.
- `ADMIN_BASE_URL=http://127.0.0.1:8795 npx playwright test tests/build-jobs.spec.js` — 8 checks across desktop and mobile; each starts its own isolated CMS with a controlled provider.
- `npm run build` and `npm run cms:fullflow:smoke` — passed; existing large-bundle warning remains.
- [Recorded browser workflow and limits](../artifacts/web-build-jobs/README.md). The adapter output is an explicit test fixture, not a newly generated production fighter or a live model-speed benchmark.
