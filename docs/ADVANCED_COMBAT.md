# Advanced combat and unified studio

## Try it

- Studio: `/animation-lab.html?workspace=combat` (Brine selected).
- Arena: `/?p1=brine&p2=meridian&cpu=off`.
- P1: WASD movement; F punch; G linking kick; H signature; down+H alternate; down+G launcher; F+G grab. Shift dashes; jump then down+Shift performs a downward air dodge into a wavedash. Direction chooses forward/back. Double-tap a direction also dashes.
- E activates the fighter's power-up; Q transforms Brine or Taffy. P2 equivalents: arrows, J/K/L, N dash, O power, U form.
- Pause help documents the new controls; touch controls include dash, power and form buttons.

## Rules actually implemented

Eight independent multipliers: melee attack/defense, projectile attack/defense, speed, knockback, weight and size. Damage uses the appropriate attack/defense channel. Weight resists displacement. Size changes both artwork and collision geometry, including the pushbox: getting larger is not a free visual buff. Projectile offensive stats are snapshotted when fired.

Every Oddity has three authored cancel-route recipes, including a launcher branch and a different starter. These form a directed graph, not an automatically played sequence. F → G → down+H on Brine is browser-tested as a true three-hit combo. Enders differ by fighter; range and airborne height still determine whether a route connects. Not all recipe permutations are guaranteed true combos at every distance. Cancels require the current move's confirmed hit; block and whiff cannot authorize a hit-only route. A projectile from an earlier move cannot confirm the current one.

Combo ownership lives on the defender. Once the defender becomes actionable, a new hit starts a fresh combo even if the old counter is still briefly displayed. Damage scales by 12 percentage points per preceding hit, to a 30% floor. Knockback grows through a combo, while the eighth hit or fourth airborne follow-up forces knockdown. Knockdown/get-up are protected from immediate re-hits. Linking kicks retain proximity; finishers provide the heavier displacement.

Dashes last 13 simulation ticks and can attack-cancel after four. Air dodge is once per airtime; downward landing retains momentum with eight ticks of wavedash recovery. The downward version grants no invulnerability. This is a fighting-game adaptation of wavedashing, not an exact recreation of Smash's physics.

Power-ups use meter, compose stat modifiers multiplicatively and refresh by ID rather than stacking themselves. Values are bounded. The roster's six-second boosts cost 25 meter; fighters start at 60 and earn meter through contact. Modifiers and form timers advance on the 60 Hz simulation clock, pausing during hitstop and pause. Reset/KO clears them.

## Transformation invariant

`CharacterConfig.forms[]` contains `{id, name, durationTicks, cost, config}`. The child is a full CharacterConfig with its own ID, moves and sprite pack, `parentId` equal to its owner, and `selectable:false`. `durationTicks:null` means until KO; a positive integer means timed. Explicit `transform` / `revert_form` move events are also available.

Entering a form replaces the entire active config and recreates its actors. No attack-time texture swap and no parent animation fallback are used. Finishing an attack, getting hit, landing or idling continues to resolve against the form. Health and player identity remain continuous. Expiry cancels a current attack but preserves an existing hurt/capture state; KO restores the base form without healing. Published child configs are kept in `/forms`, outside character select, and roster loading also rejects parented/non-selectable entries.

- Brine / Abyssal Admiral: 12 seconds, 50 meter, larger/heavier independent squid-admiral pack and Undertow Crown move.
- Taffy / Sugarstorm: until KO, 50 meter, faster/larger caramel-boxer pack and Sugar Glass Break move.

Both own their full moveset data and eight distinct keyposes; shared basics are copied deliberately, while signature presentation and form-exclusive moves differ. These two examples demonstrate the system. The other eight fighters do not yet have authored forms. Old, excluded built-in multi-actor fusion content has not been migrated.

## Projectile generation and contact

Projectile generation now creates an `effects/<projectileId>/impact.json` companion alongside the projectile asset and stores the same descriptor on the projectile draft/runtime config. Ink, thread, electricity, shards, spores, pressure and binding have different deterministic contact shapes, colors and lifetimes. Blocked contact is visually distinct. Effects expire on simulation ticks, with a bounded queue. These are code-rendered pixel-style effects, **not newly generated raster impact sheets**; no extra image-provider call is billed for the companion.

## One studio, preserved authoring

