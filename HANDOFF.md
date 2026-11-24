# Handoff — Thousand Fighters v2

Written 2026-11-09. Read this, then `v2/README.md`. Everything here is on branch `DM/cms-admin-platform`,
uncommitted, in `v2/` (plus two script lines in the root `package.json`).

## The goal

David wants a fighting game where you describe a character (or give an image) and get a fully playable
fighter fast, with a state-of-the-art feel and real depth. His words: "the most important part of this
fighting game is the flexibility of what a character can do." The roster target is 1,000.

## Why v2 exists

The old code (`src/`, `cms/`, `admin/`, ~70k lines) generated bespoke animation rows per fighter with video
models: about 165s and a human review per row, 26 rows per fighter. Nothing was comparable across fighters,
so nothing could be validated or made fast. v2 inverts it. The old code is untouched and not retired.

## What v2 is

About 1,600 lines, no Phaser, no CMS. `npm run v2` serves the studio and game at http://localhost:5180.

| File | Role |
|---|---|
| `kit.ts` | One skeleton (11-number poses), the universal move list, the `Move` type, `compile()` |
| `sim.ts` | Deterministic 60Hz simulation, no DOM. Also the CPU opponent |
| `validate.ts` | Plays every move/string in the real sim and asserts the result |
| `design.ts` | Description → fighter by keywords and a seed (no language model) |
| `render.ts`, `main.ts`, `index.html` | Canvas renderer and the studio page |
| `vite.config.ts` | Dev server and save API. Storage is `fighters/<id>.json` (+ `<id>.png`) |
| `cli.ts` | Validate saved fighters, fuzz, write roster, re-create the old roster |
| `paint.py` | Paint a fighter's pose sheet with an image model |

Core ideas to keep:

- A fighter is a JSON file. It never authors hitboxes: the hitbox is the striking limb in the move's strike pose.
- Every move is the same `Move` shape. Fighters add `moves`, custom `poses`, and `tweaks` to universal moves.
- Validation is simulation. `npm run v2:check` must stay green (Faro, the one saved fighter, and 1,000 fuzzed ones pass today).

Mechanics a move can combine: motion/direction/chord inputs, air, follow-ups (`from`), string-only steps,
meter `cost`, `drive`, projectiles (straight, arcing, stationary, aimed at the opponent, multi-hit, tethered),
`teleport`, `inv`, `armor`, `rehit`, `grab` (close, anti-air, comboable), `pull`, `unblockable`, `heal`,
`counter`, `buff` and `needs: 'buff'`, `meter`.

## The first character: Faro

`fighters/faro.json`. A drowned lighthouse keeper with a lamp for a head and an anchor chain. 26 own moves
covering every mechanic above; all 36 of his checks pass. David rejected the earlier character (Cinder,
deleted) and said he does not like the character designs so far. The rig art is a puppet placeholder, so
the visual verdict on Faro is still open until he is painted.

## Faro is painted (2026-11-09)

Done: `fighters/faro.png` exists, `"atlas": true` is set, and he renders from sprites in the studio.
The consistency question is answered yes: `gpt-image-2` held one character across all 64 poses in 11
requests (lantern head, coat, chain, boots all stable). One fix was needed: `/images/generations` only
takes JSON, so `paint()` now sends JSON for the reference and multipart for the edits. `OPENAI_BASE_URL`
is plain `api.openai.com`. Whole run took about 4 minutes.

Snapping (2026-11-18): every pose now gets one shared scale (the median of the per-pose fits), and detached
blobs under 5% of the figure are dropped before measuring. Re-snapping from cached batches is free: run
`paint.py` without `OPENAI_API_KEY`. Open: David's verdict on the look. The prone pose (cell 14) runs off its
cell in the painting itself; delete `faro.png.work/batch_12.png` and re-run to repaint that batch if it shows.

## How the paint run works

Doppler works from the agent shell, but only with a clean config directory
(the default one tries the macOS keychain and fails):

```bash
DOPPLER_CONFIG_DIR=$(mktemp -d) doppler run -- python3 v2/paint.py v2/art/faro-poses.png v2/fighters/faro.png \
  "Faro, the Drowned Keeper: a tall gaunt lighthouse keeper whose head is a glowing caged brass lantern, long dark teal oilskin coat, heavy boots, pale grey-blue hands, an anchor chain wrapped around one forearm"
```

- That is 12 paid image requests (1 reference + 11 batches of 6 poses). It is resumable; finished batches are cached in `v2/fighters/faro.png.work/`.
- Doppler has `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL` and `OPENAI_BASE_URL`, plus `FAL_KEY`, `BFL_API_KEY`, `MINIMAX_API_KEY`, `PRUNA_API_KEY`, `GROK_IMAGINE_API_KEY`.
- The model is explicit: `--model`, or `OPENAI_IMAGE_MODEL` from Doppler. With no model set it stops before any request (the old default, `gpt-image-1`, was shut down in Oct 2026). Every run is logged in `fighters/<id>.paint.json` (model, quality, cells, time); commit it with the sheet.
- `paint()` sends to `OPENAI_BASE_URL` when it is set (else `api.openai.com/v1`). Check what Doppler's value points to before a paid run.
- The API call in `paint()` is untested. The keying and snap-to-rig step is tested (lands within 2px on a misaligned fake).
- After it writes the sheet, set `"atlas": true` in `faro.json`, reload the studio, and watch him move. Sprite mode shows the nearest key pose with no blending, so judge it in motion, not as a still sheet.
- `v2/art/faro-poses.png` must be re-exported (Studio → Sprites → Download pose sheet) if Faro's poses or look change.

