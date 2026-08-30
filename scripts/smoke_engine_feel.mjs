/**
 * smoke_engine_feel.mjs
 *
 * Engine tests for the game-feel pass (feat/engine-feel). Runs via `tsx` so it
 * imports the REAL implementations from the TypeScript sources:
 *   - `isThreatened` from src/core/threat.ts (proximity guard)
 *   - `hitstopForDamage` from src/util/hitpause.ts (damage-scaled hitstop)
 *   - `InputBuffer` consumption from src/core/InputBuffer.ts (no free cancels)
 *
 * Coverage:
 *   A. isThreatened — attack range, projectile approach/receding, idle opponent.
 *   B. hitstopForDamage — floor, scaling, cap.
 *   C. InputBuffer.consumeAll — a consumed press no longer matches; a fresh
 *      press after consumption matches; held directions keep matching because
 *      they re-emit every frame.
 */

import assert from 'node:assert/strict';
import { isThreatened } from '../src/core/threat.ts';
import { hitstopForDamage, BLOCK_HITSTOP_FRAMES } from '../src/util/hitpause.ts';
import { InputBuffer } from '../src/core/InputBuffer.ts';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}\n        ${err.message}`);
    failed++;
  }
}

const rawInput = (overrides = {}) => ({
  left: false, right: false, up: false, down: false,
  lp: false, mp: false, hp: false, lk: false, mk: false, hk: false,
  lpPrev: false, mpPrev: false, hpPrev: false, lkPrev: false, mkPrev: false, hkPrev: false,
  ...overrides,
});

console.log('A. isThreatened');

test('opponent attacking in range threatens', () => {
  assert.equal(isThreatened(400, 500, 'attack', []), true);
});

test('opponent attacking out of range does not threaten', () => {
  assert.equal(isThreatened(100, 700, 'attack', []), false);
});

test('idle opponent close by does not threaten (walk-back allowed)', () => {
  assert.equal(isThreatened(400, 460, 'idle', []), false);
});

test('approaching projectile in range threatens', () => {
  assert.equal(isThreatened(400, 700, 'idle', [{ x: 550, vx: -6 }]), true);
});

test('receding projectile does not threaten', () => {
  assert.equal(isThreatened(400, 700, 'idle', [{ x: 550, vx: 6 }]), false);
});

test('approaching projectile out of range does not threaten', () => {
  assert.equal(isThreatened(100, 700, 'idle', [{ x: 690, vx: -6 }]), false);
});

console.log('B. hitstopForDamage');

test('light damage floors at 4 frames', () => {
  assert.equal(hitstopForDamage(0), 4);
  assert.equal(hitstopForDamage(4), 4);
});

test('medium damage scales up', () => {
  assert.ok(hitstopForDamage(12) > hitstopForDamage(4));
});

test('huge damage caps at 9 frames', () => {
  assert.equal(hitstopForDamage(100), 9);
});

test('block hitstop is smaller than any clean-hit hitstop', () => {
  assert.ok(BLOCK_HITSTOP_FRAMES < hitstopForDamage(0));
});

console.log('C. InputBuffer consumption');

test('a press matches before consumption and not after', () => {
  const buffer = new InputBuffer();
  buffer.record(rawInput({ lp: true }), 1);
  assert.equal(buffer.matchSequence(['lp']), true, 'press should match pre-consumption');
  buffer.consumeAll();
  assert.equal(buffer.matchSequence(['lp']), false, 'consumed press must not match');
});

test('a fresh press after consumption matches again', () => {
  const buffer = new InputBuffer();
  buffer.record(rawInput({ lp: true }), 1);
  buffer.consumeAll();
  buffer.record(rawInput({ lp: false, lpPrev: true }), 1); // release
  buffer.record(rawInput({ lp: true }), 1); // new press
  assert.equal(buffer.matchSequence(['lp']), true);
});

test('held directions survive consumption (re-emitted every frame)', () => {
  const buffer = new InputBuffer();
  buffer.record(rawInput({ right: true }), 1);
  buffer.consumeAll();
  buffer.record(rawInput({ right: true }), 1);
  assert.equal(buffer.matchSequence(['forward']), true);
});

test('one press cannot fire a move and then also its follow-up', () => {
  const buffer = new InputBuffer();
  buffer.record(rawInput({ lp: true }), 1);
  // Move selection fires and consumes (as MoveExecutor.start does).
  assert.equal(buffer.matchSequence(['lp']), true);
  buffer.consumeAll();
  // 8 frames later, at a cancellable phase, the stale press is inside the
  // 15-frame window but must NOT trigger the cancel-only follow-up.
  for (let i = 0; i < 8; i++) buffer.record(rawInput(), 1);
  assert.equal(buffer.matchSequence(['lp']), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
