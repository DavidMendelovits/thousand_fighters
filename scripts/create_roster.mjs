/**
 * Headless roster builder — drives the same CMS tools the admin chat uses to
 * create full characters end to end: draft (move kit) → concept → per-row
 * sprites → frame extraction → normalize → projectile sprites → QA → publish →
 * runtime export. Idempotent: every generate step is skipped if its asset
 * already exists, so a crash on char N never re-burns chars 1..N-1.
 *
 * Run under doppler so the real codex image/text providers are wired:
 *   doppler run -- node scripts/create_roster.mjs
 *   LIMIT=1 doppler run -- node scripts/create_roster.mjs   # probe one char
 *   ONLY=el_cometa doppler run -- node scripts/create_roster.mjs
 */

import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { createLocalCmsRuntime } from '../cms/runtime/createLocalCmsRuntime.js';
import { exportCharacterToRuntime } from '../cms/export/exportCharacterToRuntime.js';
import { SHEET_IDS } from '../shared/animationRows.js';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const FIGHTERS_DIR = path.join(REPO_ROOT, 'public', 'fighters');

// We generate the FULL engine row set (SHEET_IDS): base, normals, specials,
// movement (jump/crouch/dash/walk), defense (block), and grapple (grab/throw).
// base is first in SHEET_IDS so it anchors every other row's reference image.
// State/locomotion rows reuse one short action note across characters — the
// per-row motion arc comes from ROW_PROMPT_PROFILES; identity comes from spec.
const STATE_ROW_ACTIONS = {
  jump: 'jumping straight up — crouch-load, spring off the ground, rise to an apex, then fall',
  crouch: 'lowering from standing down into a settled, held crouch',
  dash_forward: 'an explosive forward dash that recovers to neutral',
  dash_back: 'an explosive backward hop/retreat that recovers to neutral',
  block: 'raising into a settled, held defensive guard',
  walk_forward: 'walking forward in a smooth continuous looping step cycle',
  walk_back: 'stepping backward in a smooth continuous looping cycle',
};

