# CMS Storage

This folder is the first slice of the character CMS backend. It intentionally
does not depend on the Vite/Phaser client. The game can keep using
`src/characters/stamptownFighters.ts` while the admin dashboard and API grow
around this storage contract.

For the broader pluggable pipeline architecture, see
`docs/CMS_PIPELINE_ARCHITECTURE.md`.

For the new video/PNG-sequence animation compiler, layered Animation Lab, and
resumable fal video generation, see [Animation clips](../docs/ANIMATION_CLIPS.md).
This path supports arbitrary frame counts, acrobatics, morphing, transformations,
and independently inspectable effects without changing the legacy image provider.

## Provider Contract

CMS storage is object-store shaped:

- `getJson(key)`
- `putJson(key, value, metadata)`
- `getBytes(key)`
- `putBytes(key, bytes, metadata)`
- `getMetadata(key)`
- `exists(key)`
- `list(prefix)`
- `delete(key)`
- `urlFor(key)`

Keys are relative POSIX paths such as:

```text
characters/viggo/draft/content.json
characters/viggo/versions/2026-05-17T12-00-00-000Z/content.json
characters/viggo/assets/source/viggo_imagegen_sheet.png
characters/viggo/assets/sprites/base/base_001.png
characters/viggo/qa/run-001/report.json
```

The local file adapter stores these keys under `cms-data/` by default. Remote
adapters keep the same key layout and implement the same methods.

Do not commit `cms-data/` or `.cache/` into git. The canonical CMS dataset lives
in remote object storage, and local development should pull a cache on demand.

## Local File Storage

Default setup:

```bash
node scripts/smoke_cms_storage.mjs
npm run cms:import-fighters
npm run cms:admin
```

`npm run cms:import-fighters` copies the existing `public/fighters/*` packs into
the file CMS under `cms-data/characters/<id>/assets/` and writes draft records
for the admin roster. It preserves the game asset shape: `manifest.json`,
`frameData.json`, `normalization-report.json`, `sheets/`, `sprites/`,
`projectiles/`, and source files where present.

Environment knobs:

```bash
CMS_STORAGE_PROVIDER=file
CMS_FILE_STORAGE_ROOT=cms-data
CMS_FILE_PUBLIC_BASE_URL=http://127.0.0.1:5173/cms-data
```

`CMS_FILE_PUBLIC_BASE_URL` is optional. Without it, `urlFor()` returns a local
`file://` URL, which is fine for server-side jobs but not for browser fetches.

## Cached Remote Storage

For normal local development against the remote CMS, use the cached provider:

```bash
CMS_STORAGE_PROVIDER=cached
CMS_REMOTE_STORAGE_PROVIDER=supabase
CMS_CACHE_ROOT=.cache/cms-data
SUPABASE_URL=https://ssnefeisquyqcqvujzcc.supabase.co
SUPABASE_BUCKET=thousand-fighters-cms
SUPABASE_SERVICE_ROLE_KEY=...
```

Reads check `.cache/cms-data` first, then fetch from the remote provider and
write the object into the local cache. Writes go to remote storage and then the
cache unless `CMS_CACHE_WRITE_THROUGH=false` is set.

Useful commands:

```bash
npm run cms:pull -- --character janitor
npm run cms:pull -- --all
npm run cms:cache:status
npm run cms:cache:clear
```

The default `npm run cms:pull` with no arguments pulls only
`characters/index.json`, which is enough to inspect the roster without
downloading every sprite.

Use `--character <id>` to cache one fighter for local inspection. Use `--all`
only when you intentionally want the whole CMS locally.

## Admin Chat

The admin dashboard includes a chat agent that can invoke CMS tools.

Local deterministic mode is the default when no OpenAI key is set:

```bash
CMS_CHAT_PROVIDER=local
npm run cms:admin
```

OpenAI Responses mode:

```bash
CMS_CHAT_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_RESPONSES_MODEL=gpt-5.5
npm run cms:admin
```

The chat agent uses the same tool registry exposed at `/api/tools`, so it can
inspect pipeline status, create drafts, patch draft fields, list assets,
generate source sheets, normalize packs, validate QA reports, and publish when
explicitly requested.

## Local Codex CMS Module

For local automation outside the Codex app session, use the Codex CMS module.
It exposes the same CMS function catalog that powers `/api/tools`.

There are two local providers:

