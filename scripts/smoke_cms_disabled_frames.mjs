/**
 * smoke_cms_disabled_frames.mjs — per-frame hitbox disabling ("Delete hit on
 * frame", gym). A hitbox's active window is defined by hitbox_active/hitbox_end
 * events; `hitbox.disabledFrames` lists sprite-frame indices the move must NOT
 * hit on. convert carves those frames out of the window, splitting it into one
 * active/end pair per surviving run — so the move genuinely stops hitting there,
 * not merely changes the box shape.
 *
 *   - middle frames disabled  → window splits into two pairs
 *   - leading frames disabled  → window shrinks (one pair, later start)
 *   - all frames disabled      → the hit is removed entirely
 *   - out-of-window frame      → no-op, field stripped
 *   - the transient disabledFrames field never reaches the runtime config
 *   - save_gym_edits hitboxNumbers persists/clears hitbox.disabledFrames on the draft
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CharacterContentRepository } from '../cms/repositories/CharacterContentRepository.js';
import { FileCmsStorage } from '../cms/storage/FileCmsStorage.js';
import { createMockImageGenerator } from '../cms/pipeline/adapters/mockAdapters.js';
import { CharacterCreationPipeline } from '../cms/pipeline/CharacterCreationPipeline.js';
import { PipelineRegistry } from '../cms/pipeline/PipelineRegistry.js';
import { PipelinePort } from '../cms/pipeline/ports.js';
import { createCmsTools } from '../cms/tools/createCmsTools.js';
import { convertDraftToCharacterConfig } from '../cms/export/convertDraftToCharacterConfig.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    failed += 1;
  }
}

// A single 6-tick 'active' phase over a 6-frame row → tick t maps to sprite
// frame t (even distribution: floor(t/6 * 6) === t). The hitbox is active on
// ticks 0..4 (hitbox_active@0 → hitbox_end@5).
function draftWithDisabled(disabledFrames) {
  return {
    id: 'jab_fighter',
    moves: [
      {
        id: 'jab',
        animation: 'punch',
        trigger: { sequence: ['lp'] },
        phases: [
          {
            name: 'active',
            frames: 6,
            events: [
              { onFrame: 0, event: { type: 'hitbox_active', id: 'default', hitbox: { x: 0, y: -10, width: 10, height: 10, damage: 5, disabledFrames } } },
              { onFrame: 5, event: { type: 'hitbox_end', id: 'default' } },
            ],
          },
        ],
      },
    ],
  };
}

// 6 frames, each carrying an attackBox so the measured-geometry pass also runs
// (proving the split cooperates with geometry, not just bare events).
const FRAME_DATA = {
  frames: { punch: Array.from({ length: 6 }, () => ({ anchor: { x: 5, y: 16 }, width: 10, height: 16, attackBox: { x: 0, y: -10, width: 10, height: 10 } })) },
};

/** Active windows as absolute [start, end) tick ranges, derived from the converted move. */
function windows(move) {
  const phases = move.phases;
  const starts = [];
  let cum = 0;
  for (const p of phases) { starts.push(cum); cum += p.frames ?? 1; }
  const total = cum;
  const open = new Map();
  const out = [];
  phases.forEach((phase, i) => {
    for (const entry of phase.events ?? []) {
      const tick = starts[i] + (entry.onFrame ?? 0);
      const ev = entry.event;
      if (ev.type === 'hitbox_active') open.set(ev.id ?? 'default', tick);
      else if (ev.type === 'hitbox_end') {
        const s = open.get(ev.id ?? 'default');
        if (s !== undefined) { out.push([s, tick]); open.delete(ev.id ?? 'default'); }
      }
    }
  });
  for (const s of open.values()) out.push([s, total]);
  return out.sort((a, b) => a[0] - b[0]);
}

function convertMoveWith(disabledFrames) {
  const config = convertDraftToCharacterConfig({ draft: draftWithDisabled(disabledFrames), frameData: FRAME_DATA, manifest: null });
  return config.moves.find((m) => m.id === 'jab');
}