// ---- The roster. identity is restated on every row prompt (gpt-image-2 keeps
// identity better with repetition); the per-move line describes the action. The
// adapter adds the 1x6 / magenta-bg framing + frame roles from ROW_PROMPT_PROFILES.
const SPECS = [
  {
    id: 'el_cometa',
    name: 'El Cometa',
    brief:
      'A high-flying acrobatic luchador grappler with a comet-and-stars motif. ' +
      'He bounces off the ropes, lands diving body presses, and chains throws into suplexes. ' +
      'His kit is grapple-heavy: a running lariat, a dropkick, a spinning comet dropkick special, ' +
      'and a rising star uppercut. He hurls one projectile — a spinning throwing-star ("estrella"). ' +
      'Flashy, heroic, crowd-pleasing. Medium weight, strong throws, average speed.',
    identity:
      'El Cometa, a high-flying luchador in a star-spangled crimson and gold mask with a flowing ' +
      'comet-tail cape, muscular acrobatic build, red wrestling boots and trunks, bold cel-shaded ' +
      'anime fighting-game style, full body, facing right',
    rows: {
      base: 'bouncing lightly on his toes, fists up in a confident wrestler stance',
      punch: 'throwing a running lariat / clothesline with his outstretched arm',
      kick: 'launching a flying dropkick with both boots extended',
      special_1: 'a spinning comet dropkick, body horizontal, cape trailing like a comet tail',
      special_2: 'a rising star uppercut, leaping upward with a fist trailing star sparkles',
      grab: 'reaching out and clinching the opponent in a wrestling collar-and-elbow tie-up',
      throw: 'hoisting the gripped opponent overhead into a spinning suplex and slamming them down',
    },
    projectile: 'a spinning golden five-pointed throwing star wrapped in a comet streak',
  },
  {
    id: 'inversa',
    name: 'Inversa',
    brief:
      'An acrobatic capoeira fighter who fights almost entirely upside-down in handstands. ' +
      'All of her offense is kicks and cartwheels from inverted positions — a low handstand ' +
      'sweep, a helicopter kick, a cartwheel approach, and an au-batido axe kick special. ' +
      'Tricky mixups, fast, low damage, hard to pin down. No projectiles — pure footsie acrobatics.',
    identity:
      'Inversa, a lithe athletic capoeira fighter balancing in a one-handed handstand, green and ' +
      'white capoeira garb with a headband, barefoot, motion of inverted kicks, vibrant anime ' +
      'fighting-game style, full body, facing right',
    rows: {
      base: 'balancing in a low ginga sway, weight shifting between hands and feet, ready to invert',
      punch: 'a quick cartwheel strike, one leg whipping out sideways',
      kick: 'a helicopter kick spinning upside-down on her hands, legs scything outward',
      special_1: 'a handstand leg-sweep, fully inverted, sweeping both legs low across the ground',
      special_2: 'an au-batido axe kick, kicking up into a handstand then slamming a heel straight down',
      grab: 'catching the opponent in a scissoring leg-clinch from a low cartwheel',
      throw: 'rolling backward and flipping the clinched opponent overhead with both legs',
    },
    projectile: null,
  },
  {
    id: 'velo_courier',
    name: 'Velo',
    brief:
      'A cyberpunk bike courier who fights from a neon hover-cycle. Hit-and-run pressure: short ' +
      'dashing strikes, a tire-screech slide, a charge-dash ram special, and a handlebar uppercut. ' +
      'She throws spinning glowing wheel-discs as projectiles. Very fast, mobile, fragile. Sci-fi.',
    identity:
      'Velo, a cyberpunk bike courier riding a sleek neon hover-cycle, aerodynamic jacket, goggles, ' +
      'messenger bag, glowing wheel rims trailing light, sleek sci-fi anime fighting-game style, ' +
      'full body, facing right',
    rows: {
      base: 'idling on the hover-cycle, wheels humming, leaning ready to burst forward',
      punch: 'a quick handlebar jab while rolling forward on the cycle',
      kick: 'a tire-screech slide kick, the front wheel skidding into the opponent',
      special_1: 'a charge-dash ram, crouched low over the cycle blasting forward in a streak of light',
      special_2: 'a handlebar uppercut, popping a wheelie and launching the opponent upward',
      grab: 'snagging the opponent with a whipped messenger-bag strap as the cycle skids in',
      throw: 'spinning the cycle and slinging the caught opponent away in a streak of light',
    },
    projectile: 'a spinning glowing neon wheel-disc hurled forward, edge crackling with energy',
  },
  {
    id: 'kitsune_stride',
    name: 'Stride',
    brief:
      'A fox-spirit wind-runner built for pure rushdown. Leaves motion-blur afterimages as she ' +
      'closes distance: rapid palm strikes, a running knee, a dash-through afterimage special, and ' +
      'a spinning tail-whip. Throws a compact wind-gust projectile. Lightning fast, low damage, ' +
      'relentless pressure. Anime fox-spirit.',
    identity:
      'Stride, a fox-spirit wind-runner with white-and-orange kitsune ears and three flowing tails, ' +
      'a long trailing scarf, lightweight running gear, faint motion-blur afterimages behind her, ' +
      'energetic anime fighting-game style, full body, facing right',
    rows: {
      base: 'light on her feet, scarf and tails drifting, coiled to sprint',
      punch: 'a rapid double palm-strike thrust forward, afterimages trailing the arms',
      kick: 'a running knee strike driving forward off a sprint',
      special_1: 'a dash-through, blurring forward leaving a streak of fox-fire afterimages',
      special_2: 'a spinning tail-whip, pivoting to lash all three tails outward in an arc',
      grab: 'darting in to seize the opponent by the collar with afterimages trailing',
      throw: 'pivoting into a running judo throw, flinging the opponent past her in a blur',
    },
    projectile: 'a small swirling crescent of white wind and fox-fire',
  },
  {
    id: 'sir_chuckle',
    name: 'The Jester',
    brief:
      'A whimsical fantasy court-jester trickster mage who fights with slapstick. He swings a ' +
      'belled slapstick scepter, conjures a jack-in-the-box surprise, and taunts to power up. ' +
      'He throws two kinds of projectile gags — cream pies and exploding playing cards. Comedic, ' +
      'unpredictable, mid-range zoner with goofy mixups. Storybook fantasy.',
    identity:
      'The Court Jester, a whimsical harlequin trickster in a purple-and-gold motley with a ' +
      'three-pointed belled cap, mischievous grin, wielding a slapstick scepter, whimsical ' +
      'storybook anime fighting-game style, full body, facing right',
    rows: {
      base: 'capering in place, juggling the scepter hand to hand, bells jingling',
      punch: 'a slapstick scepter bonk swung overhead',
      kick: 'a goofy exaggerated boot kick, leg comically high',
      special_1: 'a jack-in-the-box springing up beside him, lid bursting open with a surprise',
      special_2: 'flinging a fan of exploding playing cards forward with a flourish',
      grab: 'hooking the opponent around the neck with a curved shepherd-crook cane',
      throw: 'tossing a banana peel underfoot so the opponent slips and bounces away',
    },
    projectile: 'a tumbling cream pie trailing whipped-cream splatter',
  },
];

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

