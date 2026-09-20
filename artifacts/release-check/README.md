# Version-bound motion review — September 19, 2026

## Recorded workflow

Open [review-workflow.mp4](review-workflow.mp4) (18.3 seconds, 1440 × 1000). The raw browser capture is [review-workflow.webm](review-workflow.webm).

The recording uses the real local workbench and existing Palimpsest draft. It briefly opens the readiness queue, opens idle in the shared Animation Lab viewer, plays and steps motion, then opens the exact-version approval form. The notes visible in the form are historical notes, not a new approval. The confirmation is left unchecked and nothing is submitted. The opening queue transition is brief; this is a short review-flow capture, not a narrated tutorial.

No generation credits, published assets, or production approvals were changed. This is not an end-to-end new-character creation or gameplay acceptance video.

The exported MP4 was played in the browser and inspected at multiple times, including its ending review form. `contact.jpg` samples the encoded output; `playback-*.png` are actual video-player screenshots. `review-form.png` and `mobile-readiness.png` document the live UI. Mobile was checked at 390px with no horizontal document overflow.

## Verification

- Unit/integration suite: 131 passing tests, including ten readiness/fingerprint tests.
- Browser: six passing checks — CMS, history, readiness and library on Chromium; readiness and library on mobile Chromium.
- The isolated readiness browser test approves a row, replaces its pixels in disposable test storage, then verifies stale status and disabled publication. It does not mutate the real fighter library.
- TypeScript, production build and keyless CMS full-flow smoke pass. The existing large runtime bundle warning remains.
- Read-only audit parsed all 157 currently previewable workbench rows with no geometry/schema failures; this is not visual approval.
- Custom move rows, reference/pixel/timing changes, stale submissions, legacy unversioned reviews, missing/clipped assets, unknown/placeholder QA and changes during validation are covered.

Commands:

```sh
npx tsx --test tests/*.test.ts tests/*.test.js
npx playwright test tests/publish-readiness.spec.js tests/admin-cms.spec.js tests/workbench-library.spec.js tests/character-history.spec.js --project=chromium
npx playwright test tests/publish-readiness.spec.js tests/workbench-library.spec.js --project=mobile-chrome
npx tsc --noEmit
npx vite build
node scripts/smoke_cms_full_flow.mjs
```

## Scope and remaining gates

The primary CMS publication path enforces these checks; internal developer export and legacy form-install paths still need equivalent hardening. Review pins are local integrity checks, not authenticated reviewer signatures or distributed transaction guarantees. A passing checklist is structural evidence, not automatic visual approval or gameplay quality. Existing published copies remain unchanged. New fighters default to strict coverage; legacy non-strict drafts explicitly display their warning policy.
