# CMS Pipeline Architecture

The CMS and character builder should use a hexagonal architecture. Product code
depends on ports. Provider code lives in adapters. If we swap OpenAI for
Anthropic, Runway, local scripts, R2, S3, or a queue-backed worker, the dashboard
and character workflow should not be rewritten.

Current implementation starts here:

```text
cms/
  storage/
    FileCmsStorage.js
    createCmsStorage.js
  repositories/
    CharacterContentRepository.js
  import/
    importExistingFighters.js
  pipeline/
    ports.js
    PipelineRegistry.js
    CharacterCreationPipeline.js
    adapters/
      mockAdapters.js
      localAdapters.js
  runtime/
    createLocalCmsRuntime.js
  server/
    createCmsServer.js
```

## Rule

No pipeline step should call a vendor SDK directly from orchestration code.

Allowed:

```text
CharacterCreationPipeline -> PipelinePort.IMAGE_GENERATOR -> OpenAIImageAdapter
CharacterCreationPipeline -> PipelinePort.IMAGE_GENERATOR -> RunwayImageAdapter
```

Not allowed:

```text
CharacterCreationPipeline -> openai.images.generate()
CharacterCreationPipeline -> runway.generate()
```

Provider-specific details belong in adapters. The rest of the app sees stable
requests and stable results.

## Ports

| Port                   | Purpose                                      | Current adapter        | Future adapters                         |
|------------------------|----------------------------------------------|------------------------|------------------------------------------|
| `assetStorage`         | Blob/object storage                          | file, cached, Supabase | R2, S3, GCS                              |
| `characterRepository`  | Character drafts, versions, assets, QA refs  | local repository       | SQL-backed repository                    |
| `textModel`            | Structured planning and content edits        | local or OpenAI        | Anthropic, local LLM                     |
| `imageGenerator`       | Sprite sheets, frames, projectiles, edits    | local SVG placeholder  | OpenAI image, Runway, Stability, local   |
| `videoGenerator`       | Motion/video-based frame generation          | none yet               | Runway, Pika, local video model          |
| `spriteNormalizer`     | Raw sheet to game-ready sprites              | local fixture copier   | local Python script, remote worker       |
| `fighterQa`            | Validation and visual QA                     | local placeholder      | local validator, remote QA worker        |
| `publisher`            | Validated draft to release bundle            | local file publisher   | local export, CDN publish, deploy hook   |
| `jobQueue`             | Async orchestration                          | none yet               | in-memory, BullMQ, Cloudflare Queue      |

The registry enforces that each adapter implements the required methods for its
port and exposes health when an adapter implements `healthCheck()`. The mock
adapters exist only to test that the orchestration stays provider-agnostic.

## Storage Source Of Truth

The repository should not carry the CMS asset dataset. Character sprites,
source sheets, projectiles, and generated reports are object-store data, not
source code. The remote CMS bucket is the source of truth. Local dev uses
`CachedCmsStorage` as a read-through cache:

```text
admin/API read
  -> .cache/cms-data if present
  -> remote storage if missing
  -> write fetched object into cache
```

Full local sync is an explicit command for offline work, not the default repo
state:

```bash
npm run cms:pull -- --character janitor
npm run cms:pull -- --all
```

## Character Creation Flow

```text
Admin Dashboard
  -> Game Content API
    -> CharacterCreationPipeline
      -> textModel.completeStructured()
      -> characterRepository.saveDraft()
      -> imageGenerator.generateImage()
      -> characterRepository.writeAsset()
      -> spriteNormalizer.normalizeFighterPack()
      -> fighterQa.validateFighterPack()
      -> publisher.publishCharacter()
```

Every arrow after `CharacterCreationPipeline` is a port call. Any provider can be
swapped by registering a different adapter for that port.

## Adapter Boundaries

### Text Model Adapter

Contract:

```js
{
  id: 'openai-responses-text',
  provider: 'openai',
  capabilities: ['structured-output', 'tool-calling'],
  async completeStructured(request) {
    return {
      provider: 'openai',
      model: '...',
      promptRef: '...',
      value: { /* schema-shaped content */ }
    };
  }
}
```

OpenAI Responses API is the first planned adapter. Anthropic or another provider
should implement the same method and return the same result shape.

### Image Generator Adapter

Contract:

```js
{
  id: 'openai-image-generator',
  provider: 'openai',
  capabilities: ['fighter-5x6-sheet', 'frame-edit', 'projectile'],
  async generateImage(request) {
    return {
      provider: 'openai',
      model: 'gpt-image-2',
      contentType: 'image/png',
      bytes: Uint8Array,
      promptRef: '...'
    };
  }
}
```

Runway or another image provider should return the same `bytes` and metadata.
The downstream repository should not know who generated the PNG.

### Sprite Normalizer Adapter

Contract:

```js
{
  id: 'local-contour-normalizer',
  provider: 'local',
  capabilities: ['fighter-pack-normalization'],
  async normalizeFighterPack(request) {
    return {
      status: 'pass',
      characterId: request.characterId,
      outputKey: 'characters/<id>/normalized/manifest.json',
      warnings: []
    };
  }
}
```

The first real adapter can wrap `scripts/normalize_fighter_sheet_contours.py`.
A later adapter could call a remote worker. Same port, different adapter.