- `codex-cli`: uses `codex exec` and the Codex CLI login on this machine. This
  is the path that can use your ChatGPT/Codex subscription for local planning.
- `responses`: calls the Responses API directly and requires `OPENAI_API_KEY`.

```bash
npm run cms:codex:local -- --health
npm run cms:codex:local -- --list-functions
npm run cms:codex:local -- "Check pipeline status"
npm run cms:codex:local -- --character janitor "List this fighter's assets"
OPENAI_API_KEY=... npm run cms:codex:local -- --provider responses "Check pipeline status"
```

Useful env vars:

```bash
CODEX_CMS_PROVIDER=codex-cli
CODEX_CLI_MODEL=gpt-5.3-codex
CODEX_CMS_SANDBOX=read-only
OPENAI_CODEX_MODEL=gpt-5.3-codex
OPENAI_CODEX_REASONING_EFFORT=medium
CMS_STORAGE_PROVIDER=file
CMS_FILE_STORAGE_ROOT=cms-data
```

The module is intentionally limited to explicit CMS function calls. It does not
grant shell access or raw filesystem mutation to the model; if we add a local
shell loop later, it should be a separate sandboxed adapter with approvals.

The Codex CLI provider chooses CMS functions. The functions themselves still use
their configured adapters. For example, `generate_sprite_sheet` uses the local
SVG placeholder when `IMAGE_GENERATOR_PROVIDER=local`; API credentials are only
needed for the selected hosted generator.

## Text Model Adapter

Character draft creation can use local deterministic output or OpenAI Responses
structured output:

```bash
TEXT_MODEL_PROVIDER=local
TEXT_MODEL_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_TEXT_MODEL=gpt-5.5
```

`OPENAI_TEXT_MODEL` is optional. If it is not set, the adapter falls back to
`OPENAI_RESPONSES_MODEL` and then `gpt-5.5`.

## Image Generator Adapter

Source sprite-sheet generation can use the local deterministic SVG fallback,
OpenAI Responses image generation, Codex image generation, MiniMax H3 motion
generation, or one of the fast six-frame still-image providers:

```bash
IMAGE_GENERATOR_PROVIDER=local
IMAGE_GENERATOR_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_IMAGE_RESPONSES_MODEL=gpt-5.5
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_SIZE=1024x1024
OPENAI_IMAGE_QUALITY=auto
OPENAI_IMAGE_BACKGROUND=auto
OPENAI_IMAGE_OUTPUT_FORMAT=png

IMAGE_GENERATOR_PROVIDER=minimax-h3
MINIMAX_API_KEY=...
MINIMAX_H3_MODEL=MiniMax-H3
MINIMAX_H3_RESOLUTION=768P
MINIMAX_H3_DURATION=4
MINIMAX_H3_POLL_INTERVAL_MS=5000
MINIMAX_H3_TIMEOUT_MS=900000

IMAGE_GENERATOR_PROVIDER=minimax-image
MINIMAX_API_KEY=...

IMAGE_GENERATOR_PROVIDER=gemini-fast
GEMINI_API_KEY=...

IMAGE_GENERATOR_PROVIDER=bfl-klein
BFL_API_KEY=...

IMAGE_GENERATOR_PROVIDER=fal
FAL_KEY=...
FAL_IMAGE_MODEL=fal-ai/flux-2/klein/4b/edit
```

The local provider is useful for no-network smoke tests. The OpenAI provider
calls `/v1/responses` with the hosted `image_generation` tool, forces image
generation, and stores the returned image bytes through the same CMS asset
repository path.

The `minimax-h3` provider is deliberately row-only. It asks H3 for a short,
locked-camera move clip, polls the asynchronous task, downloads the MP4, and
uses ffmpeg to sample six evenly spaced frames into the existing 1x6 (or 2x3
wide) sheet contract. The sheet is stored at the usual source path and the
reviewable source clip is retained beside it as
`source/<character>_<move>_h3.mp4`. Generation, post-processing, and total
elapsed milliseconds are written into asset metadata and returned by the tool.

`MiniMax-H3` is the default because it accepts identity reference images.
`MiniMax-H3-Max` can be selected for a speed experiment, but H3 Max does not
support reference-to-video; the adapter therefore omits identity references and
emits a warning. Use OpenAI or Codex for character concepts, projectiles, and
arena stills while H3 is selected for fighter motion rows.

