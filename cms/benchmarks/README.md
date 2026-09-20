# Benchmark and controlled-trial contract

`BenchmarkService.report(filters)` reads legacy observations and the durable
generation ledger, deduplicating by attempt ID. `inventory` is a sanitized JSON
inventory, not provider payloads. Filters include provider, model, character,
action (`moveId`), style, resolution, measurement source and trial ID. Percentiles
use nearest rank, with sample counts. Provider stage names remain as recorded:
combined queue/generation time is never presented as queue-only time.

Unknown prices are null. The known subtotal is an estimate, not an invoice.
`costPerAcceptedRowUsd` and `costPerAcceptedCharacterUsd` remain null until full
causal provenance exists. The separately named accepted-output attempt metric
excludes discarded attempts; the cohort ratio includes all selected attempts but
is explicitly descriptive, incomplete historically, and withheld if any price is
unknown. Only current version-bound reviews whose source hashes match attempts
are attributed. Legacy measurements without source classification remain
`unclassified`, not live-provider evidence.

## Controlled source-video trials

- POST a definition to `/api/benchmark-trials` to archive reference bytes and pin
  actions, prompts, model identifiers, duration and art style. Saving spends nothing.
- The bounded runner supports the configured FAL Kling v3 standard image-to-video
  model and Pruna p-video-2-pro. It requires one image reference and 5–15 seconds.
  Seed is not enforceable and therefore blocked. FAL resolution is not selectable
  through this adapter: comparisons involving FAL require `provider-native`, with
  Pruna pinned to 768p quality. These are not equal-resolution experiments.
- POST `candidateIndex`, `actionIndex`, `confirmed:true`,
  `acceptUnknownCost:true` to `/:id/run`. One candidate/action slot is admitted;
  no batch executes automatically. The response is asynchronous, and subsequent
  GETs include saved runs. Browser closure does not stop the server worker.
  The worker admits one active controlled trial at a time; this is not a
  distributed multi-worker scheduler.
- Each slot reserves an equal share of the definition's estimate budget. Slots
  are immutable and never automatically recycled. This enforces the number of
  authorized submissions and estimated reservations, **not an invoice ceiling**.
  Unknown provider prices require explicit acknowledgment for each submission.
- A repeated slot request reuses its record. After interruption, `/:id/resume`
  with explicit confirmation invokes only the existing video job directory;
  missing task IDs or stale worker locks block rather than purchase another job.
- The existing `runVideoJob` transport records ledger intent, provider task IDs,
  checkpoints and immutable source output. Outputs live under trial-specific
  directories and content-addressed lineage blobs, never canonical fighter rows.
  They remain unreviewed source videos: no automatic character installation,
  quality approval, model ranking, normalization or sprite extraction occurs.

`trialTransport` and `trialRootDir` constructor options isolate deterministic
tests. Production defaults to the existing video transport. No paid trials were
performed as part of the infrastructure tests.
