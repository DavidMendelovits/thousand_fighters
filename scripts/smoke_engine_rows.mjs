/**
 * smoke_engine_rows.mjs
 *
 * Engine tests for state-driven animation-row playback (T21). Runs via `tsx`
 * so it imports the REAL implementation from the TypeScript sources — the pure,
 * Phaser-free core of the render decision:
 *   - `resolveStateSheet`, `STATE_ROW_MAP`, `stateRowFrame` from
 *     src/core/animationRowPlayback.ts
 *
 * THE discriminating invariant (what protects every shipped fighter): a fighter
 * that OWNS a row plays it in the mapped state; a fighter that does NOT own the
 * row falls back to `base`, byte-for-byte unchanged.
 */

import assert from 'node:assert/strict';
import { resolveStateSheet, STATE_ROW_MAP, stateRowFrame, STATE_ROW_TICKS, isLoopingStateRow } from '../src/core/animationRowPlayback.ts';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    failed++;
  }
}

// A fighter "owns" a row when its sprite.frameCounts[row] > 0.
const ownsRows = (...rows) => (rowId) => rows.includes(rowId);
const ownsNothing = () => false;

console.log('\n[A] resolveStateSheet — fallback safety (the critical invariant)');
test('a fighter WITH a block row renders "block" in blockstun', () => {
  assert.equal(resolveStateSheet('blockstun', ownsRows('block')), 'block');
});
test('a fighter WITHOUT a block row falls back to "base" in blockstun', () => {
  assert.equal(resolveStateSheet('blockstun', ownsNothing), 'base');
});
test('a fighter WITH a jump row renders "jump" while airborne and at jump_startup', () => {
  const owns = ownsRows('jump');
  assert.equal(resolveStateSheet('airborne', owns), 'jump');
  assert.equal(resolveStateSheet('jump_startup', owns), 'jump');
});
test('a fighter WITH a crouch row renders "crouch" in crouch and crouch_transition', () => {
  const owns = ownsRows('crouch');
  assert.equal(resolveStateSheet('crouch', owns), 'crouch');
  assert.equal(resolveStateSheet('crouch_transition', owns), 'crouch');
});
test('owning only crouch does NOT redirect blockstun (per-row gate, not all-or-nothing)', () => {
  assert.equal(resolveStateSheet('blockstun', ownsRows('crouch')), 'base');
});

console.log('\n[B] resolveStateSheet — unmapped states always render base');
test('idle / hitstun / landing / dead have no row mapping (stay base even if owned)', () => {
  const ownsEverything = () => true;
  for (const state of ['idle', 'hitstun', 'landing', 'getup', 'knockdown', 'dead', 'attack', 'juggle', 'grabbed']) {
    assert.equal(resolveStateSheet(state, ownsEverything), 'base', `${state} must render base`);
  }
});
test('walk states render their own row when owned, else base', () => {
  assert.equal(resolveStateSheet('walk_forward', ownsRows('walk_forward')), 'walk_forward');
  assert.equal(resolveStateSheet('walk_back', ownsRows('walk_back')), 'walk_back');
  // Fallback safety: a fighter without walk rows keeps the base-frame shuffle.
  assert.equal(resolveStateSheet('walk_forward', ownsNothing), 'base');
  assert.equal(resolveStateSheet('walk_back', ownsNothing), 'base');
});
test('STATE_ROW_MAP covers exactly the five state-driven rows', () => {
  assert.deepEqual([...new Set(Object.values(STATE_ROW_MAP))].sort(), ['block', 'crouch', 'jump', 'walk_back', 'walk_forward']);
  // dash/grab/throw must NOT be state-mapped.
  for (const row of ['dash_forward', 'dash_back', 'grab', 'throw']) {
    assert.ok(!Object.values(STATE_ROW_MAP).includes(row), `${row} must not be state-mapped`);
  }
});

console.log('\n[C] stateRowFrame — one-shot advance, holds the last frame');
test('starts on frame 0', () => {
  assert.equal(stateRowFrame(0, 6), 0);
});
test('advances one frame every STATE_ROW_TICKS ticks', () => {
  assert.equal(stateRowFrame(STATE_ROW_TICKS, 6), 1);
  assert.equal(stateRowFrame(STATE_ROW_TICKS * 3, 6), 3);
});
test('holds the last frame past the end (no wrap)', () => {
  assert.equal(stateRowFrame(STATE_ROW_TICKS * 100, 6), 5);
});
test('single-frame and empty rows clamp to 0', () => {
  assert.equal(stateRowFrame(999, 1), 0);
  assert.equal(stateRowFrame(999, 0), 0);
});
test('negative elapsed clamps to frame 0 (visual-delay safety)', () => {
  assert.equal(stateRowFrame(-50, 6), 0);
});

console.log('\n[D] stateRowFrame — loop mode (walk cycles wrap)');
test('loop=true wraps with modulo instead of holding', () => {
  assert.equal(stateRowFrame(0, 6, true), 0);
  assert.equal(stateRowFrame(STATE_ROW_TICKS * 6, 6, true), 0, 'wraps back to frame 0 after a full cycle');
  assert.equal(stateRowFrame(STATE_ROW_TICKS * 7, 6, true), 1, 'continues into the next cycle');
});
test('isLoopingStateRow: walk rows loop; jump/crouch/block hold', () => {
  assert.ok(isLoopingStateRow('walk_forward'));
  assert.ok(isLoopingStateRow('walk_back'));
  for (const row of ['jump', 'crouch', 'block', 'base', 'grab']) {
    assert.ok(!isLoopingStateRow(row), `${row} must not loop`);
  }
});

console.log(`\nEngine row-playback smoke test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
