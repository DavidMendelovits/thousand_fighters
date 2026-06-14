/**
 * smoke_cms_gym_save.mjs
 *
 * Contract test for the Character Gym persistence tool `save_gym_edits` (T12/A2/A3).
 *
 * Unlike smoke_cms_export §9 (which exercises the convert override layer on
 * in-memory literals), this drives the actual tool against a FileCmsStorage
 * repository and then RE-READS from storage, proving the round-trip:
 *
 *   gym edit -> save_gym_edits -> storage -> reload -> convert reflects it
 *
 * Covers: two-store write, set/unset of overrides (delete a key), in-place
 * hitbox-number patching without clobbering the moves array, knockback-shape
 * preservation, and per-half partial-failure reporting.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CharacterContentRepository } from '../cms/repositories/CharacterContentRepository.js';
import { FileCmsStorage } from '../cms/storage/FileCmsStorage.js';
import { createCmsTools } from '../cms/tools/createCmsTools.js';
import { convertDraftToCharacterConfig } from '../cms/export/convertDraftToCharacterConfig.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const DRAFT = {
  id: 'gym_fighter',
  displayName: 'Gym Fighter',
  lifecycle: 'draft',
  // scale resolves to 1 (no silhouetteHeight), so frame-px overrides map 1:1.
  sprite: { scale: 1, frameCounts: { base: 1, punch: 3 } },
  moves: [
    {
      id: 'chop',
      animation: 'punch',
      phases: [
        { name: 'startup', frames: 2, events: [] },
        {
          name: 'active',
          frames: 4,
          events: [
            {
              frame: 0,
              event: {
                type: 'hitbox_active',
                hitbox: { x: 0, y: 0, width: 1, height: 1, damage: 40, hitstun: 12, knockbackX: 4, knockbackY: 0 },
              },
            },
          ],
        },
        { name: 'recovery', frames: 2, events: [] },
      ],
    },
    {
      // Second move — must stay untouched by a patch targeting 'chop'.
      id: 'jab',
      animation: 'punch',
      phases: [
        { name: 'active', frames: 3, events: [{ frame: 0, event: { type: 'hitbox_active', hitbox: { x: 0, y: 0, width: 1, height: 1, damage: 20, hitstun: 8 } } }] },
      ],
    },
  ],
};

const FRAME_DATA = {
  anchorConvention: 'feet-center',
  frames: {
    base: [
      { file: 'sprites/base/base_001.png', width: 200, height: 280, anchor: { x: 100, y: 270 }, hurtbox: { x: -30, y: -120, width: 60, height: 120 } },
    ],
    punch: [
      { file: 'sprites/punch/punch_001.png', width: 200, height: 280, anchor: { x: 100, y: 270 }, attackBox: { x: 40, y: -90, width: 30, height: 20 } },
      { file: 'sprites/punch/punch_002.png', width: 260, height: 280, anchor: { x: 100, y: 270 }, attackBox: { x: 80, y: -92, width: 70, height: 24 } },
      { file: 'sprites/punch/punch_003.png', width: 200, height: 280, anchor: { x: 100, y: 270 }, attackBox: { x: 40, y: -90, width: 30, height: 20 } },
    ],
  },
};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    failed++;
  }
}

/** Returns the hitbox_active EVENT (keyframes live on the event, geometry on event.hitbox). */
function activeHitboxEvent(cfg, moveId) {
  const move = cfg.moves.find((m) => m.id === moveId);
  for (const phase of move?.phases ?? []) {
    for (const e of phase.events) if (e.event.type === 'hitbox_active') return e.event;
  }
  return null;
}

