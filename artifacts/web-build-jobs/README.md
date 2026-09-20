# Persistent web builds — recorded verification

September 20, 2026. [Watch the workflow](index.html) or open [the MP4](workbench.mp4).

This is a real agent-browser recording of the workbench against an isolated CMS and a **controlled image adapter**. It is not a new production fighter, paid model trial, gameplay video, or completion of CREATE-07. The blue block sprites are explicit fixtures. No live character assets or reviews were changed.

## What the recording shows

| Approximate video time | Action and visible result | Verdict |
|---|---|---|
| 0–3s | Controlled-provider label, empty Build activity, Generate on the Base card | Pass |
| 3–9s | Persisted queued/running job; browser reload while it is running | Pass |
| 9–24s | Reconnected job progresses from generation to server-owned extraction | Pass |
| 24–27s | Completed job with persisted timing and saved-source link | Pass |
| 27–30.1s | Reload saved draft; six actual extracted frames appear | Pass |

The job recorded **29.2s elapsed / 16.3s generation-and-save / 12.4s extraction**. The provider fixture intentionally waits 15 seconds. These values include tool/checkpoint overhead and say nothing about production model speed. Screen-recorder timing is not a replacement for the persisted timing ledger.

The recording skill's probe/QA loop was used: a first 0.1-second probe was rejected as too short, a second probe verified visible navigation, then the final capture was encoded to H.264 at 1440×1000. The entire 30.1-second export decoded and played to `ended=true`, with no media error. Opening, processing and final frame states were visually inspected in playback and in the [filmstrip](filmstrip.png). Freeze detection flagged the expected processing/status holds; the elapsed counters, extracting/completed transition and final frame grid are present. No generation-time cuts or composited UI were added.

## Automated and live checks

- 40 backend checks: immutable admission, duplicate suppression, no provider on persistence failure, execute-once claims, stale-draft rejection, restart handling, source preservation, failed journaling, reentrant mutation lock, existing history/review/provider safeguards.
- 12 library checks: active assets only, directory-only discovery, reference review/restore rules and motion previews.
- 8 browser checks: desktop and mobile refresh/extraction, HTTP idempotency, explicit interruption resolution, and lost POST-response retry using the same submission key.
- Build/TypeScript and CMS full-flow smoke passed. Existing large-bundle warning remains.
- [Mobile view](completed-mobile.png): measured 390px viewport and 390px document width, no horizontal overflow.
- [Live Palimpsest workbench](live-workbench.png): the new panel loads through the real Vite/CMS route. Its prior generations remain in History, not invented/backfilled jobs.

Live performance check found 84,624 files under `cms-data/characters`. Before the discovery fix, the roster request exceeded a 20-second timeout. After avoiding recursive archive discovery, using active packs for summaries, and reusing directory entry types instead of per-file stats, the same endpoint returned HTTP 200 in **0.172s**. This is a single local observation, not a p50/p95 benchmark.

## Reproduce safely

`node tests/fixtures/build-workbench.mjs` starts a keyless temporary CMS on port 8795. Open `/roster/web_build_lab?standalone=1`, Generate the base, refresh while running, and reload the saved draft after completion. The fixture keeps production storage separate and removes only its own temporary data on shutdown.

See [the pipeline contract and prioritized next steps](../../docs/WEB_CHARACTER_PIPELINE.md). Single-process execution, per-attempt durability, provider reconciliation, durable batch plans/budgets, authenticated hosting and the full new-character acceptance run remain open.