The `minimax-image`, `gemini-fast`, `bfl-klein`, and `fal` providers share a
fast row workflow: six single-frame prompts are submitted concurrently, then
ffmpeg scales, bottom-aligns, pads, and tiles them into a deterministic 1x6 or
2x3 PNG. Prompts require authentic 2D arcade pixel art and explicitly reject
3D/action-figure rendering; the compositor also rasterizes at low resolution
and uses a nearest-neighbor upscale for crisp pixel clusters. The six original provider images are retained under
`source/<character>_<move>_frames/` for inspection. `fal` is the model
laboratory: change `FAL_IMAGE_MODEL` to benchmark another compatible fal model;
`FAL_IMAGE_REFERENCE_FIELD=image_url` can opt a generic model into the first
identity reference.

Common optional tuning:

```bash
FAST_IMAGE_FRAME_CONCURRENCY=6
FAST_IMAGE_FRAME_RETRIES=2
FAST_IMAGE_REQUIRE_MAGENTA_BACKGROUND=true
MINIMAX_IMAGE_FRAME_CONCURRENCY=3
FFMPEG_BIN=ffmpeg
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image
MINIMAX_IMAGE_MODEL=image-01
BFL_IMAGE_MODEL=flux-2-klein-4b
FAL_IMAGE_INFERENCE_STEPS=4
```

Run all configured providers against the same six-frame job and write PNGs plus
JSON/Markdown timing results with:

```bash
doppler run -- npm run cms:image:benchmark -- \
  --reference /absolute/path/to/fighter.png \
  --move punch \
  --prompt "A vaudeville boxer throws one crisp straight punch"
```

Every workbench row generation also writes a durable benchmark JSON asset under
`characters/<id>/assets/benchmarks/<move>/`. It records reference loading,
provider wall time, provider-specific submission/queue/download stages, local
composition, artifact persistence, frame timings, estimated cost, and total
elapsed time. Frame extraction writes a companion record under
`fighter-pack/benchmarks/extraction/<move>/`. The workbench activity log shows
the same stage breakdown immediately after each operation, so normal authoring
runs continuously build the benchmark dataset without a separate profiling mode.

In addition, every external image/video request emits one immutable attempt
record under `benchmarks/generation-attempts/YYYY-MM-DD/<attempt-id>-<observation>.json`.
Attempts are recorded independently from final assets, including provider
failures, contract-rejected output, and each retry of an individual frame. The
record includes provider/model, operation, character/move/projectile/arena
context, attempt and frame numbers, start/end/wall time, provider task id,
stage timings, usage, estimated cost, and sanitized error details. A failed
benchmark write is surfaced as a warning but never converts a successfully
generated asset into a failed generation.

The default comparison set is `minimax-image,bfl-klein,fal`. Gemini remains
available through `--providers gemini-fast` but is intentionally excluded from
the default benchmark for now.

The keyless adapter and real ffmpeg bridge can be checked with:

```bash
npm run cms:minimax:h3:smoke
npm run cms:fast:image:smoke
```

## Supabase Adapter

The current deployed admin platform uses Supabase Storage:

```bash
CMS_STORAGE_PROVIDER=supabase
SUPABASE_URL=https://ssnefeisquyqcqvujzcc.supabase.co
SUPABASE_BUCKET=thousand-fighters-cms
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_PUBLIC_BASE_URL=
```

Use `npm run cms:supabase:smoke` to validate the adapter contract with a fake
Supabase client. For live Supabase, provide the env vars above and migrate a
local file CMS with `npm run cms:supabase:migrate`.

## R2 Adapter

The CMS can store the same object-store key layout in Cloudflare R2:

```bash
CMS_STORAGE_PROVIDER=r2
R2_ACCOUNT_ID=66151c321c1bdb19231c5f18d2ad2e43
R2_BUCKET=thousand-fighters-cms-assets
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_PUBLIC_BASE_URL=
```

The bucket created for this project is:

```text
thousand-fighters-cms-assets
```

The rest of the CMS API should not care whether the provider is local disk, R2,
S3, or a different object store. If it uses keys and the storage interface, it
is doing the right thing.

Use `npm run cms:r2:smoke` to validate the adapter contract with a fake R2
client. For live R2, provide the env vars above, migrate the local file CMS with
`npm run cms:r2:migrate`, then run the admin server with
`CMS_STORAGE_PROVIDER=r2`.