### Fighter QA Adapter

Contract:

```js
{
  id: 'local-fighter-pack-qa',
  provider: 'local',
  capabilities: ['fighter-pack-validation'],
  async validateFighterPack(request) {
    return {
      status: 'pass',
      characterId: request.characterId,
      checks: [],
      reportKey: 'characters/<id>/qa/<run>/report.json'
    };
  }
}
```

This should eventually implement the checks from
`docs/FIGHTER_PACK_QA_PLAN.md`.

### Publisher Adapter

Contract:

```js
{
  id: 'local-release-publisher',
  provider: 'local',
  capabilities: ['character-publish'],
  async publishCharacter(request) {
    return {
      status: 'published',
      characterId: request.characterId,
      releaseId: request.releaseId,
      bundleKey: 'releases/<releaseId>/characters/<id>.json'
    };
  }
}
```

Publishing should be blocked unless QA passes.

## OpenAI First, Not OpenAI Forever

The first real provider family can be:

- OpenAI Responses API for text/model orchestration.
- OpenAI image generation for concept art, sprite sheets, frame edits, and
  projectile drafts.
- Local Python normalization for sprite cleanup.
- Local QA validator for publish gates.
- Local file storage until R2 is ready.

The architecture still treats all of those as replaceable adapters.

If we later use Anthropic for text, only `textModel` changes. If we later use
Runway for video, only `videoGenerator` or `imageGenerator` changes. If we later
move from local disk to R2, only `assetStorage` changes.

## API And Tool Design

The admin dashboard and any AI tool layer should call the game content API, not
vendor SDKs.

Good API shape:

```text
POST /api/characters/:id/drafts
POST /api/characters/:id/generate-sprite-sheet
POST /api/characters/:id/normalize
POST /api/characters/:id/validate
POST /api/characters/:id/publish
```

Good AI tools:

```text
create_character_draft()
generate_sprite_sheet()
set_frame_anchor()
update_move_phase()
run_sprite_normalization()
run_fighter_qa()
publish_character()
```

These tools should call our API. Our API should call pipeline ports. Vendor
adapters sit behind those ports.

## Conversational Admin Agent

The admin dashboard exposes a chat surface backed by `POST /api/chat`. The chat
agent is provider-pluggable:

```bash
CMS_CHAT_PROVIDER=local
CMS_CHAT_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_RESPONSES_MODEL=gpt-5.5
```

The local provider is a deterministic smoke-test fallback. It routes obvious
requests such as draft creation, draft updates, asset listing, and pipeline
status checks through the same CMS tool registry.

The OpenAI provider uses the Responses API with function tools from
`createCmsTools()`. The model never edits files or storage directly:

```text
admin chat
  -> /api/chat
  -> chat agent provider
  -> CMS tool schemas
  -> tool registry invocation
  -> pipeline ports
  -> storage / image generation / normalizer / QA / publisher
```

This keeps the workflow replaceable. Anthropic, a local model, or a specialized
workflow engine should only need a new chat-agent adapter as long as it can
choose from the same tool contracts.

## Health Status

`GET /api/health`, `GET /api/pipeline`, and the `get_pipeline_status` tool all
return adapter health. Health is intentionally per-port so the dashboard can
show, for example, that file storage is working while image generation is only a
local placeholder and fighter QA is not production-ready yet.

## Testing Rule

Every new provider adapter should have:

- A contract test using the same port method names.
- A no-network mock test for orchestration.
- A small live smoke test gated by provider credentials.

Current smoke tests:

```bash
npm run cms:import-fighters
npm run cms:smoke
npm run cms:chat:smoke
npm run cms:pipeline:smoke
npm run cms:e2e
```

The pipeline smoke test proves that orchestration can run without OpenAI,
Runway, R2, or a database. That is the point, and frankly, a miracle with shoes.

## Local Admin Server

Run the local CMS/admin platform with:

```bash
npm run cms:admin
```

Default URL:

```text
http://127.0.0.1:8787
```

The admin server exposes:

```text
GET  /api/health
GET  /api/pipeline
GET  /api/tools
GET  /api/tools?format=openai
POST /api/tools/:toolName
GET  /api/chat/health
POST /api/chat
GET  /api/characters
GET  /api/characters/:id/draft
GET  /api/characters/:id/assets
POST /api/characters/:id/assets
GET  /api/assets/:storageKey
```

`POST /api/characters/:id/assets` writes directly to the pluggable CMS storage
adapter. The local dashboard uses it for sprite-frame, move-sheet, projectile,
source-image, and custom asset uploads; future API-backed agents can use the
same path or the `add_character_asset` tool with `relativePath`,
`contentBase64`, `contentType`, and optional metadata.

This is the first working E2E slice:

```text
admin UI -> HTTP API -> tool registry -> pipeline ports -> local adapters -> file storage
```

What is deliberately still placeholder-backed:

- `imageGenerator`: deterministic SVG sprite-sheet generator.
- `spriteNormalizer`: placeholder normalized manifest writer.
- `fighterQa`: placeholder QA report writer.
- `publisher`: local release JSON writer without hard publish gates.

These placeholders are not throwaway architecture. They are adapters. Replace
them one port at a time with OpenAI, Runway, local Python, R2, or queue-backed
workers.
