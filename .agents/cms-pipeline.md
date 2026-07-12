# Thousand Fighters — CMS Pipeline Skill

## Architecture

Hexagonal architecture: ports define interfaces, adapters implement them, the pipeline orchestrates through ports.

## Ports (`cms/pipeline/ports.js`)

| Port | Methods | Env Var |
|------|---------|---------|
| `assetStorage` | getJson, putJson, getBytes, putBytes, getMetadata, exists, list, delete, urlFor | `CMS_STORAGE_PROVIDER` |
| `characterRepository` | listCharacters, getDraft, saveDraft, createVersion, writeAsset, writeQaReport | (uses assetStorage) |
| `textModel` | completeStructured | `TEXT_MODEL_PROVIDER` |
| `imageGenerator` | generateImage | `IMAGE_GENERATOR_PROVIDER` |
| `soundGenerator` | generateAudio | `SOUND_GENERATOR_PROVIDER` |
| `spriteNormalizer` | normalizeFighterPack | (local only) |
| `fighterQa` | validateFighterPack | (local only) |
| `publisher` | publishCharacter | (local only) |
| `jobQueue` | enqueue, getJob | `JOB_QUEUE_PROVIDER` |

## Adding a New Adapter

1. Define port in `cms/pipeline/ports.js` (PipelinePort + PortMethods)
2. Create adapter class with: `id`, `provider`, `capabilities`, `healthCheck()`, port methods
3. Create factory `createXAdapter.js` — reads env var, returns correct adapter
4. Add `createLocalPlaceholderX()` in `localAdapters.js` (must work with zero API keys)
5. Add `createMockX()` in `mockAdapters.js`
6. Register in `cms/runtime/createLocalCmsRuntime.js`
7. Verify with `assertPortAdapter(port, adapter)` — it checks all required methods exist

## CMS Tools (`cms/tools/createCmsTools.js`)

Tools are agent-callable functions. Pattern:
```javascript
{
  name: 'tool_name',
  description: 'What it does.',
  inputSchema: objectSchema({
    param1: stringSchema('Description.'),
    param2: stringSchema('Description.'),
  }, ['param1']),  // required params
  execute: async ({ param1, param2 }) => {
    const result = await pipeline.method({ param1, param2 });
    return { result };
  },
}
```

Current tools: `list_characters`, `get_character_draft`, `get_character_assets`, `create_character_draft`, `update_character_draft`, `generate_sprite_sheet`, `normalize_sprite_pack`, `add_character_asset`, `validate_fighter_pack`, `publish_character`, `get_pipeline_status`, `generate_character_sfx`, `generate_bgm`, `upload_character_sound`, `generate_arena_background`

## Chat Agents

- `OpenAiResponsesCmsChatAgent` — multi-turn agent with function calling via OpenAI Responses API. Supports parallel tool calls (`CMS_PARALLEL_TOOL_CALLS` env var).
- `LocalCmsChatAgent` — deterministic keyword-based routing for offline testing.
- Codex CLI module — uses `codex exec` for local automation.

## Storage Providers

- `file` (default) — local filesystem at `CMS_FILE_STORAGE_ROOT` (default: `cms-data`)
- `r2` — Cloudflare R2 via S3-compatible API
- `supabase` — Supabase Storage
- `cached` — wraps any provider with in-memory LRU cache

## Smoke Test Pattern

Every adapter/tool gets a smoke test at `scripts/smoke_cms_*.mjs`:
```javascript
import { createLocalCmsRuntime } from '../cms/runtime/createLocalCmsRuntime.js';
const { tools, pipeline, registry } = createLocalCmsRuntime({ storageOptions: { root: tmpDir } });
const result = await tools.invoke('tool_name', { ...params });
assert(result, 'expected condition');
```

Run all: `npm run cms:pipeline:smoke`, `npm run cms:sound:smoke`, `npm run cms:arena:smoke`
