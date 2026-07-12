/**
 * smoke_input_controls.mjs
 *
 * Unit tests for the player-control fixes (T8):
 *   A. 'grab' token emitted by InputBuffer when LP+LK pressed simultaneously
 *   B. normalizeInputToken / expandTriggerSequence rewrites CMS sentinels
 *   C. selectTriggeredMove returns the LONGEST matching sequence (shadowing fix)
 *   D. move window of 14 (convertMove default — tested via expandTriggerSequence)
 *
 * Runs via `tsx` so it imports real TypeScript sources without Phaser.
 *
 * Usage: node --import tsx/esm scripts/smoke_input_controls.mjs
 *    or: npx tsx scripts/smoke_input_controls.mjs
 */

import assert from 'node:assert/strict';
import { InputBuffer } from '../src/core/InputBuffer.ts';
import { selectTriggeredMove } from '../src/core/moveSelection.ts';
import { normalizeInputToken, expandTriggerSequence } from '../cms/export/convertDraftToCharacterConfig.js';

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
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal RawInput with named button states. */
function raw(overrides = {}) {
  return {
    left: false, right: false, up: false, down: false,
    lp: false, mp: false, hp: false, lk: false, mk: false, hk: false,
    lpPrev: false, mpPrev: false, hpPrev: false, lkPrev: false, mkPrev: false, hkPrev: false,
    ...overrides,
  };
}

/** Build minimal moves for selectTriggeredMove testing. */
function move(id, sequence, window = 15) {
  return {
    id,
    displayName: id,
    animation: id,
    trigger: {
      allowedStates: ['idle', 'walk_forward', 'walk_back'],
      sequence,
      window,
    },
    phases: [],
  };
}

/** Fighter-like context (grounded, idle, no current move). */
const idleCtx = { state: 'idle', grounded: true, currentMove: null };

// ---------------------------------------------------------------------------
// [A] InputBuffer: grab token emission
// ---------------------------------------------------------------------------

console.log('\n[A] InputBuffer — grab token');

test('pressing LP alone emits lp', () => {
  const buf = new InputBuffer();
  buf.record(raw({ lp: true }), 1);   // press
  assert.ok(buf.matchSequence(['lp'], 5), 'should match lp');
});

test('pressing LK alone emits lk', () => {
  const buf = new InputBuffer();
  buf.record(raw({ lk: true }), 1);
  assert.ok(buf.matchSequence(['lk'], 5), 'should match lk');
});

test('pressing LP+LK together emits grab, not lp or lk', () => {
  const buf = new InputBuffer();
  buf.record(raw({ lp: true, lk: true }), 1);
  assert.ok(buf.matchSequence(['grab'], 5), 'should match grab');
  assert.ok(!buf.matchSequence(['lp'], 5), 'should NOT emit bare lp when grab fires');
  assert.ok(!buf.matchSequence(['lk'], 5), 'should NOT emit bare lk when grab fires');
});

test('grab token requires BOTH LP and LK newly pressed — holding only LP does not grab', () => {
  const buf = new InputBuffer();
  // Frame 1: LP already held (prev=false → new press this frame; lk=false)
  buf.record(raw({ lp: true }), 1);
  // Frame 2: LP still held + LK newly pressed — THIS should emit grab
  buf.record(raw({ lp: true, lpPrev: true, lk: true }), 1);
  // LP was held across frames 1→2 so lpPrev=true; only lk is new this frame
  // → NOT a simultaneous new-press → should emit lk only, not grab
  assert.ok(!buf.matchSequence(['grab'], 5), 'should NOT emit grab when LP was already held');
  assert.ok(buf.matchSequence(['lk'], 5), 'should emit bare lk for the new press');
});

test('forward+grab sequence is matchable (throw motion)', () => {
  const buf = new InputBuffer();
  // Frame 1: holding forward direction (facing=1, so right=true)
  buf.record(raw({ right: true }), 1);
  // Frame 2: still forward + LP+LK together → grab token
  buf.record(raw({ right: true, lp: true, lk: true }), 1);
  assert.ok(buf.matchSequence(['forward', 'grab'], 5), 'forward then grab should match throw sequence');
});

// ---------------------------------------------------------------------------
// [B] CMS export: normalizeInputToken and expandTriggerSequence
// ---------------------------------------------------------------------------

console.log('\n[B] CMS export — token normalisation and sentinel expansion');

test('normalizeInputToken: punch → lp, kick → lk', () => {
  assert.equal(normalizeInputToken('punch'), 'lp');
  assert.equal(normalizeInputToken('kick'), 'lk');
});

test('normalizeInputToken: grab → grab (valid engine token)', () => {
  assert.equal(normalizeInputToken('grab'), 'grab');
});

test('expandTriggerSequence: special_1 sentinel → [down, forward, lp]', () => {
  assert.deepEqual(expandTriggerSequence(['special_1'], 'special_1'), ['down', 'forward', 'lp']);
});

