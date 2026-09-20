# Palimpsest

A living acrylic-paint spiral inspired by the supplied paintings: crimson,
lavender, ochre, charcoal contours and a teal vortex core. Movement comes from
flow, coiling, pooling and deformation rather than articulated human limbs.

## Controls and mechanics

- A/D move; W jumps; S melts into a crouched paint pool; Shift dashes.
- F: Ribbon Flick. G: Undertow (low). H: Impasto (heavy pushback).
- Down + F: Rising Ochre, an anti-air liquid whip.
- F + G: Wet Binding, a grounded paint-tether grab. Jump to evade.
- Down + H: Borrowed Hands, costs 30 meter and lasts 240 simulation ticks.
- While hands are active, WASD controls their separate world-space position.
  F thrusts the needle; G briefly grabs at contact; H recalls them early.
- The core stays visible and vulnerable. It cannot move or block while the
  hands have control. A hit to either actor dismisses the hands; timeout,
  recall, knockout and reset also clear them and their buffered attacks.
- Ribbon Flick can hit-confirm into Undertow, then Impasto. These are short
  interrupt windows, not long stun locks.

Summons use the reusable `summon_control` / `recall_summon` events,
`Move.controlledActor`, and `FighterActorConfig.summon`. Actor hitboxes remain
separate from the body's position. Both actors share the fighter's health.

## Animation pack

20 video-derived rows, 24 frames each: 480 unique exported frame files. `base`
aliases the reviewed idle row; it is not another 24 generated frames.
Rows cover idle, forward/back flow, jump, landing, crouch, guard, hurt, get-up,
dash, five body attacks, summon, and four separate hands actions.
Knockdown/KO hold the crouched pool rather than rotating a humanoid body.

The reference model is BFL FLUX.2 Klein. Selected motion uses Pruna
`p-video-2-pro`, 768p quality, five-second image-to-video clips. White-background
references preserved the lavender palette better than the rejected magenta
attempts. The compiler uses one scale and a fixed nonhuman origin, preserves
disconnected components, and grows the canvas when extensions require it.
Crouch and get-up are explicitly trimmed to the relevant state transitions.

## Storage and reproduction

- Final runtime: `public/fighters/palimpsest/`.
- CMS draft: `cms-data/characters/palimpsest/draft/content.json`.
- CMS pack: `characters/palimpsest/assets/fighter-pack-paint-v1`.
- Selected source videos and compilations: `generated/palimpsest/motion-v3/`.
- Rejected attempts remain in `motion-v1/`, `motion-v2/`, and reference versions.
- Reviewed selections: `docs/palimpsest-reviewed-motion.json`.
- Immutable source/reference blobs and version events: CMS lineage storage.
- Every provider image/video attempt has generation-attempt telemetry.

`generate_palimpsest_motion.mjs [action...]` resumes existing requests and skips
compiled candidates. Do not edit version paths to overwrite old attempts.
`install_palimpsest.ts` refuses to overwrite an installed character; subsequent
changes should use the CMS revision/version workflow.

## Verification

`tests/palimpsest.spec.js` exercises live keyboard control transfer, remote
damage, recall, exact expiry, interruption, knockout and reset. The config test
checks CMS preservation of summon payloads, actor hitboxes and input mappings.
The Python regression test checks that lavender and detached hands survive
background removal.

The gameplay capture script uses browser keyboard inputs against the live
engine: a choreographed two-player opening followed by the normal CPU opponent.
No forced hits, teleports, health edits or animation-preview buttons are used.
This is a playable first pass, not a claim of tournament balance.

The saved workbench profile uses `artStyle: paint`, per-row motion prompts, and
explicit hand-actor references. Regeneration therefore keeps the paint-aware
white-background compiler rather than falling back to humanoid pixel motion.
The current pack was generated through the shared API/CLI transport; the
regeneration profile is wired but no additional paid UI regeneration was run.
# Workbench geometry revision — September 19

Character content was edited through the workbench Data → Tune panels, saved,
validated and published through the UI. A pre-edit frozen checkpoint is named
“Before workbench collision and layered grip tuning”.

- Hitbox x/y/width/height and active-tick motion tracks are editable per contact.
- `geometrySource: authored` prevents measured extraction from replacing a tuned contact on export.
- Grip sockets, lift/swing, held frame range and `layerSplitY` are editable for configured summon grabs.
- The generated sprite is cropped into complementary rear/front layers only during capture; no duplicate hand artwork is generated.
- Creation schema supports collision tracks; video regeneration receives paired-grab staging instructions and preserves gameplay metadata.
- Versioned pack roots are recognized by workbench QA, including `fighter-pack-paint-v1`.

Current QA: zero errors, three legacy-format warnings (fixed four-move names,
missing per-frame boundary fields, and missing legacy normalization report).
These warnings were not force-overridden. Motion-review reports remain the
source of the existing video clipping checks. This revision does not introduce
automatic anatomy recognition or automatic creation of separate summon packs.

# Shape and grip revision — September 18

Five replacement video-derived rows: diamond guard, dripping-star Impasto,
branching Rising Ochre, orbiting/fanning hands, and an articulated capture.
Selected sources are under `generated/palimpsest/motion-v4` (pinch) and
`motion-v5` (other four). Rejected clipped generations remain archived.
Review plans: `palimpsest-shape-review.json`, `palimpsest-hands-review.json`.

`GrabSpec.actorGrip` attaches the victim's scaled torso center to a summon
socket. A four-tick settle leads into a 24-tick lift/swing; both rendered hands
and the victim share that position. Facing is latched, interruptions/expiry
drop the hold, and throw direction follows the summon rather than its owner.
The actor grip suppresses generic tether/ring artwork. This is a paired 2D
sprite attachment, not skeletal finger IK or per-pixel anatomy recognition.

`scripts/revise_palimpsest.ts` checkpoints before and after installing reviewed
rows, updates CMS actor metadata, and exports the runtime pack. The workbench
now reserves additional source-frame space for paint transformations.