let rootDir;
try {
  rootDir = await mkdtemp(path.join(os.tmpdir(), 'smoke-gym-save-'));
  const storage = new FileCmsStorage({ rootDir: path.join(rootDir, 'cms-data') });
  const repository = new CharacterContentRepository(storage, { clock: () => new Date('2026-06-14T00:00:00.000Z') });
  const tools = createCmsTools({ repository, pipeline: {}, registry: {} });
  const save = (input) => tools.invoke('save_gym_edits', input);
  const frameDataKey = 'characters/gym_fighter/assets/fighter-pack/frameData.json';

  // Seed draft + frameData asset.
  await repository.saveDraft('gym_fighter', DRAFT);
  await repository.writeAsset('gym_fighter', 'fighter-pack/frameData.json', Buffer.from(`${JSON.stringify(FRAME_DATA, null, 2)}\n`), { contentType: 'application/json' });

  // -------------------------------------------------------------------------
  console.log('\n[1] frameData-only save (Phase 1 path still works)');

  await test('frameData half reports saved', async () => {
    const tuned = JSON.parse(JSON.stringify(FRAME_DATA));
    tuned.frames.base[0].anchor = { x: 105, y: 268 };
    tuned.frames.base[0].anchorEdited = true;
    const res = await save({ characterId: 'gym_fighter', frameData: tuned });
    assert.equal(res.ok, true);
    assert.equal(res.frameData.status, 'saved');
    assert.equal(res.draft, undefined, 'no draft half attempted when only frameData sent');
  });

  await test('frameData written wholesale to storage (re-read)', async () => {
    const stored = await storage.getJson(frameDataKey);
    assert.deepEqual(stored.frames.base[0].anchor, { x: 105, y: 268 });
    assert.equal(stored.frames.base[0].anchorEdited, true);
  });

  // -------------------------------------------------------------------------
  console.log('\n[2] overrides set -> reload -> convert reflects (round-trip)');

  await test('overrides half reports saved', async () => {
    const res = await save({
      characterId: 'gym_fighter',
      overrides: {
        hurtboxes: { idle: { x: -10, y: -100, width: 20, height: 100 }, crouch: { x: -40, y: -60, width: 80, height: 60 } },
        hitboxes: { chop: { default: { x: 5, y: -50, width: 12, height: 8 } } },
      },
    });
    assert.equal(res.ok, true);
    assert.equal(res.draft.status, 'saved');
    assert.equal(res.frameData, undefined, 'no frameData half attempted when only overrides sent');
  });

  await test('draft.overrides persisted to storage', async () => {
    const draft = await repository.getDraft('gym_fighter');
    assert.deepEqual(draft.overrides.hurtboxes.idle, { x: -10, y: -100, width: 20, height: 100 });
    assert.deepEqual(draft.overrides.hitboxes.chop.default, { x: 5, y: -50, width: 12, height: 8 });
  });

  await test('convert from reloaded draft+frameData reflects the override', async () => {
    const draft = await repository.getDraft('gym_fighter');
    const frameData = await storage.getJson(frameDataKey);
    const cfg = convertDraftToCharacterConfig({ draft, frameData, manifest: null });
    assert.deepEqual(cfg.hurtboxes.idle, { x: -10, y: -100, width: 20, height: 100 });
    const ev = activeHitboxEvent(cfg, 'chop');
    assert.deepEqual({ x: ev.hitbox.x, y: ev.hitbox.y, width: ev.hitbox.width, height: ev.hitbox.height }, { x: 5, y: -50, width: 12, height: 8 });
    assert.equal(ev.keyframes, undefined, 'static override clears keyframes (A4)');
  });

  // -------------------------------------------------------------------------
  console.log('\n[3] in-place hitbox-number patch (no array clobber)');

  await test('number patch reports the matched event count', async () => {
    const res = await save({
      characterId: 'gym_fighter',
      hitboxNumbers: [{ moveId: 'chop', damage: 99, hitstun: 25, knockbackX: 7 }],
    });
    assert.equal(res.ok, true);
    assert.equal(res.draft.status, 'saved');
    assert.equal(res.draft.patchedEvents, 1);
  });

  await test('numbers patched in place; knockback stays flat (shape preserved)', async () => {
    const draft = await repository.getDraft('gym_fighter');
    const hb = draft.moves.find((m) => m.id === 'chop').phases.find((p) => p.name === 'active').events[0].event.hitbox;
    assert.equal(hb.damage, 99);
    assert.equal(hb.hitstun, 25);
    assert.equal(hb.knockbackX, 7, 'flat knockbackX updated in place');
    assert.equal(hb.knockback, undefined, 'did not introduce a competing nested knockback shape');
  });

  await test('moves array not clobbered (other move + structure intact)', async () => {
    const draft = await repository.getDraft('gym_fighter');
    assert.equal(draft.moves.length, 2);
    const jab = draft.moves.find((m) => m.id === 'jab');
    assert.equal(jab.phases[0].events[0].event.hitbox.damage, 20, 'jab untouched');
    const chop = draft.moves.find((m) => m.id === 'chop');
    assert.equal(chop.phases.length, 3, 'chop phases intact');
    assert.deepEqual(draft.overrides.hurtboxes.idle, { x: -10, y: -100, width: 20, height: 100 }, 'overrides untouched by number-only save');
  });

  // -------------------------------------------------------------------------
  console.log('\n[4] unset an override (reset to measured deletes the key)');

  await test('unset drops idle but keeps crouch', async () => {
    const res = await save({
      characterId: 'gym_fighter',
      // idle omitted == unset; crouch retained.
      overrides: { hurtboxes: { crouch: { x: -40, y: -60, width: 80, height: 60 } }, hitboxes: {} },
    });
    assert.equal(res.ok, true);
    const draft = await repository.getDraft('gym_fighter');
    assert.equal(draft.overrides.hurtboxes.idle, undefined, 'idle override deleted');
    assert.ok(draft.overrides.hurtboxes.crouch, 'crouch override retained');
    assert.deepEqual(draft.overrides.hitboxes, {}, 'chop hitbox override cleared');
  });

  await test('convert after unset falls back to measured idle', async () => {
    const draft = await repository.getDraft('gym_fighter');
    const frameData = await storage.getJson(frameDataKey);
    const cfg = convertDraftToCharacterConfig({ draft, frameData, manifest: null });
    // measured idle = base frame 0 hurtbox (x:-30,y:-120,w:60,h:120) at scale 1.
    assert.deepEqual(cfg.hurtboxes.idle, { x: -30, y: -120, width: 60, height: 120 });
    const ev = activeHitboxEvent(cfg, 'chop');
    assert.ok(Array.isArray(ev.keyframes), 'measured keyframe track restored after hitbox override unset');
  });

  // -------------------------------------------------------------------------
  console.log('\n[5] partial failure is reported per-half');

  await test('frameData error + draft success -> ok:false, halves distinct', async () => {
    // A character with a draft but NO frameData.json asset: the frameData half
    // must fail while the draft half still succeeds.
    await repository.saveDraft('no_frames', { id: 'no_frames', moves: [] });
    const res = await save({
      characterId: 'no_frames',
      frameData: { frames: {} },
      overrides: { hurtboxes: { idle: { x: -1, y: -1, width: 2, height: 2 } }, hitboxes: {} },
    });
    assert.equal(res.ok, false, 'overall not ok when a half failed');
    assert.equal(res.frameData.status, 'error');
    assert.match(res.frameData.error, /frameData\.json/);
    assert.equal(res.draft.status, 'saved', 'draft half still persisted despite frameData failure');
    const draft = await repository.getDraft('no_frames');
    assert.ok(draft.overrides.hurtboxes.idle, 'draft override saved');
  });

  await test('draft error (no draft) reported without throwing', async () => {
    const res = await save({ characterId: 'ghost', overrides: { hurtboxes: {}, hitboxes: {} } });
    assert.equal(res.ok, false, 'tool returns a result instead of throwing');
    assert.equal(res.draft.status, 'error');
    assert.ok(res.draft.error, 'an error message is surfaced for the draft half');
  });
} finally {
  if (rootDir) await rm(rootDir, { force: true, recursive: true });
}

console.log('');
console.log(`CMS gym save smoke test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