// A move whose timing is NOT 1:1 with sprite frames. The active phase runs 12
// ticks over the same 6-frame row, so spriteFrameAt(t,12,6) = floor(t/2): each
// sprite frame spans TWO ticks (frame 2 → ticks 4,5). This is the realistic
// shape and the only thing that proves the carve maps frames→ticks rather than
// treating disabledFrames as raw tick indices.
function convertMoveMultiTick(disabledFrames) {
  const draft = {
    id: 'jab_fighter',
    moves: [{
      id: 'jab',
      animation: 'punch',
      trigger: { sequence: ['lp'] },
      phases: [{
        name: 'active',
        frames: 12,
        events: [
          { onFrame: 0, event: { type: 'hitbox_active', id: 'default', hitbox: { x: 0, y: -10, width: 10, height: 10, damage: 5, disabledFrames } } },
          { onFrame: 10, event: { type: 'hitbox_end', id: 'default' } },
        ],
      }],
    }],
  };
  return convertDraftToCharacterConfig({ draft, frameData: FRAME_DATA, manifest: null }).moves.find((m) => m.id === 'jab');
}

// A move with an explicit, non-uniform visualTimeline — exercises the OTHER
// branch of spriteFrameAt. frame 1 is held for ticks 1,2,3.
function convertMoveVisualTimeline(disabledFrames) {
  const draft = {
    id: 'jab_fighter',
    moves: [{
      id: 'jab',
      animation: 'punch',
      trigger: { sequence: ['lp'] },
      visualTimeline: [{ frame: 0, duration: 1 }, { frame: 1, duration: 3 }, { frame: 2, duration: 2 }],
      phases: [{
        name: 'active',
        frames: 6,
        events: [
          { onFrame: 0, event: { type: 'hitbox_active', id: 'default', hitbox: { x: 0, y: -10, width: 10, height: 10, damage: 5, disabledFrames } } },
          { onFrame: 5, event: { type: 'hitbox_end', id: 'default' } },
        ],
      }],
    }],
  };
  return convertDraftToCharacterConfig({ draft, frameData: FRAME_DATA, manifest: null }).moves.find((m) => m.id === 'jab');
}

function allEvents(move) {
  return move.phases.flatMap((p) => p.events ?? []).map((e) => e.event);
}

// ---------------------------------------------------------------------------
console.log('\n[A] convert carves disabled frames out of the active window');

test('middle frames [2,3] split the window into [0,2) and [4,5)', () => {
  const move = convertMoveWith([2, 3]);
  assert.deepEqual(windows(move), [[0, 2], [4, 5]]);
  const actives = allEvents(move).filter((e) => e.type === 'hitbox_active');
  assert.equal(actives.length, 2, 'two activations after split');
  assert.ok(actives.every((e) => e.hitbox && e.hitbox.damage === 5), 'each sub-window keeps the hitbox payload');
});

test('leading frames [0,1] shrink the window to [2,5)', () => {
  assert.deepEqual(windows(convertMoveWith([0, 1])), [[2, 5]]);
});

test('trailing frame [4] shrinks the window to [0,4)', () => {
  assert.deepEqual(windows(convertMoveWith([4])), [[0, 4]]);
});

test('every active frame disabled removes the hit entirely', () => {
  const move = convertMoveWith([0, 1, 2, 3, 4]);
  assert.deepEqual(windows(move), []);
  assert.equal(allEvents(move).filter((e) => e.type === 'hitbox_active').length, 0, 'no hitbox_active survives');
});

test('a frame outside the active window [5] is a no-op', () => {
  assert.deepEqual(windows(convertMoveWith([5])), [[0, 5]]);
});

test('no disabledFrames leaves the single window intact', () => {
  assert.deepEqual(windows(convertMoveWith([])), [[0, 5]]);
  assert.deepEqual(windows(convertMoveWith(undefined)), [[0, 5]]);
});

