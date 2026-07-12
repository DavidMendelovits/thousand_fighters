# Pipeline Orchestration Plan

Branch: `DM/cms-admin-platform`
Created: 2026-05-26
Reviews: /plan-design-review (5->7/10), /plan-eng-review (CLEAR), Codex outside voice

## Goal

Build a pipeline orchestration system for the Thousand Fighters CMS that lets both
humans (via the admin UI) and agents (Codex, cloud agents, CLI) create characters
through a single SSE-streaming endpoint. All new routes live under `/new/` --
the existing `/api/` routes and `create.html` wizard are untouched.

## Architecture

```
                POST /new/pipeline/run
  Browser ──────────────────────────────→ createCmsServer.js
  Agent   ──────────────────────────────→   /new/ route handler
            ←── SSE event stream ────────      │
                                               ▼
                                     PipelineOrchestrator (NEW)
                                        │ step sequencing
                                        │ dependency validation
                                        │ QA gate for publish
                                        ▼
                                     CharacterCreationPipeline (EXISTING)
                                        │ createCharacterDraft()
                                        │ generateCharacterConcept()
                                        │ generateSpriteSheet()
                                        │ normalizeSpritePack()
                                        │ validateFighterPack()
                                        │ publishCharacter()
                                        ▼
                                     Adapters (EXISTING)
                                        │ CodexImageGeneratorAdapter
                                        │   └─ onProgress already wired
                                        │ Local text model, normalizer, QA, publisher
                                        ▼
                                     CMS Storage
                                        characters/{id}/assets/...
                                        (same paths as production)

  LEGACY ROUTES (/api/tools/*, /api/characters/*, etc.) -- UNTOUCHED
```

## API Contract

### POST /new/pipeline/run

Request body:
```json
{
  "characterId": "rooftop_ronin",
  "brief": "A rooftop samurai with a broken antenna...",
  "artStyle": "pixel art",
  "steps": ["concept", "draft", "sprites", "normalize", "qa", "publish"],
  "sourceAssetKey": "characters/rooftop_ronin/assets/source/...",
  "normalizedKey": "characters/rooftop_ronin/assets/fighter-pack/manifest.json",
  "releaseId": "v1-1779788462"
}
```

- `steps` defaults to all 6 if omitted
- `sourceAssetKey`, `normalizedKey`, `releaseId` are required when skipping
  the step that normally produces them (D5: explicit params for skipped steps)

Response: SSE stream (`text/event-stream`)
```
data: {"step":"concept","status":"started"}
data: {"step":"concept","status":"progress","type":"stdout","data":"Codex generating..."}
data: {"step":"concept","status":"complete","asset":{"key":"...","apiUrl":"..."}}
data: {"step":"draft","status":"started"}
data: {"step":"draft","status":"complete","draft":{"displayName":"...","stats":{...}}}
...
data: {"step":"publish","status":"complete","published":{"bundleKey":"...","releaseId":"..."}}
data: {"pipeline":"complete","characterId":"rooftop_ronin","runId":"run_abc123"}
```

Error events:
```
data: {"step":"publish","status":"error","error":"Cannot publish: QA status is 'fail'"}
data: {"pipeline":"error","step":"sprites","error":"Codex timeout after 180s"}
```

### GET /new/pipeline/{runId}

Returns the stored state of a pipeline run (for reconnection after disconnect).

```json
{
  "runId": "run_abc123",
  "characterId": "rooftop_ronin",
  "status": "complete",
  "steps": [
    {"step": "concept", "status": "complete", "asset": {"key": "..."}},
    {"step": "draft", "status": "complete"},
    {"step": "sprites", "status": "complete", "asset": {"key": "..."}},
    {"step": "normalize", "status": "complete"},
    {"step": "qa", "status": "complete", "result": {"status": "pass"}},
    {"step": "publish", "status": "complete", "published": {"bundleKey": "..."}}
  ]
}
```

## Decisions

