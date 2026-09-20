# David: directional moves and authored strings

Staged as a versioned CMS draft, not published. Reference structure: https://fgmoves.com/games/injustice-gods-among-us/moves/batman (basics, directional attacks, air attacks, throws, strings, specials). These are original David commands, not a transcription of Batman's inputs.

## Controls

J = jab (keyboard F), K = kick (G), S = special (H). Forward/back are relative to facing. Grab = F+G together.

Directional jab: forward advancing poke, down low interrupt, back retreating check, down-forward uppercut. Directional kick: forward long poke, down sweep, back rising heel. Air J/K have separate commands. Back+Grab reverses the throw's release direction.

## New routes

J J; J J J; J J K; J J S; J K; forward J J; forward J J K; back J K; K K; K K J; down J K; J J forward S.

Authored string follow-ups can continue on whiff/block after the preceding active phase, leaving their recovery punishable. Existing special cancels remain hit-confirmed. A string is an input route, not a promise that every hit is an inescapable combo: spacing, blocking, hitstun, recovery and startup still determine that.

## Engine contract

`trigger.directions` checks direction at the final button edge. `cancelOnly` prevents continuation nodes from starting in neutral. `activationFrames` defines the input queue lifetime. Edge-specific `cancelOn` supports authored strings without turning every special into a whiff cancel. Consuming one continuation preserves later queued button edges; taking a hit/entering defensive reaction clears old buttons.

## Art and acceptance

27 moves total: 7 existing and 20 expanded moves. All 20 now have dedicated reviewed video-derived rows (24 frames each), bringing the pack to 35 reviewed rows. The 15 earlier rows are preserved. Every expanded move binds its own `requiredAnimation` and has `artStatus: ready`. Publishing still rejects missing/unapproved rows or proxy bindings; this revision remains a draft, not a published release.

The testbed groups moves and lists commands, timing and routes. Individual preview buttons bypass input recognition; engine input/selection/executor tests separately verify real command semantics. Desktop and mobile browser tests play every expanded move through its active phase. Next work: tune visual transitions between string links, hit/whiff/block advantage, and matchup balance in actual matches. Meter-enhanced specials, supers and a full-roster expansion are not part of this revision.

Generation evidence lives in `generated/david-watercolor/expanded-moves-v1`, `v2`, and `v3`; each has source videos, resumable provider job records, candidate frames/contact sheets and reviewed selection plans. There were 35 paid video attempts: 33 Pruna (about 17 seconds mean) and 2 Kling through FAL (about 153 seconds mean), including retries. Selected sources: 18 Pruna and 2 Kling. These are observed end-to-end timings for this batch, not general performance guarantees or cost estimates. All attempts are in the CMS benchmark store and sources are archived by hash. Failed quality candidates remain available; the experimental auto-frame keyer left colored fringes and those candidates were NOT installed.

Final animation checkpoint: `2026-09-18T17-26-19-507Z-5cd8017a-0e42-417f-ac28-796c649845a1`. Engine showcase: `generated/david-watercolor/expanded-moves-final.mp4` (27.5 seconds; testbed move previews, not a match).

Both character and combo creation prompts now require character-specific commands, semantic direction choices, three-button/mobile reachability, alias awareness, and conflict checks. Combo authoring receives the character description/concept/control preferences rather than only move IDs. This is prompt guidance, not a claim that every future generated mapping has been playtested.

Rebuild preview: `node scripts/expand_david_moveset.mjs`. Stage with immutable before/after checkpoints: add `--apply`.