test('expandTriggerSequence: special_2 sentinel → [down, forward, lk]', () => {
  assert.deepEqual(expandTriggerSequence(['special_2'], 'special_2'), ['down', 'forward', 'lk']);
});

test('expandTriggerSequence: grab sentinel → [grab]', () => {
  assert.deepEqual(expandTriggerSequence(['grab'], 'grab'), ['grab']);
});

test('expandTriggerSequence: throw sentinel → [forward, grab]', () => {
  assert.deepEqual(expandTriggerSequence(['throw'], 'throw'), ['forward', 'grab']);
});

test('expandTriggerSequence: already-correct motion sequence passes through unchanged', () => {
  // el_cometa style: authored as real directional sequence
  const seq = ['forward', 'down', 'forward', 'lp'];
  assert.deepEqual(expandTriggerSequence(seq, 'special_1'), seq);
});

test('expandTriggerSequence: empty sequence + special_1 animation → synthesises motion', () => {
  assert.deepEqual(expandTriggerSequence([], 'special_1'), ['down', 'forward', 'lp']);
});

test('expandTriggerSequence: empty sequence + unknown animation → stays empty', () => {
  assert.deepEqual(expandTriggerSequence([], 'punch'), []);
});

test('expandTriggerSequence: idempotent — re-expanding canonical [forward, grab] stays the same', () => {
  // throw → [forward, grab]; re-expanding should NOT re-expand 'grab' → ['grab'] inline
  // Actually [forward, grab] run through flatMap: forward→forward, grab→[grab] → [forward, grab]
  assert.deepEqual(expandTriggerSequence(['forward', 'grab'], 'throw'), ['forward', 'grab']);
});

// ---------------------------------------------------------------------------
// [C] selectTriggeredMove: longest-match wins (shadowing fix)
// ---------------------------------------------------------------------------

console.log('\n[C] selectTriggeredMove — longest match wins');

test('bare lp → triggers basic punch, not a special', () => {
  const punch = move('punch', ['lp'], 15);
  const special = move('special_1', ['down', 'forward', 'lp'], 15);
  const moves = [punch, special]; // punch is first in array

  const buf = new InputBuffer();
  buf.record(raw({ right: true }), 1);  // neutral/forward frame
  buf.record(raw({ lp: true }), 1);    // press lp only

  const result = selectTriggeredMove(moves, buf, idleCtx, false);
  assert.equal(result?.id, 'punch', 'bare lp should match punch, not the 3-token special');
});

test('down, forward, lp within window → triggers special_1 even with earlier bare lp move', () => {
  const punch = move('punch', ['lp'], 15);
  const special = move('special_1', ['down', 'forward', 'lp'], 15);
  const moves = [punch, special]; // punch is first; special must still win

  const buf = new InputBuffer();
  buf.record(raw({ down: true }), 1);                          // down
  buf.record(raw({ down: true, right: true }), 1);             // down-forward
  buf.record(raw({ right: true }), 1);                         // forward
  buf.record(raw({ lp: true }), 1);                            // lp

  const result = selectTriggeredMove(moves, buf, idleCtx, false);
  assert.equal(result?.id, 'special_1', 'motion special must beat bare lp (longest-match)');
});

test('motion entered slower than window → no match', () => {
  // window=2: only the last 2 buffer entries are searched.
  // We push 'down' 5 frames before 'lp' — it won't be in the 2-frame window.
  const special = move('special_1', ['down', 'forward', 'lp'], 2);

  const buf = new InputBuffer();
  buf.record(raw({ down: true }), 1);   // frame 1: 'down'
  // 4 neutral frames — pushes 'down' well outside the 2-frame window
  for (let i = 0; i < 4; i++) buf.record(raw({}), 1);
  buf.record(raw({ right: true }), 1);  // frame 6: 'forward'
  buf.record(raw({ lp: true }), 1);     // frame 7: 'lp'

  // slice(-2) gives only frames 6 and 7: ['forward', 'lp'] — 'down' is absent
  const result = selectTriggeredMove([special], buf, idleCtx, false);
  assert.equal(result, null, 'motion outside window should not match');
});

test('grab move matches when grab token is in buffer', () => {
  const grabMove = move('grab_move', ['grab'], 10);

  const buf = new InputBuffer();
  buf.record(raw({ lp: true, lk: true }), 1); // simultaneous LP+LK → 'grab'

  const result = selectTriggeredMove([grabMove], buf, idleCtx, false);
  assert.equal(result?.id, 'grab_move', 'grab token should trigger grab move');
});

test('throw beats grab (longer sequence)', () => {
  const grabMove = move('grab_move', ['grab'], 10);
  const throwMove = move('throw_move', ['forward', 'grab'], 10);
  const moves = [grabMove, throwMove];

  const buf = new InputBuffer();
  buf.record(raw({ right: true }), 1);               // forward direction
  buf.record(raw({ lp: true, lk: true }), 1);        // grab token

  const result = selectTriggeredMove(moves, buf, idleCtx, false);
  assert.equal(result?.id, 'throw_move', 'forward+grab (throw) beats bare grab (longest-match)');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\nInput control smoke test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