| # | Source | Decision | Choice | Why |
|---|--------|----------|--------|-----|
| D3 | Design | Progress reporting | SSE streaming | Real-time, both browser and agents handle natively |
| D4 | Design | Progress UX | Full Codex stdout streaming | User chose maximum feedback over simplicity |
| D5 | Design | Agent discovery | Orchestration IS discovery | One endpoint, no separate manifest |
| D6 | Design | Pipeline scope | Steps parameter array | Flexible: run all or run a subset |
| D7 | Design | Storage paths | Same CMS paths | Test characters are real characters |
| E1 | Eng | Callback threading | Passthrough via request.onProgress | Adapter already supports it (line 38) |
| E5 | Eng+Codex | Step dependencies | Require explicit params | Fail fast, no hidden state lookups |
| E6 | Eng+Codex | Publish safety | Gate on QA pass | Prevents publishing broken fighters |

## Implementation Tasks

### T1 (P1) -- PipelineOrchestrator.js
- **New file:** `cms/pipeline/PipelineOrchestrator.js`
- Wraps `CharacterCreationPipeline` methods in a step sequence
- Emits events via a callback: `{step, status, data}`
- Validates step dependencies (sourceAssetKey for normalize, etc.)
- Gates publish on QA pass
- Accepts `steps` array to run a subset
- Stores run state in memory (Map keyed by runId)
- ~20min CC time

### T2 (P1) -- /new/ SSE routes
- **Modified:** `cms/server/createCmsServer.js`
- Add `/new/` prefix check BEFORE static file fallback (line 21)
- `POST /new/pipeline/run` -- parse JSON body, create orchestrator run, stream SSE
- `GET /new/pipeline/{runId}` -- return stored run state
- SSE headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- Handle `response.on('close')` for client disconnect
- ~10min CC time

### T3 (P1) -- onProgress passthrough
- **Modified:** `cms/pipeline/CharacterCreationPipeline.js`
- `generateSpriteSheet()` line 87: add `onProgress: request.onProgress` to imageGenerator.generateImage() call
- `generateCharacterConcept()` line 48: same passthrough
- One-line change per method
- ~5min CC time

### T4 (P2) -- Smoke test
- **New file:** `scripts/smoke_cms_pipeline_orchestrator.mjs`
- Pattern: same as `smoke_cms_e2e.mjs` (tmpdir, local runtime, assert)
- Tests: full pipeline SSE stream, step ordering, selective steps, invalid step name,
  missing dependency params, QA-fail publish gate, unknown runId 404
- Add npm script: `"cms:orchestrator:smoke": "node scripts/smoke_cms_pipeline_orchestrator.mjs"`
- ~10min CC time

### T5 (P2) -- Status endpoint
- **Modified:** `cms/server/createCmsServer.js`
- `GET /new/pipeline/{runId}` returns stored step states and artifacts
- 404 for unknown runId
- ~5min CC time

## What Already Exists (reuse, don't rebuild)

- `CharacterCreationPipeline` -- all 6 pipeline methods
- `CodexImageGeneratorAdapter.generateImage()` -- `onProgress` callback with stdout streaming (line 38-50)
- `spawnWithStdin()` -- `onData` callback for process output (line 185)
- `createCmsServer.js` -- HTTP server, API routing, static serving
- `create.js` -- client-side wizard (legacy, untouched)
- `smoke_cms_e2e.mjs` -- full pipeline test via `/api/tools/`

## NOT in Scope

- Auth/permissions/rate limiting on `/new/` routes (existing architecture gap)
- AbortSignal propagation for client disconnect cancellation (P3)
- Concurrent run isolation for Codex image directory race (low risk for dev tool)
- Stdout sanitization/redaction (acceptable for internal CMS)
- Modifying existing `/api/` routes or `create.html` wizard
- DESIGN.md creation (run /design-consultation separately)

## Codex Outside Voice Findings (accepted/deferred)

Accepted:
- Step dependency validation -- `normalize` needs `sourceAssetKey`, etc. (-> E5)
- Publish gate on QA pass (-> E6)

Noted but deferred:
- Concurrent Codex image race (low risk)
- AbortSignal on disconnect (P3)
- Auth/rate limiting (existing gap)
- Stdout leaking local paths (acceptable for internal tool)
- `/new/` routing intercept (handled in T2)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | -- | -- |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | ISSUES | 12 findings, 2 accepted |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 2 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | ISSUES | score: 5/10 -> 7/10, 4 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | -- | -- |

- **UNRESOLVED:** 0
- **VERDICT:** ENG CLEARED -- ready to implement
