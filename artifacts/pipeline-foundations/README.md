# Pipeline foundations — verified September 20, 2026

[Watch the workbench recording](index.html). `workbench.mp4` is 67.8 seconds, 1440×1000, H.264. `workbench.webm` preserves the raw browser capture. This is a recorded demonstration, not an interactive tutorial or a complete new-fighter acceptance run.

## Visible workflow

- 0–18s: open the saved-plan form, enter direction, choose a provider and a one-submission limit, then save without generation.
- 18–37s: the saved plan remains after browser reload; no build exists yet.
- 37–54s: explicitly continue one step. One identity build is submitted; reloading reconnects to its running status.
- 54–67.8s: the identity job completes. Continuing checks the saved result and stops for identity review instead of submitting more work.

The provider is explicitly labeled **controlled fixture**, with a 15-second artificial delay and zero price. CMS routes, durable plans/jobs, attempt ledger, storage and normal tool plumbing are real. No external generation API, credit balance, production asset or approval was changed. This recording demonstrates workflow persistence and review gating, not model speed or art quality.

The encoded MP4 was opened in the browser; playback advanced through submission (36–47s), completion (55s) and review pause (67.8s), with changing decoded content. The full-duration filmstrip and desktop/mobile screenshots were inspected. Live historical benchmarks were also opened through the unified Studio (`benchmarks.png`); that read-only dashboard is separate from the controlled recording.

## Verification

62 backend/integration tests passed:

```sh
node --test tests/build-jobs.test.js tests/build-plans.test.js tests/build-plans-integration.test.js tests/generation-ledger.test.js tests/benchmarks.test.js tests/character-history.test.js tests/publish-readiness.test.js
```

14 desktop/mobile browser checks passed:

```sh
ADMIN_BASE_URL=http://127.0.0.1:8795 npx playwright test tests/build-jobs.spec.js tests/pipeline-workbench.spec.js --reporter=line
```

Each browser test creates its own isolated server/storage; the environment variable suppresses the unrelated default fixture. Build, TypeScript and `npm run cms:fullflow:smoke` passed. The existing >500kB game bundle warning remains.

Coverage includes storage failure before admission, uncertain submissions, known-task recovery without a second submission, source/reference hash changes, stable job IDs, identity/base/actor reference checkpoints, frozen actor identity, server-owned generation after refresh, unknown-cost blocking, trial duplicate suppression and trial-to-ledger integration. The source-video test uses a fake adapter and asserts lifecycle/archival only—not playable video or generated animation quality.

## Still open

Actual paid model comparisons and visual scoring; complete lifetime cost attribution for old unpriced/unlinked attempts; independent effect generation and form installation; the full new-character browser-to-published-match journey; distributed worker leases, authentication, tenant quotas and invoice reconciliation. Estimated budgets are not provider billing caps. Trial outputs are unreviewed archived videos, not installed spritesheets.

Local viewing requires Vite on5173. The workbench additionally requires CMS on8787. Nothing was publicly hosted or pushed as part of this recording.
