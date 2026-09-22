# TODOS

## Infrastructure

### Add distributed ownership for character-build workers

**What:** Add shared multi-worker leases, heartbeats, ownership transfer, and contention tests to the durable character-build job system.

**Why:** The approved release guarantees safe execution for one CMS worker process. A future horizontally scaled deployment would otherwise allow multiple workers to claim the same provider stage and duplicate expensive image or video generations.

**Context:** The current plan persists stages, checkpoints provider task IDs, reconciles interrupted jobs at startup, and enforces a process-level single-owner lock. Keep that deliberately smaller design until deployment evidence requires concurrent CMS workers. When scaling becomes necessary, start in `cms/jobs/CharacterBuildJobs.js`, select shared coordination infrastructure, define lease-expiry and clock-skew behavior, and add contention and failover coverage before enabling a second worker.

**Effort:** L
**Priority:** P3
**Depends on:** A demonstrated need for multiple concurrent CMS worker processes and selection of shared queue or locking infrastructure.