The real question this answers: can an image model keep one character consistent across 64 poses in 11
separate requests? If not, the fallbacks are fewer poses per request, a stronger reference, or a
pose-conditioned model through `FAL_KEY`.

## Known gaps

- Keyboard and gamepad input have not been tested by a human. Everything was verified through scripted inputs and headless-browser screenshots.
- `design.ts` is keyword-driven. It will not invent a moveset like Faro's; that took hand-authoring. A language model writing the fighter JSON against the `Move` type is the obvious next seam.
- The studio edits custom moves as raw JSON. There is no visual pose editor; poses are typed as 11 numbers.
- Not built: rounds, two players on one keyboard, mobile touch controls, summons, alternate forms, per-fighter sound.
- One validator reference opponent (average size). Size-matchup combo drops are not checked.
- Pulled opponents land visibly overlapping the attacker; cosmetic.

## Working notes

- `npx tsc` needs `npm install` first (done this session; `node_modules` had been empty). `@types/node` is not installed, so `v2/tsconfig.json` excludes `cli.ts` and `vite.config.ts`.
- A session hook blocks `rm -rf` and reads of `node_modules/.bin`.
- The codex CLI cannot generate images on this account: its configured model and four alternatives were rejected.
- Use the gstack `/browse` skill for browser checks, not the Chrome MCP tools (global CLAUDE.md).
- Nothing is committed. 20 older commits on this branch are also unpushed (see `THREAD.md`).

## Repainting single poses and checking a sheet (2026-11-24)

The Faro repaint (PR 19) got 8 of 19 cells right; the other 11 came back as the plain stance. Batches of six
poses against a stance reference pull hard poses back to the stance. `paint.py --keys` repaints named cells one
request each and `qa.py` checks a sheet. Research and sources: the Claude Doc "Thousand Fighters: sprite sheet QA".

```bash
# the 11 wrong Faro frames, up to 3 tries each, each try graded by the yes/no judge
DOPPLER_CONFIG_DIR=$(mktemp -d) doppler run -- python3 paint.py art/faro-poses.png fighters/faro.png \
  "Faro, the Drowned Keeper: a tall gaunt lighthouse keeper whose head is a glowing caged brass lantern, long dark teal oilskin coat, heavy boots, pale grey-blue hands, an anchor chain wrapped around one forearm" \
  --fighter fighters/faro.json --keys hit,jp.w,jk.w,dive.w,dive.s,beam.w,tend.w,tend.s,glass.w,glass.s,swing.w \
  --model gpt-image-2.5-sunburst --quality high --tries 3 --judge
python3 qa.py art/faro-poses.png fighters/faro.png fighters/faro.json   # free checks, writes fighters/faro.qa/contact.png
```

- Add `--dry-run` first: it writes every guide, reference and prompt to the work dir and sends nothing.
- `posedata.ts` turns the rig into per-cell data: joints in cell pixels, airborne or not, which moves use the
  pose, a sentence describing the pose, and yes/no questions the rig already knows the answers to.
- Each request sends three images: the sheet's own idle cell (the character as he already looks in game), the
  nearest pose that is already painted (style only; `--no-near` drops it), and a stick figure with one colour per
  limb (red left arm, blue right arm, green left leg, orange right leg, as seen facing right).
- Each try is checked and the first that passes is kept. Without `--judge` only the free checks run, and they
  do not catch a stance painted in place of a pose: on the labelled Faro cells (`art/faro-qa-labels.json`)
  they flag 2 of the 11 wrong cells and none of the 8 right ones. The judge asks Claude the rig's questions
  about each painted cell (`ANTHROPIC_API_KEY`; `--judge-model claude-haiku-5-5` is the cheap option).
  Before trusting it, run `qa.py ... --calibrate art/faro-qa-labels.json --judge` (19 judge calls).
- The free checks also flag `launch`, `down`, `rush.s` and `rise.s` touching their cell edge in the current sheet.
- Cost: one image request per try, at most `cells x tries`; the work dir caches every try, so re-runs are free.
  At 1024x1024 high, about $0.05 per image on gpt-image-2.5-sunburst and $0.21 on gpt-image-2 (third-party
  calculator, Nov 2026), plus three reference images per request. For the 11 Faro frames: about $0.90 to $2.60 on
  sunburst, $2.60 to $7.90 on gpt-image-2. The judge adds about $0.02 per try on claude-opus-5-5.
  `gpt-image-2` is what painted Faro on Nov 9; sunburst is untested on him.
