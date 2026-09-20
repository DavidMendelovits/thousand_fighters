# David: watercolor revision

## September 18 motion batch — current status

All 15 required motion rows now exist and carry review notes in the **draft**:
the previous forward walk and punch plus the remaining 13 rows. Nothing was
published. Checkpoint: `2026-09-18T14-54-43-492Z-59d9b5fd-50be-4652-af3b-a6a003226e4f`.

| New row | Playback frames | Selected source |
| --- | ---: | --- |
| Idle | 22 (12 unique) | Kling; explicit reversible breathing loop |
| Backward walk | 24 | Pruna |
| Jump | 20 | Pruna, simplified body-pose prompt |
| Landing | 16 | Kling, trimmed recovery segment |
| Crouch | 16 | Pruna, leading idle removed |
| Block | 12 | Pruna, compact guard rather than punch-like first attempt |
| Hurt | 20 | Pruna, microphone-retaining minimal prompt |
| Get-up | 20 | Pruna, rising segment only |
| Kick | 20 | Pruna |
| Juggle | 24 | Pruna; second scoop reused for third release |
| Sound | 24 | Pruna |
| Ink | 24 | Pruna |
| Cable | 24 | Pruna |

Three juggling release poses are mapped to unchanged projectile ticks 12, 19,
and 26. This is authored reuse of video frames, not three generated scoops.
Landing animation is compressed into the existing four-tick state. Block and
crouch advance at one tick per frame. Attack contact/recovery markers were
reviewed individually; damage, collision phases, and projectile timings did
not change.

This batch made **27 paid-generation attempts**: 23 Pruna and 4 Kling. All
provider jobs completed, but many clips were rejected for added effects,
clipping, bad poses, or prop loss. Transport latency (preparation through
download, excluding compilation and visual review) averaged **10.926 s** for
Pruna (7.582–34.175 s) and **102.773 s** for Kling (58.834–147.265 s). These
are this batch's observations, not comparable-provider quality benchmarks or
cost estimates. Provider costs were not returned; no dollar total is claimed.

Selections, prompts, import plans, and processing reports:
`generated/david-watercolor/remaining-13-v1/`. Workbench source jobs:
`artifacts/workbench-video-jobs/`. Installed frames:
`cms-data/characters/david/assets/fighter-pack-watercolor-v1/`.
Sources and replacements are also archived in the content-addressed lineage
store. Existing local-only backup limitations still apply.

Validation: complete motion coverage, source hashes, every frame's availability
and anchor, and all three release ticks are checked by
`tests/david-motion-batch.test.js`. Desktop/mobile real-testbed checks passed.
The testbed recording demonstrates five attack sequences, not a full match or
all fifteen state animations. Final subjective art approval still belongs to
the user; generated face/hand detail is not hand-animated perfection.

The September 17 notes below are historical and their incomplete-pack status
has been superseded by this batch.

The new outfit reference supersedes the black-trouser design: bright abstract-print short-sleeve shirt, blue jeans, belt, light sneakers, swept brown hair, handheld microphone. Paint is both his rendering medium and the material of his attacks. Preserve likeness and readable body silhouette; watercolor grain and pigment blooms belong inside the actor/effect, never in the keyable background.

## Action contract

- Mic jab and sweeping kick remain quick close-range confirms, leaving brief pigment accents.
- Pigment Cascade: three independently simulated cyan, coral and yellow watercolor droplets follow juggling arcs.
- Painted Resonance: the microphone projects a broad translucent painted wave; strong knockback, punishable recovery.
- Wet-on-Wet: a travelling pigment droplet resolves into a painted fist and launches the opponent.
- Ribbon Reel: a painted microphone tether unfurls, wraps and pulls the opponent. Grounded grab, jumpable, finite hold.
- Close wrap: short-range painted ribbon throw.

Keep existing move IDs and combat timing so combos remain compatible. Actor animation and spawned paint effects are separate assets. Paint strokes may extend beyond the body canvas; preserve world anchors rather than shrinking the character or cropping splashes.

Required body rows: base reference, idle, forward/back walking, jump, landing, crouch, block, hurt, getup, punch, kick, juggle, sound, ink and cable. Old-outfit animations must not count toward approval of this revision. Do not publish a mixture of old and new outfits.

## Provider experiment

Pruna `p-video-2-pro`, direct API with `PRUNA_API_KEY`. Compare Speed and Quality on the same new reference and action. First tests: five seconds, 480p, prompt upsampler off to avoid added camera/VFX instructions. Preserve provider output, record upload/submission, queue/generation, download and total latency. Every success or failure retains a benchmark receipt. Generated audio is ignored by sprite extraction.

Official contract: https://docs.api.pruna.ai/guides/models/p-video-2-pro

Quality acceptance requires full-body motion, consistent facing/outfit, no clipped effects, stable scale and a visually reviewed loop. Fast completion alone is not acceptance. Workbench integration and runtime verification are separate from obtaining an MP4.

## Measured September 17, 2026

Matched initial five-second walk requests, same image and prompt (single observations,
not averages; FAL chooses its own output resolution):

| Provider | End-to-end | Queue/generation polling interval | Review |
| --- | ---: | ---: | --- |
| Pruna Speed, 480p | 8.433 s | 5.276 s | Facing drift; candidate only |
| Pruna Quality, 480p | 7.788 s | 5.537 s | Facing drift; candidate only |
| FAL Kling v3 Standard | 122.225 s | 120.601 s | Compiled; not approved for this revision |

The polling interval measures time observed by the client, including queue, polling
overhead and remote work—not pure model inference. End-to-end also includes local
preparation, upload/submission, result lookup and download.

Pruna refinements: larger-reference punch 9.248 s (unwanted clipped burst),
larger-reference walk 8.927 s (background changes), end-locked cable 10.093 s
(clipping), end-locked walk 10.900 s (reviewed 24-frame loop installed in draft).
An actual workbench Generate click submitted the idle through Pruna in 10.005 s;
the compiler rejected its unwanted flying effects. All source videos remain available
for audit; rejected generations were not silently marked approved.

The current recommendation is Pruna for rapid candidates with first/last-frame
conditioning and mandatory QA. These samples do not justify replacing every Kling
generation or claiming a production-ready character. The new outfit is isolated in
`fighter-pack-watercolor-v1`; the previous CMS version and old public fighter remain
intact. Paint projectile, morph, ribbon and impact mechanics are wired in the draft.

Kling's follow-up punch completed in 153.582 s. Its 24-frame body pass passed
visual review and is installed with explicit contact frame 10 and recovery frame 20;
the generated hold is compressed without changing hitbox/event timing. Only forward
walk and punch are approved. Remaining state and special-move body rows are unfinished,
so publication is blocked. Testbed moves with missing rows show the new base pose,
not old-outfit art. The prototype's separately simulated paint effects are not
evidence that those missing body animations are complete.

Verification: 8 focused unit tests, 14 existing combat browser regressions, and
the live watercolor draft browser test pass; TypeScript and CMS pipeline/row/image
smokes pass. The browser test exercises actual projectile controls and verifies
that no archived sprite URLs load. A startup race in dummy positioning was repaired.
