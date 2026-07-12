/**
 * smoke_cms_projectile.mjs — Phase 4 T23 unit 1 (projectile entity schema +
 * convert resolution).
 *
 * The keystone: projectiles are first-class ENTITIES on the draft
 * (draft.projectiles), and a spawn_projectile event references one by id.
 * Convert resolves the reference into a full runtime ProjectileConfig.
 *
 *   - resolveProjectileEntities fills `projectile` from the entity, strips the
 *     id, drops a dangling reference (lenient), and leaves inline/legacy
 *     projectiles untouched.
 *   - validateProjectiles rejects missing/duplicate ids and bad numerics.
 *   - convertDraftToCharacterConfig threads it end-to-end.
 *   - draft.projectiles round-trips through saveDraft/getDraft.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CharacterContentRepository } from '../cms/repositories/CharacterContentRepository.js';
import { FileCmsStorage } from '../cms/storage/FileCmsStorage.js';
import {
  resolveProjectileEntities,
  validateProjectiles,
  validateProjectileReferences,
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

const FIREBALL = {
  id: 'fireball',
  animation: 'fireball_sprite',
  width: 48,
  height: 24,
  speed: 8,
  velocity: { x: 8, y: 0, relativeToFacing: true },
  lifetime: 90,
  gravity: 0,
  pierces: 1,
  clashesWithProjectiles: true,
  hitbox: { x: -24, y: -12, width: 48, height: 24, damage: 70, hitstun: 20, blockstun: 14, knockback: { x: 5, y: -2 }, level: 'mid' },
};

// A converted move carrying an unresolved projectileId reference.
const movesWithRef = (projectileId = 'fireball', extra = {}) => [
  {
    id: 'fireball_special',
    phases: [
      { name: 'active', events: [{ onFrame: 2, event: { type: 'spawn_projectile', projectileId, offsetX: 50, offsetY: -40, ...extra } }] },
    ],
  },
];

// ---------------------------------------------------------------------------
console.log('\n[A] resolveProjectileEntities — entity reference resolution');

test('a projectileId reference resolves to the entity config and strips the id', () => {
  const moves = movesWithRef();
  resolveProjectileEntities(moves, [FIREBALL]);
  const event = moves[0].phases[0].events[0].event;
  assert.equal(event.type, 'spawn_projectile');
  assert.ok(!('projectileId' in event), 'projectileId must be stripped after resolution');
  assert.equal(event.offsetX, 50, 'spawn offset preserved');
  assert.equal(event.projectile.id, 'fireball');
  assert.equal(event.projectile.animation, 'fireball_sprite', 'entity animation flows (not hardcoded special_2)');
  assert.equal(event.projectile.width, 48);
  assert.equal(event.projectile.hitbox.damage, 70);
  assert.equal(event.projectile.hitbox.knockback.x, 5);
  assert.equal(event.projectile.pierces, 1);
  assert.equal(event.projectile.gravity, 0);
  assert.equal(event.projectile.clashesWithProjectiles, true);
});

test('a dangling projectileId (no matching entity) is DROPPED, not emitted broken', () => {
  const moves = movesWithRef('ghost');
  resolveProjectileEntities(moves, [FIREBALL]);
  assert.equal(moves[0].phases[0].events.length, 0, 'the broken spawn event must be removed');
});

test('an inline/legacy projectile event is left untouched', () => {
  const moves = [
    { id: 'm', phases: [{ events: [{ onFrame: 0, event: { type: 'spawn_projectile', projectile: { id: 'inline', animation: 'special_2' } } }] }] },
  ];
  resolveProjectileEntities(moves, [FIREBALL]);
  assert.equal(moves[0].phases[0].events[0].event.projectile.id, 'inline');
});

test('non-projectile events pass through unchanged', () => {
  const moves = [{ id: 'm', phases: [{ events: [{ onFrame: 0, event: { type: 'hitbox_active', id: 'default' } }] }] }];
  resolveProjectileEntities(moves, [FIREBALL]);
  assert.equal(moves[0].phases[0].events[0].event.type, 'hitbox_active');
});

test('no projectiles array is a no-op (drops references leniently)', () => {
  const moves = movesWithRef();
  resolveProjectileEntities(moves, undefined);
  assert.equal(moves[0].phases[0].events.length, 0);
});

// ---------------------------------------------------------------------------
console.log('\n[B] validateProjectiles — strict, definition-time');

test('a valid entity → no errors', () => {
  assert.deepEqual(validateProjectiles([FIREBALL]), []);
});
test('missing id → error', () => {
  const errs = validateProjectiles([{ animation: 'x', width: 10, height: 10, lifetime: 60 }]);
  assert.ok(errs.some((e) => /needs a string id/.test(e)));
});
test('duplicate id → error', () => {
  const errs = validateProjectiles([{ id: 'a' }, { id: 'a' }]);
  assert.ok(errs.some((e) => /duplicate projectile id "a"/.test(e)));
});
test('non-positive width/height/lifetime → error', () => {
  const errs = validateProjectiles([{ id: 'a', width: 0, height: -3, lifetime: 0 }]);
  assert.equal(errs.filter((e) => /must be a positive number/.test(e)).length, 3);
});
test('non-object hitbox → error', () => {
  const errs = validateProjectiles([{ id: 'a', hitbox: 5 }]);
  assert.ok(errs.some((e) => /hitbox must be an object/.test(e)));
});
test('undefined/null projectiles → no errors (optional)', () => {
  assert.deepEqual(validateProjectiles(undefined), []);
  assert.deepEqual(validateProjectiles(null), []);
});

// ---------------------------------------------------------------------------
console.log('\n[B2] validateProjectileReferences — surface dangling spawn refs (codex P1)');

test('a spawn event referencing a missing projectile is reported, not silent', () => {
  const draft = {
    projectiles: [{ id: 'fireball' }],
    moves: [{ id: 'm', phases: [{ events: [{ onFrame: 0, event: { type: 'spawn_projectile', projectileId: 'ghost' } }] }] }],
  };
  const warnings = validateProjectileReferences(draft);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /spawns projectile "ghost"/);
});
test('resolvable references produce no warnings', () => {
  const draft = {
    projectiles: [{ id: 'fireball' }],
    moves: [{ id: 'm', phases: [{ events: [{ onFrame: 0, event: { type: 'spawn_projectile', projectileId: 'fireball' } }] }] }],
  };
  assert.deepEqual(validateProjectileReferences(draft), []);
});
test('inline-projectile events are not flagged (only projectileId refs)', () => {
  const draft = {
    projectiles: [],
    moves: [{ id: 'm', phases: [{ events: [{ onFrame: 0, event: { type: 'spawn_projectile', projectile: { id: 'inline' } } }] }] }],
  };
  assert.deepEqual(validateProjectileReferences(draft), []);
});

// ---------------------------------------------------------------------------
console.log('\n[C] convertDraftToCharacterConfig — entity resolved end-to-end');

test('a draft spawn_projectile referencing an entity converts to a full config', () => {
  const draft = {
    id: 'proj_fighter',
    moves: [
      {
        id: 'fireball_special',
        animation: 'special_1',
        trigger: { sequence: ['qcf', 'lp'] },
        phases: [{ frames: 4, events: [{ onFrame: 2, event: { type: 'spawn_projectile', projectileId: 'fireball', offsetX: 50, offsetY: -40 } }] }],
      },
    ],
    projectiles: [FIREBALL],
  };
  const config = convertDraftToCharacterConfig({ draft, frameData: null, manifest: null });
  const events = config.moves[0].phases[0].events;
  const spawn = events.find((e) => e.event.type === 'spawn_projectile');
  assert.ok(spawn, 'spawn_projectile survived conversion');
  assert.equal(spawn.event.projectile.animation, 'fireball_sprite');
  assert.equal(spawn.event.projectile.hitbox.damage, 70);
  assert.ok(!('projectileId' in spawn.event));
});

test('a spawn event with neither projectile nor projectileId is neutralized, not crash-prone (codex P1)', () => {
  // The strict schema makes projectileId required-but-nullable, so a model can
  // emit a payload-less spawn. convert must NOT pass it through as a bare
  // spawn_projectile (MoveExecutor would hand undefined to ProjectilePool and
  // crash on config.spawnPolicy). It becomes a no-op hitbox_end instead.
  const draft = {
    id: 'p',
    moves: [{ id: 'm', animation: 'special_1', trigger: { sequence: ['lp'] },
      phases: [{ frames: 4, events: [{ onFrame: 0, event: { type: 'spawn_projectile', projectileId: null, projectile: null, offsetX: 10, offsetY: -10 } }] }] }],
    projectiles: [],
  };
  const config = convertDraftToCharacterConfig({ draft, frameData: null, manifest: null });
  const types = config.moves[0].phases.flatMap((p) => p.events).map((e) => e.event.type);
  assert.ok(!types.includes('spawn_projectile'), 'no bare spawn_projectile reaches the runtime');
});

// ---------------------------------------------------------------------------
console.log('\n[D] draft.projectiles persistence round-trip');

const rootDir = await mkdtemp(path.join(os.tmpdir(), 'thousand-fighters-projectile-'));
try {
  const storage = new FileCmsStorage({ rootDir });
  const repository = new CharacterContentRepository(storage, {
    clock: () => new Date('2026-06-14T12:00:00.000Z'),
  });
  await repository.saveDraft('proj_fighter', { moves: [], projectiles: [FIREBALL] });
  const loaded = await repository.getDraft('proj_fighter');
  test('saveDraft/getDraft preserves draft.projectiles verbatim', () => {
    assert.deepEqual(loaded.projectiles, [FIREBALL]);
  });
} finally {
  await rm(rootDir, { force: true, recursive: true });
}

console.log(`\nCMS projectile smoke test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
