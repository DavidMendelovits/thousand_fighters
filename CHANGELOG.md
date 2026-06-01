# Changelog

All notable changes to Thousand Fighters.

## [0.1.0.0] - 2026-05-31

### Added
- CMS admin platform with roster workbench and character creation wizard
- Hexagonal-architecture CMS pipeline with 10 ports, 17 adapters, 5 storage backends
- Per-move 1x6 sprite row generation with independent Generate/Regen per move
- AI-powered character creation: concept art, draft generation, sprite sheets, frame extraction, QA validation, publishing
- Chat assistant with Codex CLI integration for natural-language CMS operations
- Error detail modal with "Diagnose with Codex" button
- Per-move activity log dialog and loading states on move cards
- Unified activity feed (merged chat + run log)
- Creation wizard state persistence via localStorage
- Reference image upload and analysis
- Supabase, R2, and cached storage backends
- OpenAI Responses API and Codex CLI adapters for text and image generation
- ElevenLabs and OpenAI sound generation adapters
- Contour-based sprite normalizer and fighter pack QA validator
- 15 backend smoke tests with real assertions
- 3 Playwright E2E test suites (admin CMS, move generation, error modal)
- DESIGN.md documenting CMS admin design tokens and component patterns
- Collapsible pipeline inspector panel

### Changed
- Sprite generation switched from one 5x6 grid to five independent 1x6 row sheets
- Asset route validates keys to prevent path traversal

### Fixed
- Codex chat agent health check error on /roster (missing registry/gaps on runtime shim)