Animation Lab is now the entry shell for Motion review, Characters & assets, Combat & forms and Pipeline & tools. The existing CMS workbench is embedded intact: drafts, frame editing, generation, QA, publish, activity and tools are retained. Switching authoring/pipeline tabs preserves the same iframe and unsaved edits. Leaving an embedded live arena unloads it so a hidden match does not keep running.

The combat panel reads the published ten-fighter roster. CMS drafts remain their existing separate authoring records; no existing remote draft was overwritten or silently imported. An advanced JSON editor saves combat stats, power-ups and complete hidden forms to a draft, with validation; publishing remains a separate explicit action. Legacy CMS routes redirect into this shell; `?standalone=1` retains a standalone recovery path. Vite proxies `/cms-admin` and `/api` to the existing CMS server. Run `npm run dev` and `npm run cms:admin`; no new Doppler variables are needed.

## Research translated into decisions

These are design interpretations, not claims that copying a checklist produces competitive balance:

| Source | Design takeaway | Implementation / asset consequence |
|---|---|---|
| [Dan Fornace: 10 Tips](https://fornace.medium.com/dan-fornaces-10-tips-for-making-a-fighting-game-e2c982da2396) | Responsive actions, character personality and legible feedback matter together. | Existing fixed-step/input buffering retained; character-specific enders, short hitstop, displacement and companion impacts. Generated motion is retimed to gameplay, never allowed to dictate sluggish startup. |
| [Josh Bycer: Fighting Game Design Fundamentals](https://game-wisdom.com/critical/fighting-game-design-fundamentals) | Responsive movement and expressive offensive/defensive options need readable transitions. | Branching routes, guarded/whiff restrictions, dash recovery, different stat channels and counterplay through distance. |
| [David Sirlin: Showing Frame Advantage](https://www.sirlin.net/posts/a-fighting-game-first-showing-frame-advantage) | Recovery information and actual spacing make advantage understandable. | Explicit phase/cancel metadata and lab inspection; guaranteed three-hit route tested at a defined spacing. A live frame-advantage overlay is a future improvement, not shipped here. |
| [Mariel Cartwright: Powerful and Effective Animation for 2D/3D Games](https://www.gdcvault.com/play/1021657/Powerful-and-Effective-Animation-for) | Strong key poses and intentional timing are essential within combat budgets. | Independent form sheets, authored holds/startup/contact/recovery, silhouette checks and no accidental return to base art. |

## Motion generation contract and limits

**Yes, video remains the source of coherent motion for the existing 13 signature moves.** Their compiled frames/provenance are preserved. Video is an animation source, not the combat simulation. This update's two form packs are normalized AI-generated keyposes, not video-derived full-motion packs; dedicated walk/dash/hurt cycles still need a content pass. Dash rows currently reuse available poses. None of those shortcuts should be mistaken for finished animation coverage.

For each future action: start from the accepted character/form reference; fixed side camera; preserve silhouette and palette across one video; separate actor, projectile, aura and contact layers; extract frames with one shared scale/palette and consistent root anchors. Acrobatics and morphs must preserve intended changing bounds instead of equalizing each frame's height. Author root travel and timing separately from hitboxes. Grabs need one isolated actor and a victim attachment trajectory, not an opponent baked into its pixels. Generate the transformed idle/locomotion/hurt/attack coverage as one independent pack before shipping that form.

Acceptance: inspect normalized sheets, in-game contact poses and actual movement; test both facings, edge-of-range hits, held opponents, interruption, pause, expiry and KO. Artifact schemas and green tests do not replace visual acceptance. Network rollback, ranked balance, full frame-advantage UI and production-grade animation coverage are not part of this implementation.

## Verification

`node --import tsx --test tests/*.test.ts`, `npx tsc --noEmit`, browser specs for advanced combat/unified studio/roster/animation lab, `npm run phase4:smoke`, `npm run cms:export:smoke`, and `npm run build`. Browser tests exercise genuine engine updates and keyboard input; fixture-only form/KO operations are explicitly training-gated. Tests do not spend provider credits or publish CMS drafts.

Verified 2026-09-16: 26 unit tests; 20 desktop and 14 mobile browser checks; phase-4 CMS/engine smoke suite; 62 export assertions; pipeline smoke; TypeScript and production build. The build retains the existing large Phaser chunk warning. The provider-billing integration test in `admin-cms.spec.js` was not run against live accounts. Screenshots are in `artifacts/advanced-combat/`. Production CMS-only hosting remains standalone unless a game/studio host is configured; this change was verified locally, not deployed.
