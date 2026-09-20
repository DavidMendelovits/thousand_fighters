# Asset history, checkpoints and recovery

## What is implemented

The character workbench's **History & versions** panel supports named checkpoints,
asset/config comparison, previews, source branching, restore into an isolated
working copy, recovery/resume of an existing video job, and offline re-extraction
of an archived video. Restore and re-extraction do not publish to the game.
Re-extraction uses the current draft's base pose and style, records that input,
saves a safety checkpoint, and installs a **needs-visual-review** candidate.

CMS tools automatically checkpoint before and after character mutations. Asset
writes archive their previous and replacement bytes before changing the working
alias. Each image attempt through `runGenerationAttempt` archives available input
reference bytes and the individual returned frame, not just a composed sheet.
The shared video runner archives local references and job checkpoints before
submission, and downloaded video before downstream sprite processing. Failed
compilation does not discard its source video.

## Layout

All keys use the configured CMS storage adapter (default: local `cms-data/`).

```
lineage/blobs/sha256/<prefix>/<sha256>       content-addressed source/output bytes
lineage/events/<character-or-_global>/*.json append-only run and artifact events
lineage/imports/<hash>.json                 idempotent legacy-file import receipts
characters/<id>/versions/<version>/
  content.json                             committed, pinned character configuration
  assets.json                              per-file hashes and original/pinned paths
  integrity.json                           configuration and manifest hash receipts
  assets/...                               immutable, runtime-readable frozen files
characters/<id>/assets/revisions/<uuid>/... isolated restored working copy
benchmarks/generation-attempts/...          existing external-API timing receipts
```

Blobs deduplicate identical bytes. Frozen version directories currently materialize
copies to keep relative sprite/manifest paths compatible with the runtime. Budget
for these copies; there is **no automatic garbage collection or deletion**.

Runs record parent run IDs; explicit branches/reprocessing record parent event IDs.
Artifact events record hashes, logical keys and previous bytes. Video checkpoints
include provider request IDs, settings, archived inputs and output references.
Motion reports include source/reference hashes, compiler and keyer hashes, options,
Python/Pillow/NumPy/SciPy versions and ffmpeg version. Compilation inputs include an
archived compiler source. Review/draft changes are journaled, but there is not yet
an authenticated reviewer identity system.

## Recovery semantics

- **Restore checkpoint:** verify archive hashes, materialize a new working tree,
  checkpoint the current draft, then switch the draft. Historical and published
  assets are not overwritten. Future asset writes follow the restored working root.
- **Compare:** show changed character fields and added/removed/changed asset hashes,
  with side-by-side media previews where applicable.
- **Branch source:** copy an archived input/output into a new source key. It is not
  automatically installed into an approved sprite pack. The returned key can be
  supplied as `referenceAssetKeys` to `generate_sprite_sheet` for image generation.
- **Recover / resume existing job:** reconstruct a local job directory from archive
  bytes and invoke only `--resume`. A confirmed provider request ID is required
  unless the video is already downloaded. Never automatically submit a replacement
  for an uncertain request. Provider retention still limits resuming undownloaded
  jobs whose remote results have expired.
- **Re-extract:** choose action, frame count and loop behavior; reuse archived video
  without a generation request. Failed extraction leaves the active row unchanged.
- **New generation:** remains an explicit normal Generate/Regen action. It may cost
  money and cannot guarantee identical results, even with the same prompt.

Legacy JSON-only versions are visibly non-restorable: mutable historical paths
cannot establish what their original bytes were. Imported files are marked legacy,
not assigned invented parentage. Unassigned files have their own history filter.
Remote URL-only references retain URL hashes rather than guaranteed reference bytes;
use local/uploaded reference assets for a fully archived input chain.

## Migration and backup

Inspect first (no writes):

```sh
npm run cms:history:import
npm run cms:history:backup -- --provider supabase
```

Import existing `generated/` and `artifacts/workbench-video-jobs/` files and create
initial frozen character baselines, without deleting originals or switching drafts:

```sh
npm run cms:history:import -- --apply
```

Copy immutable history and character versions to the already configured cloud
bucket, verifying every uploaded/existing object with a SHA-256 read-back:

```sh
doppler run -- npm run cms:history:backup -- --provider supabase --apply
```

`r2` is also supported. The backup command never overwrites a differing remote
object. It is a manual backup, not a scheduled one. To send new writes directly to
cloud storage, use the existing `CMS_STORAGE_PROVIDER=supabase|r2|cached` adapter
configuration **after migrating the full working CMS**, not just the archive.
Cached storage must use `CMS_CACHE_WRITE_THROUGH=true` for remote durability.

Current machine: file storage. The configured Supabase bucket read failed with
`fetch failed` on 2026-09-18; remote backup is **not verified or enabled**. Local
immutable storage does not protect against losing this computer.

## Operational limits

- CMS serializes mutations per character within one process; different characters
  can run concurrently. Do not run separate CLI writers against the same character
  during restore/checkpoint. A multi-worker deployment needs distributed locking
  or a transactional database for working pointers. Snapshot inventory/hash checks
  reject detected concurrent changes but are not a distributed transaction.
- Immutable creation uses atomic file links, S3 conditional creation, or Supabase
  non-upsert upload. This is application-level immutability, not provider-enforced
  retention/WORM against an administrator deleting bucket objects.
- Admin endpoints inherit the existing local CMS trust model. Add authentication,
  access control, private buckets and audited retention before public deployment.
- Source generations and processing are retained; a visual graph editor and
  one-click paid reruns of arbitrary historical recipes are not implemented.

## Verification

```sh
npm run cms:history:test
npx playwright test tests/character-history.spec.js
npm run cms:smoke
npm run cms:cached:smoke
npm run cms:r2:smoke
npm run cms:supabase:smoke
```

Tests use temporary storage: replacement/restoration, corruption refusal, immutable
creation races, legacy rejection, provenance redaction, nested run links, source
branching, comparisons, and recovered videos without duplicate paid submission.
Browser tests exercise checkpoint → change → compare → restore on desktop/mobile.
An additional agent-browser check re-extracted the real archived watercolor walk
into 24 frames in an isolated fixture and restored its earlier approved checkpoint.