async function timed(label, fn) {
  const t0 = Date.now();
  try {
    const out = await fn();
    log(`  ✓ ${label} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    return out;
  } catch (err) {
    log(`  ✗ ${label} FAILED (${((Date.now() - t0) / 1000).toFixed(1)}s): ${err.message}`);
    throw err;
  }
}

async function createCharacter(runtime, spec) {
  const { tools, storage, repository } = runtime;
  const id = spec.id;
  log(`=== ${spec.name} (${id}) ===`);

  // Helper: skip a generate if its asset already exists (idempotency).
  const exists = (key) => storage.exists(key);
  const srcKey = (moveId) => `characters/${id}/assets/source/${id}_${moveId}_sheet.png`;

  // 1. Draft (move kit: moves, combos, projectiles)
  await timed('draft', async () => {
    const existing = await repository.getDraft(id).catch(() => null);
    if (existing?.moves?.length) return existing;
    return tools.invoke('create_character_draft', { characterId: id, brief: spec.brief });
  });

  // Generate the FULL engine row set so every locomotion/state/grapple animation
  // exists — not just attack rows. A move (or the gym) referencing a row with no
  // sheet renders empty. spec.rows gives flavor for attack/grab rows; state rows
  // fall back to a shared action note; the motion arc comes from the row profile.
  const draftForRows = await repository.getDraft(id);
  const rowsNeeded = SHEET_IDS;
  const descForRow = (row) =>
    spec.rows[row]
    ?? STATE_ROW_ACTIONS[row]
    ?? (draftForRows.moves ?? []).find((m) => m.animation === row)?.description
    ?? `${row} animation`;

  // 2. Concept art — identity anchor for every row's reference image
  await timed('concept', async () => {
    if (await exists(`characters/${id}/assets/concept/concept_art.png`)) return;
    return tools.invoke('generate_character_concept', {
      characterId: id,
      prompt: `Character concept art (front, profile, back views) of ${spec.identity}.`,
    });
  });

  // 3. Sprite rows (base first), then extract frames into the fighter pack
  for (const moveId of rowsNeeded) {
    const desc = descForRow(moveId);
    await timed(`row:${moveId}`, async () => {
      if (await exists(srcKey(moveId))) return;
      return tools.invoke('generate_sprite_sheet', {
        characterId: id,
        moveId,
        prompt: `${spec.identity}. This row shows him/her ${desc}.`,
      });
    });
    await timed(`extract:${moveId}`, () =>
      tools.invoke('extract_row_frames', {
        characterId: id,
        sourceAssetKey: srcKey(moveId),
        moveId,
      }),
    );
  }

  // 4. Normalize the pack (fills any gaps, preserves extracted rows)
  const normalized = await timed('normalize', () =>
    tools.invoke('normalize_sprite_pack', { characterId: id, sourceAssetKey: srcKey('base') }),
  );
  const normalizedKey = normalized.normalized?.outputKey ?? normalized.outputKey;

  // 5. Projectile sprites for whatever the draft declared (themed by spec)
  const draft = await repository.getDraft(id);
  const projIds = (draft.projectiles ?? []).map((p) => p.id);
  if (spec.projectile && projIds.length) {
    for (const pid of projIds) {
      await timed(`projectile:${pid}`, async () => {
        if (await exists(`characters/${id}/assets/source/${id}_${pid}_projectile.png`)) return;
        return tools.invoke('generate_projectile', {
          characterId: id,
          projectileId: pid,
          prompt: `${spec.projectile}, on a magenta background, single sprite.`,
        });
      });
    }
  } else {
    log(`  (no projectiles to sprite: declared=${projIds.length}, spec=${Boolean(spec.projectile)})`);
  }

  // 6. QA gate
  const qa = await timed('qa', () =>
    tools.invoke('validate_fighter_pack', { characterId: id, normalizedKey }),
  );
  const qaStatus = qa.qa?.status ?? qa.status;
  log(`  QA: ${qaStatus}`);
  if (qaStatus === 'fail') {
    const errs = (qa.qa?.checks ?? qa.checks ?? []).filter((c) => c.status === 'error');
    throw new Error(`QA failed: ${JSON.stringify(errs)}`);
  }

  // 7. Publish (auto-bridges export) + explicit export to repo public/fighters
  await timed('publish', () =>
    tools.invoke('publish_character', { characterId: id, releaseId: `roster-${id}` }),
  );
  const exported = await timed('export', () =>
    exportCharacterToRuntime({
      runtime: { repository, storage },
      characterId: id,
      outputDir: FIGHTERS_DIR,
      copyAssets: true,
    }),
  );
  log(`  exported ${exported.filesCopied?.length ?? '?'} files → public/fighters/${id}`);
  return { id, qaStatus };
}

async function main() {
  const runtime = createLocalCmsRuntime({
    // No image/text options → factories read IMAGE_GENERATOR_PROVIDER / TEXT_MODEL_PROVIDER
    // (codex) from the doppler env. Sound is mock so any SFX call won't throw.
    soundGeneratorOptions: { provider: 'mock' },
  });

  const only = process.env.ONLY?.split(',').map((s) => s.trim());
  const limit = process.env.LIMIT ? Number(process.env.LIMIT) : SPECS.length;
  const todo = SPECS.filter((s) => (only ? only.includes(s.id) : true)).slice(0, limit);
  log(`Providers: image=${process.env.IMAGE_GENERATOR_PROVIDER} text=${process.env.TEXT_MODEL_PROVIDER}`);
  log(`Building ${todo.length} character(s): ${todo.map((s) => s.id).join(', ')}`);

  const results = [];
  for (const spec of todo) {
    try {
      results.push(await createCharacter(runtime, spec));
    } catch (err) {
      log(`!! ${spec.id} aborted: ${err.stack ?? err.message}`);
      results.push({ id: spec.id, error: err.message });
    }
  }

  // Rebuild the asset index once so the roster discovers the new fighters.
  await timed('build_assets_index', () =>
    execFileAsync('node', [path.join(REPO_ROOT, 'scripts', 'build_assets_index.mjs')]),
  );

  log('=== summary ===');
  for (const r of results) log(`  ${r.id}: ${r.error ? 'ERROR ' + r.error : r.qaStatus}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
