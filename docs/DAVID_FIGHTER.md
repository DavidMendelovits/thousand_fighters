# David — playable prototype

Reference-based pixel-art likeness: swept brown hair, colorful shirt, black trousers, wired microphone. Raw personal photos are not shipped in the public pack.

| Input | Move | Behavior |
| --- | --- | --- |
| F | Mic Jab | Quick normal; confirms into kick or cascade |
| G | Stage Kick | Links into balls, ink or sound |
| H | Three-ball Cascade | Three staggered, gravity-driven juggling balls |
| Toward + H | Mic Projection | Sound-wave projectile with heavy pushback |
| Down + H | Ink to Impact | Ink droplet resolves into a fist; launches on hit |
| Away + H | Mic-cord Reel | Travelling microphone catches grounded opponents, wraps and reels in |
| F + G | Close Cable Throw | Short-range grab and throw |

Mobile uses the corresponding movement direction and action buttons. Movement/dash/block are the shared engine controls.

Hit-confirm routes include jab → kick → cascade, cascade → sound, cascade → ink, and reel release → cascade. Grabs have whiff recovery and can be jumped. No additional long-duration stun is added by this kit. Impact shapes, cord wrapping and projectile trajectories are independent engine visuals, not baked into the body image.

## Art and limitations

BFL FLUX.2 Klein generated the reference and initial action key poses through the real API. The public runtime pack still contains those inadequate key-pose placeholders; it is not the completed motion deliverable.

After the credit top-up, Kling 3 Standard through FAL produced four video sources. The CMS draft now contains a reviewed 21-frame forward walk and 20-frame punch compiled from video, with fixed character scale, shared palette and grounded anchors. Backward walking was rejected for turning toward the camera. The kick was rejected for a clipped generated effect. The idle job returned HTTP 403 `TOP_UP`, including on a same-job resume. Remaining animations are blocked; no complete motion pack has been published.

The shared workbench video adapter now compiles variable-length motion instead of six cells, supports custom move rows, and records candidates as pending visual review. Generate All requests movement, reactions and authored moves, two jobs at a time. Full-motion drafts cannot publish until all required rows are approved. This gate runs before release creation and runtime export. Automated geometry/diversity checks do not establish visual quality; direction, identity and action readability still require review.

Candidate tooling: `generate_character_motion.mjs` (durable paid API job), `compile_character_motion.py` (offline compilation), and `import_motion_candidate.mjs` (draft-only import, optional explicit review notes). Both the workbench and CLI use the same compiler and installation module. Workbench end-to-end completion has not yet been revalidated after these changes.

Ten successful BFL attempts (including one replacement cable pose) and the failed FAL attempt are recorded in `generated/david/attempts.jsonl` and the local CMS benchmark store. Private generated sources stay under the ignored `generated/` folder.

## Rebuild without paid calls

```
python3 scripts/build_david_assets.py
npx tsx scripts/export_david.ts
node scripts/build_assets_index.mjs
node scripts/import_david_to_cms.mjs
```

The import is restricted to David and preserves authored collision geometry, sprite scale, moves, cancel links and combat stats. It also installs the canonical base reference for later workbench video generation. Reimport replaces David's draft, so do not run it over later workbench edits without reconciling them.

Tests: `npx playwright test tests/david-combat.spec.js --project=chromium`.
Live keyboard-controlled demonstration: `node scripts/record_david_gameplay.mjs`.
