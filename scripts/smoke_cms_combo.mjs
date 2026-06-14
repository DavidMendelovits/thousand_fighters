/**
 * smoke_cms_combo.mjs — Phase 4 T22 unit 1 (descriptor + persistence + convert
 * chaining). The decisive correctness lives here: cancelInto is a MERGE, not a
 * replace.
 *
 *   - applyComboChaining wires adjacent segments (a→b→c) into cancelInto,
 *     union+deduped, terminal segment untouched, never emitting a dangling link.
 *   - validateCombos rejects unknown segments / too-short / duplicate ids at
 *     definition time.
 *   - convertDraftToCharacterConfig threads combos end-to-end.
 *   - draft.combos round-trips through saveDraft/getDraft.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CharacterContentRepository } from '../cms/repositories/CharacterContentRepository.js';
import { FileCmsStorage } from '../cms/storage/FileCmsStorage.js';
import {
  applyComboChaining,
  validateCombos,
  convertDraftToCharacterConfig,
} from '../cms/export/convertDraftToCharacterConfig.js';

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

const movesFixture = () => [
  { id: 'a', cancelInto: [] },
  { id: 'b', cancelInto: [] },
  { id: 'c', cancelInto: [] },
];

// ---------------------------------------------------------------------------
console.log('\n[A] applyComboChaining — adjacent chaining, merge semantics');

test('combo [a,b,c] wires a→b, b→c; terminal c untouched', () => {
  const moves = movesFixture();
  applyComboChaining(moves, [{ id: 'combo1', segments: ['a', 'b', 'c'] }]);
  const byId = Object.fromEntries(moves.map((m) => [m.id, m]));
  assert.deepEqual(byId.a.cancelInto, ['b']);
  assert.deepEqual(byId.b.cancelInto, ['c']);
  assert.deepEqual(byId.c.cancelInto, [], 'terminal segment must not gain a cancelInto');
});

test('chaining is adjacent-only, never transitive (a does NOT cancel into c)', () => {
  const moves = movesFixture();
  applyComboChaining(moves, [{ id: 'combo1', segments: ['a', 'b', 'c'] }]);
  const a = moves.find((m) => m.id === 'a');
  assert.ok(!a.cancelInto.includes('c'), 'a→c would be transitive');
});

test('pre-authored cancelInto is preserved (union, not replace)', () => {
  const moves = [{ id: 'a', cancelInto: ['x'] }, { id: 'b', cancelInto: [] }];
  applyComboChaining(moves, [{ id: 'c1', segments: ['a', 'b'] }]);
  assert.deepEqual(moves[0].cancelInto, ['x', 'b']);
});

test('a move in two combos accumulates both targets, no duplicates', () => {
  const moves = movesFixture();
  applyComboChaining(moves, [
    { id: 'c1', segments: ['a', 'b'] },
    { id: 'c2', segments: ['a', 'c'] },
  ]);
  assert.deepEqual(moves.find((m) => m.id === 'a').cancelInto, ['b', 'c']);
});

test('running chaining twice is idempotent (no duplicate ids)', () => {
  const moves = movesFixture();
  const combos = [{ id: 'c1', segments: ['a', 'b', 'c'] }];
  applyComboChaining(moves, combos);
  applyComboChaining(moves, combos);
  assert.deepEqual(moves.find((m) => m.id === 'a').cancelInto, ['b']);
  assert.deepEqual(moves.find((m) => m.id === 'b').cancelInto, ['c']);
});

test('lenient: a segment for a nonexistent move emits NO dangling cancelInto', () => {
  const moves = [{ id: 'a', cancelInto: [] }];
  applyComboChaining(moves, [{ id: 'c1', segments: ['a', 'ghost'] }]);
  assert.deepEqual(moves[0].cancelInto, [], 'must not wire a→ghost');
});

test('no combos / empty combos is a no-op', () => {
  const m1 = movesFixture();
  applyComboChaining(m1, undefined);
  applyComboChaining(m1, []);
  assert.ok(m1.every((m) => m.cancelInto.length === 0));
});

test('does NOT touch phase cancellable (combo links, window stays authoring data)', () => {
  const moves = [
    { id: 'a', cancelInto: [], phases: [{ cancellable: false }] },
    { id: 'b', cancelInto: [] },
  ];
  applyComboChaining(moves, [{ id: 'c1', segments: ['a', 'b'] }]);
  assert.equal(moves[0].phases[0].cancellable, false, 'cancellable must be untouched');
});

// ---------------------------------------------------------------------------
console.log('\n[B] validateCombos — strict, definition-time');

test('valid combo over existing moves → no errors', () => {
  assert.deepEqual(validateCombos([{ id: 'c1', segments: ['a', 'b'] }], ['a', 'b', 'c']), []);
});
test('unknown segment → error', () => {
  const errs = validateCombos([{ id: 'c1', segments: ['a', 'ghost'] }], ['a', 'b']);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /unknown move "ghost"/);
});
test('fewer than 2 segments → error', () => {
  const errs = validateCombos([{ id: 'c1', segments: ['a'] }], ['a']);
  assert.match(errs[0], /at least 2 segments/);
});
test('duplicate combo id → error', () => {
  const errs = validateCombos([
    { id: 'dup', segments: ['a', 'b'] },
    { id: 'dup', segments: ['b', 'a'] },
  ], ['a', 'b']);
  assert.ok(errs.some((e) => /duplicate combo id "dup"/.test(e)));
});
test('undefined/null combos → no errors (combos are optional)', () => {
  assert.deepEqual(validateCombos(undefined, ['a']), []);
  assert.deepEqual(validateCombos(null, ['a']), []);
});

// ---------------------------------------------------------------------------
console.log('\n[C] convertDraftToCharacterConfig — combos threaded end-to-end');

test('converted moves carry the chained cancelInto', () => {
  const draft = {
    id: 'combo_fighter',
    moves: [
      { id: 'jab', animation: 'punch', trigger: { sequence: ['lp'] }, phases: [] },
      { id: 'cross', animation: 'punch', trigger: { sequence: ['hp'] }, phases: [] },
      { id: 'uppercut', animation: 'special_1', trigger: { sequence: ['hp'] }, phases: [] },
    ],
    combos: [{ id: 'bnb', segments: ['jab', 'cross', 'uppercut'] }],
  };
  const config = convertDraftToCharacterConfig({ draft, frameData: null, manifest: null });
  const byId = Object.fromEntries(config.moves.map((m) => [m.id, m]));
  assert.deepEqual(byId.jab.cancelInto, ['cross']);
  assert.deepEqual(byId.cross.cancelInto, ['uppercut']);
  assert.deepEqual(byId.uppercut.cancelInto, []);
});

// ---------------------------------------------------------------------------
console.log('\n[D] draft.combos persistence round-trip');

const rootDir = await mkdtemp(path.join(os.tmpdir(), 'thousand-fighters-combo-'));
try {
  const storage = new FileCmsStorage({ rootDir });
  const repository = new CharacterContentRepository(storage, {
    clock: () => new Date('2026-06-14T12:00:00.000Z'),
  });
  const combos = [{ id: 'bnb', displayName: 'Bread & Butter', segments: ['jab', 'cross'] }];
  await repository.saveDraft('combo_fighter', {
    displayName: 'Combo Fighter',
    moves: [{ id: 'jab' }, { id: 'cross' }],
    combos,
  });
  const loaded = await repository.getDraft('combo_fighter');
  test('saveDraft/getDraft preserves draft.combos verbatim', () => {
    assert.deepEqual(loaded.combos, combos);
  });
} finally {
  await rm(rootDir, { force: true, recursive: true });
}

console.log(`\nCMS combo smoke test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
