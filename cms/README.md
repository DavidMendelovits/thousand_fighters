# CMS Storage

This folder is the first slice of the character CMS backend. It intentionally
does not depend on the Vite/Phaser client. The game can keep using
`src/characters/stamptownFighters.ts` while the admin dashboard and API grow
around this storage contract.

For the broader pluggable pipeline architecture, see
`docs/CMS_PIPELINE_ARCHITECTURE.md`.

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

Source sprite-sheet generation can use the local deterministic SVG fallback or
OpenAI Responses image generation:

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
```

The local provider is useful for no-network smoke tests. The OpenAI provider
calls `/v1/responses` with the hosted `image_generation` tool, forces image
generation, and stores the returned image bytes through the same CMS asset
repository path.

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