// The discriminating case: frames span multiple ticks, so disabling sprite frame
// 2 must drop BOTH of its ticks (4 and 5). If the code treated disabledFrames as
// raw tick indices it would carve [[0,2],[3,10]] and this assertion would fail.
test('multi-tick row: disabling frame [2] drops both its ticks → [[0,4],[6,10]]', () => {
  assert.deepEqual(windows(convertMoveMultiTick([2])), [[0, 4], [6, 10]]);
});

test('multi-tick row: disabling leading frame [0] (ticks 0,1) → [[2,10]]', () => {
  assert.deepEqual(windows(convertMoveMultiTick([0])), [[2, 10]]);
});

// visualTimeline branch: frame 1 is held over ticks 1,2,3, so disabling it
// carves exactly that span — different from even distribution (which would map
// frame 1 to a single tick).
test('visualTimeline: disabling held frame [1] carves its ticks 1..3 → [[0,1],[4,5]]', () => {
  assert.deepEqual(windows(convertMoveVisualTimeline([1])), [[0, 1], [4, 5]]);
});

// ---------------------------------------------------------------------------
console.log('\n[B] the transient disabledFrames field never reaches the runtime config');

test('converted events carry no disabledFrames (split or no-op)', () => {
  for (const df of [[2, 3], [5], [], [0, 1, 2, 3, 4]]) {
    const move = convertMoveWith(df);
    for (const ev of allEvents(move)) {
      assert.ok(!('disabledFrames' in ev), `disabledFrames leaked for ${JSON.stringify(df)}`);
      if (ev.hitbox) assert.ok(!('disabledFrames' in ev.hitbox), 'disabledFrames leaked into hitbox');
    }
  }
});

// ---------------------------------------------------------------------------
console.log('\n[C] save_gym_edits persists disabledFrames on the draft (gym save path)');

const rootDir = await mkdtemp(path.join(os.tmpdir(), 'thousand-fighters-disabled-'));
try {
  const storage = new FileCmsStorage({ rootDir });
  const repository = new CharacterContentRepository(storage, { clock: () => new Date('2026-06-14T12:00:00.000Z') });
  const registry = new PipelineRegistry({
    [PipelinePort.ASSET_STORAGE]: storage,
    [PipelinePort.CHARACTER_REPOSITORY]: repository,
    [PipelinePort.IMAGE_GENERATOR]: createMockImageGenerator(),
  });
  const pipeline = new CharacterCreationPipeline(registry, { clock: () => new Date('2026-06-14T12:00:00.000Z') });
  const tools = createCmsTools({ pipeline, repository, registry });

  await repository.saveDraft('jab_fighter', draftWithDisabled(undefined));

  const findHitbox = (draft) => draft.moves[0].phases[0].events.find((e) => e.event.type === 'hitbox_active').event.hitbox;

  await tools.invoke('save_gym_edits', {
    characterId: 'jab_fighter',
    hitboxNumbers: [{ moveId: 'jab', hitboxId: 'default', disabledFrames: [3, 1, 1] }],
  });
  const afterSet = await repository.getDraft('jab_fighter');
  test('disabledFrames written, de-duplicated, and sorted', () => {
    assert.deepEqual(findHitbox(afterSet).disabledFrames, [1, 3]);
  });

  await tools.invoke('save_gym_edits', {
    characterId: 'jab_fighter',
    hitboxNumbers: [{ moveId: 'jab', hitboxId: 'default', disabledFrames: [] }],
  });
  const afterClear = await repository.getDraft('jab_fighter');
  test('an empty array clears the field (re-enables every frame)', () => {
    assert.ok(!('disabledFrames' in findHitbox(afterClear)), 'disabledFrames removed');
  });
} finally {
  await rm(rootDir, { force: true, recursive: true });
}

console.log(`\nCMS disabled-frames smoke test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
