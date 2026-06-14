// Contract smoke for the data-driven animation-row registry (T20).
//
// Two jobs:
//   1. Assert the registry's canonical-row invariants hold (ids, order, the
//      MOVE_SHEETS subset, derived groups/labels) so a careless edit to
//      shared/animationRows.js can't silently change the engine contract.
//   2. Guard admin/app.js — the one consumer that can't import the registry
//      (browser file behind a static server) and keeps its own literal
//      ordering — by parsing its arrays and asserting they match the registry.
//
// Run: npm run rows:smoke

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANIMATION_ROWS,
  SHEET_IDS,
  MOVE_SHEET_IDS,
  SHEET_LABELS,
  getRow,
  sheetGroups,
} from '../shared/animationRows.js';
import { rowsMissingProfiles } from '../cms/pipeline/rowPromptProfiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const CANONICAL_IDS = ['base', 'punch', 'kick', 'special_1', 'special_2'];
const CANONICAL_MOVE_IDS = ['punch', 'kick', 'special_1', 'special_2'];

// 1. Registry invariants — the canonical 5 rows are the default registry, so
//    existing fighters stay byte-for-byte unchanged. (New rows append in T21;
//    this asserts the canonical prefix, not an exact length, so T21 doesn't
//    have to touch this file just to add a row.)
assert.deepEqual(
  SHEET_IDS.slice(0, CANONICAL_IDS.length),
  CANONICAL_IDS,
  'SHEET_IDS must start with the 5 canonical rows in order',
);
for (const id of CANONICAL_IDS) {
  assert.ok(getRow(id), `registry is missing canonical row "${id}"`);
}
for (const id of CANONICAL_MOVE_IDS) {
  assert.ok(MOVE_SHEET_IDS.includes(id), `MOVE_SHEET_IDS must include "${id}"`);
}
assert.ok(!MOVE_SHEET_IDS.includes('base'), 'base must not be a move-animation row');
assert.equal(getRow('base').role, 'base', 'base row role must be "base"');

// T21 rows. grab/throw are move-triggered (enter MOVE_SHEETS — latent until a
// move references them). jump/crouch/dash/block are state-driven or
// authoring-only and must NOT be move-animation rows, or they would change the
// engine's MOVE_SHEETS playback set for existing fighters.
const T21_ROWS = ['jump', 'crouch', 'dash_forward', 'dash_back', 'block', 'grab', 'throw'];
for (const id of T21_ROWS) {
  assert.ok(getRow(id), `registry is missing T21 row "${id}"`);
}
for (const id of ['grab', 'throw']) {
  assert.ok(MOVE_SHEET_IDS.includes(id), `T21: "${id}" must be a move-animation row`);
}
for (const id of ['jump', 'crouch', 'dash_forward', 'dash_back', 'block']) {
  assert.ok(!MOVE_SHEET_IDS.includes(id), `T21: "${id}" must NOT be a move-animation row`);
}
// The full move set after T21 is the canonical 4 normals/specials + grab + throw.
assert.deepEqual(
  MOVE_SHEET_IDS,
  [...CANONICAL_MOVE_IDS, 'grab', 'throw'],
  'MOVE_SHEET_IDS must be the canonical normals/specials followed by grab, throw',
);

// SHEET_IDS / MOVE_SHEET_IDS / SHEET_LABELS / sheetGroups all derive from the
// same source — assert they stay mutually consistent.
assert.deepEqual(Object.keys(SHEET_LABELS), SHEET_IDS, 'SHEET_LABELS keys must equal SHEET_IDS');
const groupedIds = sheetGroups().flatMap((group) => group.sheets);
assert.deepEqual([...groupedIds].sort(), [...SHEET_IDS].sort(), 'sheetGroups must cover every row exactly once');
assert.equal(groupedIds.length, SHEET_IDS.length, 'sheetGroups must not duplicate a row');
assert.deepEqual(
  ANIMATION_ROWS.filter((row) => row.moveAnimation).map((row) => row.id),
  MOVE_SHEET_IDS,
  'MOVE_SHEET_IDS must equal the moveAnimation rows in order',
);

// 1b. Every registry row must have an image-generation prompt profile, or it
//     generates with only the generic fallback arc (drift guard, T21).
assert.deepEqual(
  rowsMissingProfiles(),
  [],
  'every registry row needs a prompt profile in cms/pipeline/rowPromptProfiles.js',
);

// 2. admin/app.js literal guard. Parse the two ordering arrays and assert they
//    track the registry. admin gets a registry endpoint in T21; until then this
//    is the contract that keeps it from drifting.
const adminSource = await readFile(path.join(REPO_ROOT, 'admin', 'app.js'), 'utf8');

function parseArrayLiteral(source, name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([^\\]]*)\\]`));
  assert.ok(match, `admin/app.js: could not find "const ${name} = [...]"`);
  return match[1]
    .split(',')
    .map((token) => token.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

const adminMoveIds = parseArrayLiteral(adminSource, 'MOVE_IDS');
const adminMoveOrder = parseArrayLiteral(adminSource, 'MOVE_ORDER');

assert.deepEqual(
  adminMoveIds,
  SHEET_IDS,
  'admin/app.js MOVE_IDS drifted from the registry — update it or wire it to the registry endpoint',
);
assert.deepEqual(
  adminMoveOrder,
  [...SHEET_IDS, 'projectiles'],
  'admin/app.js MOVE_ORDER must be the registry rows followed by "projectiles"',
);

console.log(`✓ animation-row registry contract OK (${SHEET_IDS.length} rows: ${SHEET_IDS.join(', ')})`);
console.log(`✓ admin/app.js MOVE_IDS / MOVE_ORDER match the registry`);
