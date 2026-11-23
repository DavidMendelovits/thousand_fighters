# Thousand Fighters v2

A fighter is a ~1KB JSON file. Everything else is shared.

```bash
npm run dev         # studio + game at http://localhost:5180
npm run check    # type-check, validate every saved fighter, fuzz 1000 generated ones
npx tsx cli.ts roster 1000   # write 1000 fighters to fighters
```

## How it works

- `kit.ts` — one skeleton, ~47 key poses, one MK-style move list (4 attack buttons + block, command
  normals, uppercut launcher, sweep, overhead, jump attacks, throw, 5 special archetypes). A hitbox is
  the striking limb in the move's strike pose, so art and collision cannot drift apart.
- `sim.ts` — deterministic 60Hz simulation with no DOM. Dial strings, special cancels, juggles with a
  cap, damage scaling, hitstop, throws, projectiles, a CPU opponent.
- `validate.ts` — plays every move, string and special in the real sim and asserts the result. Runs
  live in the studio on each edit and in `cli.ts` over the roster.
- `design.ts` — description → fighter, instantly. Swap in a text model by returning a `FighterDef`.
- `render.ts` / `main.ts` — canvas renderer and the studio page.
- `sprite.ts` — how a painted sheet animates between its cells: dissolves for idle, walk and recovery, a smear
  on the strike frame, squash and shake on hit, tilt while launched. Pure, so it can be previewed in Node.
- `match.ts` — best-of-3 rounds: intro, fight, round result, next round, match result. Fight mode plays it
  against the CPU or a second player on the same keyboard (arrows + numpad, or `; ' . /`) or a second gamepad.
- `vite.config.ts` — dev server plus the save API. Storage is `fighters/<id>.json` (+ `<id>.png`).
  Only Faro is on the roster for now. `fighters/benched/` holds fighters kept out of the roster, game and
  checks (Palimpsest). Move a file up into `fighters/` to bring it back.

## The move schema

Every move, universal or per-fighter, is one `Move` object (see `kit.ts`). Beyond frame data and a hit it can
combine: motion / direction / chord inputs, air versions, follow-ups (`from`), string-only steps, meter `cost`,
self-movement (`drive`), projectiles (`proj`: straight, arcing, stationary traps, aimed at the opponent, multi-hit,
tethered), `teleport`, invulnerability, `armor`, multi-hit (`rehit`), `grab` (close, anti-air, comboable),
`pull` (drag in from any range), `unblockable`, `heal`, `counter`, `buff` (power-ups) and moves that need one.
A move with a `motion`, or `special: true`, is a special: grounded normals cancel into it on contact.
A forward or back that starts a motion has to be a tap (10 ticks or less), so walking never turns a command normal into a special.
A string step with a `dir` only dials while that direction is held.
A fighter adds `moves`, custom `poses`, and `tweaks` to universal moves. `fighters/faro.json` uses all of it.

Combos: launchers that send the opponent straight up can be jump-cancelled (hold up on contact, or set `jc`),
and in the air any air move not used yet this jump cancels on contact (jump punch › jump kick › air special).
Anti-air grabs catch launched opponents too. Hitstun shrinks from the 4th hit of a combo on, so plain links
(jab, jab, jab...) run dry while strings and cancels still connect.

## Sprites

The rig is placeholder art and also the pose guide. Studio → Sprites → "Download pose sheet" gives a
8×6 grid of 256px cells, one per key pose. Any image model that repaints that sheet as the character
(same layout, flat background) produces a drop-in sheet: "Import painted sheet" keys out the
background and the fighter renders from it. `python3 paint.py <pose sheet> fighters/<id>.png "<description>"` automates that: it paints six poses per
request against one character reference and snaps each result back onto the rig. Its provider is one function, `paint()`.
