/**
 * smoke_engine_guard.mjs
 *
 * Engine tests for the guard-box system (T17). Runs via `tsx` so it imports the
 * REAL implementation from the TypeScript sources — not a re-implementation:
 *   - `guardCovers` + `HitResolver.isBlocking` from src/core/HitResolver.ts
 *   - `boxToWorld` from src/util/aabb.ts
 * HitResolver only `import type`s Fighter, and aabb/hitpause are Phaser-free, so
 * these load in plain Node (under tsx) with no game runtime.
 *
 * Coverage:
 *   A. guardCovers AABB geometry (overlap / miss / edge-touch / containment).
 *   B. isBlocking BACKWARD-COMPAT — with NO guardbox, the legacy holding-back +
 *      high/low/crouch rules are byte-for-byte preserved (the critical invariant).
 *   C. isBlocking GUARD path — with a guardbox, geometry decides and overrides the
 *      level enum (the intended T17 behavior).
 */

import assert from 'node:assert/strict';
import { guardCovers, HitResolver } from '../src/core/HitResolver.ts';
import { boxToWorld } from '../src/util/aabb.ts';

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

// ---------------------------------------------------------------------------
// A. guardCovers — pure AABB geometry (the REAL exported helper)
// ---------------------------------------------------------------------------
const GUARD = { x: -20, y: -160, width: 40, height: 160 };

console.log('\n[A] guardCovers geometry (real HitResolver export)');
test('mid hit overlapping the guard body covers', () => {
  assert.equal(guardCovers({ x: 10, y: -100, width: 40, height: 30 }, GUARD), true);
});
test('hit entirely right of guard does not cover', () => {
  assert.equal(guardCovers({ x: 50, y: -100, width: 30, height: 20 }, GUARD), false);
});
test('edge-touch (right edge == guard left) does not cover (exclusive)', () => {
  assert.equal(guardCovers({ x: -50, y: -100, width: 30, height: 20 }, GUARD), false);
});
test('hit fully inside guard covers', () => {
  assert.equal(guardCovers({ x: -10, y: -120, width: 5, height: 5 }, GUARD), true);
});
test('guard fully inside a giant hit still covers', () => {
  assert.equal(guardCovers({ x: -100, y: -200, width: 200, height: 200 }, GUARD), true);
});
test('overhead hit above guard top does not cover', () => {
  assert.equal(guardCovers({ x: -10, y: -200, width: 20, height: 40 }, GUARD), false);
});
test('low sweep below guard bottom does not cover', () => {
  assert.equal(guardCovers({ x: -10, y: 5, width: 20, height: 20 }, GUARD), false);
});

// ---------------------------------------------------------------------------
// Duck-typed Fighter stand-ins for isBlocking (a static method that only reads
// state / x / y / facing / inputBuffer.current() / getGuardboxWorld()).
// ---------------------------------------------------------------------------
function makeDefender({ state = 'idle', x = 100, y = 0, holding = 'right', guardWorld = null } = {}) {
  return {
    state,
    x,
    y,
    facing: -1,
    inputBuffer: { current: () => ({ left: holding === 'left', right: holding === 'right' }) },
    getGuardboxWorld: () => guardWorld,
  };
}
const ATTACKER = { x: 0, y: 0, facing: 1 };
const block = (defender, hitbox) => HitResolver.isBlocking(defender, ATTACKER, hitbox);

// ---------------------------------------------------------------------------
// B. BACKWARD-COMPAT — no guardbox → legacy behavior must be identical
// ---------------------------------------------------------------------------
console.log('\n[B] isBlocking backward-compat (no guardbox → legacy level/crouch)');
test('holding back blocks a mid hit', () => {
  assert.equal(block(makeDefender(), { x: 60, y: -100, width: 40, height: 30, level: 'mid' }), true);
});
test('not holding back never blocks', () => {
  assert.equal(block(makeDefender({ holding: 'left' }), { x: 60, y: -100, width: 40, height: 30, level: 'mid' }), false);
});
test('low hit is NOT blocked standing', () => {
  assert.equal(block(makeDefender({ state: 'idle' }), { x: 60, y: -40, width: 40, height: 30, level: 'low' }), false);
});
test('low hit IS blocked crouching', () => {
  assert.equal(block(makeDefender({ state: 'crouch' }), { x: 60, y: -40, width: 40, height: 30, level: 'low' }), true);
});
test('high hit is NOT blocked crouching', () => {
  assert.equal(block(makeDefender({ state: 'crouch' }), { x: 60, y: -150, width: 40, height: 30, level: 'high' }), false);
});
test('high hit IS blocked standing', () => {
  assert.equal(block(makeDefender({ state: 'idle' }), { x: 60, y: -150, width: 40, height: 30, level: 'high' }), true);
});
test('attack/hitstun/juggle states never block', () => {
  for (const state of ['attack', 'hitstun', 'juggle']) {
    assert.equal(block(makeDefender({ state }), { x: 60, y: -100, width: 40, height: 30, level: 'mid' }), false);
  }
});

// ---------------------------------------------------------------------------
// C. GUARD path — with a guardbox, geometry decides (and overrides the level enum)
// ---------------------------------------------------------------------------
console.log('\n[C] isBlocking guard-box path (geometry decides)');
// Defender at x=100; a guard world AABB covering its standing body.
const GUARD_WORLD = { x: 80, y: -160, width: 40, height: 160 };
// Attacker at x=0 facing +1: hitbox.x maps to world x = 0 + hitbox.x.
test('hit overlapping the guard box is blocked', () => {
  const hb = { x: 60, y: -100, width: 40, height: 30, level: 'mid' }; // world [60,100]
  assert.equal(boxToWorld(hb, ATTACKER.x, ATTACKER.y, ATTACKER.facing).x, 60);
  assert.equal(block(makeDefender({ guardWorld: GUARD_WORLD }), hb), true);
});
test('hit missing the guard box is NOT blocked (even while holding back)', () => {
  const hb = { x: 200, y: -100, width: 40, height: 30, level: 'mid' }; // world [200,240], misses guard
  assert.equal(block(makeDefender({ guardWorld: GUARD_WORLD }), hb), false);
});
test('guard geometry OVERRIDES the level enum: high hit blocked while crouching if it overlaps', () => {
  // Legacy logic would refuse (high vs crouch). With a guardbox that overlaps, it blocks.
  const hb = { x: 60, y: -150, width: 40, height: 30, level: 'high' };
  assert.equal(block(makeDefender({ state: 'crouch', guardWorld: GUARD_WORLD }), hb), true);
});
test('guard path still requires holding back', () => {
  const hb = { x: 60, y: -100, width: 40, height: 30, level: 'mid' };
  assert.equal(block(makeDefender({ holding: 'left', guardWorld: GUARD_WORLD }), hb), false);
});

console.log('');
console.log(`Engine guard smoke test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
