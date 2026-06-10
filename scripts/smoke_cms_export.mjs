/**
 * smoke_cms_export.mjs
 *
 * Smoke test for the CMS draft-to-runtime CharacterConfig converter.
 *
 * Tests:
 * 1. Full conversion of a draft with all field types
 * 2. knockbackX/Y -> knockback:{x,y} conversion
 * 3. projectile speedX/speedY -> velocity:{x,y} conversion
 * 4. Input token normalization
 * 5. Default hurtbox generation (with and without frame data)
 * 6. hitbox_end synthesis in recovery phases
 * 7. Required CharacterConfig fields all present
 * 8. Export to runtime via repository (file-based)
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CharacterContentRepository } from '../cms/repositories/CharacterContentRepository.js';
import { FileCmsStorage } from '../cms/storage/FileCmsStorage.js';
import { convertDraftToCharacterConfig, generateDefaultHurtboxes, normalizeInputToken } from '../cms/export/convertDraftToCharacterConfig.js';
import { exportCharacterToRuntime } from '../cms/export/exportCharacterToRuntime.js';

// ---------------------------------------------------------------------------
// Fixture: hand-authored draft that exercises all conversion branches
// ---------------------------------------------------------------------------
const FIXTURE_DRAFT = {
  id: 'smoke_fighter',
  displayName: 'Smoke Fighter',
  lifecycle: 'draft',
  stats: {
    walkForwardSpeed: 3.2,
    walkBackSpeed: 2.1,
    jumpVelocity: 10.5,
    jumpForwardVelocity: 3.8,
    jumpBackVelocity: 3.0,
    gravity: 0.55,
    maxFallSpeed: 12,
    maxHealth: 950,
  },
  sprite: {
    basePath: '/fighters/smoke_fighter',
    scale: 0.55,
    frameCounts: {
      base: 6,
      punch: 6,
      kick: 6,
      special_1: 6,
      special_2: 6,
    },
  },
  moves: [
    {
      id: 'light_punch',
      displayName: 'Quick Jab',
      animation: 'punch',
      trigger: {
        sequence: ['lp'],           // already normalized
      },
      phases: [
        { name: 'startup', frames: 3, events: [] },
        {
          name: 'active',
          frames: 3,
          events: [
            {
              frame: 0,
              event: {
                type: 'hitbox_active',
                hitbox: {
                  x: 28,
                  y: -90,
                  width: 46,
                  height: 28,
                  damage: 44,
                  knockbackX: 4,   // flat fields from draft schema
                  knockbackY: 0,
                  hitstun: 14,
                },
              },
            },
          ],
        },
        // Recovery phase has no explicit hitbox_end — should be synthesized
        { name: 'recovery', frames: 8, events: [] },
      ],
    },
    {
      id: 'fireball',
      displayName: 'Energy Burst',
      animation: 'special_1',
      trigger: {
        sequence: ['down', 'down-forward', 'forward', 'heavy_punch'],  // heavy_punch needs normalization
      },
      phases: [
        { name: 'startup', frames: 12, events: [] },
        {
          name: 'release',
          frames: 4,
          events: [
            {
              frame: 0,
              event: {
                type: 'hitbox_active',  // projectile event with projectile key
                hitbox: null,
                projectile: {
                  id: 'smoke_ball',
                  assetPath: 'special_2',
                  speedX: 6,             // speedX -> velocity.x
                  speedY: -0.5,          // speedY -> velocity.y
                  damage: 65,
                },
              },
            },
          ],
        },
        { name: 'recovery', frames: 22, events: [] },
      ],
    },
    {
      id: 'heavy_kick',
      displayName: 'Roundhouse',
      animation: 'kick',
      trigger: {
        sequence: ['medium_kick'],  // needs normalization to 'mk'
        allowedStates: ['idle', 'walk_forward', 'walk_back', 'crouch'],
      },
      phases: [
        { name: 'startup', frames: 8, events: [] },
        {
          name: 'active',
          frames: 5,
          events: [
            {
              frame: 0,
              event: {
                type: 'hitbox_active',
                hitbox: {
                  x: 30,
                  y: -80,
                  width: 70,
                  height: 30,
                  damage: 75,
                  knockbackX: 5,
                  knockbackY: -2,
                  hitstun: 20,
                },
              },
            },
          ],
        },
        {
          name: 'recovery',
          frames: 18,
          events: [
            // Explicit hitbox_end — synthesizer should not add a duplicate
            {
              frame: 0,
              event: { type: 'hitbox_end' },
            },
          ],
        },
      ],
    },
  ],
};

const FIXTURE_FRAME_DATA = {
  frames: {
    base: [
      { file: 'sprites/base/base_001.png', width: 226, height: 295, anchor: { x: 113, y: 257 } },
      { file: 'sprites/base/base_002.png', width: 266, height: 286, anchor: { x: 133, y: 248 } },
    ],
  },
};

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
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
// Section 1: normalizeInputToken
// ---------------------------------------------------------------------------
console.log('\n[1] normalizeInputToken');

test('lp stays lp', () => assert.equal(normalizeInputToken('lp'), 'lp'));
test('heavy_punch -> hp', () => assert.equal(normalizeInputToken('heavy_punch'), 'hp'));
test('light_kick -> lk', () => assert.equal(normalizeInputToken('light_kick'), 'lk'));
test('medium_kick -> mk', () => assert.equal(normalizeInputToken('medium_kick'), 'mk'));
test('forward stays forward', () => assert.equal(normalizeInputToken('forward'), 'forward'));
test('down-forward stays down-forward', () => assert.equal(normalizeInputToken('down-forward'), 'down-forward'));
test('unknown passthrough', () => assert.equal(normalizeInputToken('UNKNOWN_TOKEN'), 'UNKNOWN_TOKEN'));

// ---------------------------------------------------------------------------
// Section 2: generateDefaultHurtboxes
// ---------------------------------------------------------------------------
console.log('\n[2] generateDefaultHurtboxes');

test('fallback without frame data', () => {
  const hurtboxes = generateDefaultHurtboxes(null);
  assert.ok(hurtboxes.idle, 'idle hurtbox should exist');
  assert.ok(hurtboxes.crouch, 'crouch hurtbox should exist');
  assert.equal(typeof hurtboxes.idle.x, 'number');
  assert.equal(typeof hurtboxes.idle.y, 'number');
  assert.equal(typeof hurtboxes.idle.width, 'number');
  assert.equal(typeof hurtboxes.idle.height, 'number');
});

test('fallback without base frames', () => {
  const hurtboxes = generateDefaultHurtboxes({ frames: {} });
  assert.ok(hurtboxes.idle);
});

test('generated from frame data', () => {
  const hurtboxes = generateDefaultHurtboxes(FIXTURE_FRAME_DATA);
  // First frame: width=226, anchor.y=257. bodyWidth = round(226*0.2)=45, bodyHeight=round(257*0.85)=218
  const expectedBodyWidth = Math.round(226 * 0.2);
  const expectedBodyHeight = Math.round(257 * 0.85);
  assert.equal(hurtboxes.idle.x, -expectedBodyWidth);
  assert.equal(hurtboxes.idle.y, -expectedBodyHeight);
  assert.equal(hurtboxes.idle.width, expectedBodyWidth * 2);
  assert.equal(hurtboxes.idle.height, expectedBodyHeight);
});

test('all states present', () => {
  const hurtboxes = generateDefaultHurtboxes(FIXTURE_FRAME_DATA);
  for (const state of ['idle', 'walk_forward', 'walk_back', 'crouch', 'attack', 'airborne', 'hitstun', 'blockstun', 'juggle']) {
    assert.ok(hurtboxes[state], `missing hurtbox for state: ${state}`);
  }
});

// ---------------------------------------------------------------------------
// Section 3: convertDraftToCharacterConfig
// ---------------------------------------------------------------------------
console.log('\n[3] convertDraftToCharacterConfig');

const config = convertDraftToCharacterConfig({ draft: FIXTURE_DRAFT, frameData: FIXTURE_FRAME_DATA, manifest: null });

test('required top-level fields', () => {
  assert.equal(config.id, 'smoke_fighter');
  assert.equal(config.displayName, 'Smoke Fighter');
  assert.equal(typeof config.walkForwardSpeed, 'number');
  assert.equal(typeof config.walkBackSpeed, 'number');
  assert.equal(typeof config.jumpVelocity, 'number');
  assert.equal(typeof config.jumpForwardVelocity, 'number');
  assert.equal(typeof config.jumpBackVelocity, 'number');
  assert.equal(typeof config.gravity, 'number');
  assert.equal(typeof config.maxFallSpeed, 'number');
  assert.equal(typeof config.maxHealth, 'number');
  assert.equal(config.pivotOffsetY, 0);
});

test('stats are mapped correctly', () => {
  assert.equal(config.walkForwardSpeed, 3.2);
  assert.equal(config.maxHealth, 950);
});

test('sprite config generated', () => {
  assert.ok(config.sprite, 'sprite should be present');
  assert.equal(config.sprite.basePath, '/fighters/smoke_fighter');
  assert.equal(config.sprite.scale, 0.55);
  assert.ok(config.sprite.frameCounts);
  assert.ok(config.sprite.sheets);
  assert.ok(config.sprite.stateFrames);
});

test('animations map generated', () => {
  assert.ok(config.animations, 'animations should be present');
  assert.equal(config.animations.idle, 'idle');
  assert.equal(config.animations.attack, 'attack');
  assert.equal(config.animations.hitstun, 'hitstun');
});

test('hurtboxes generated', () => {
  assert.ok(config.hurtboxes, 'hurtboxes should be present');
  assert.ok(config.hurtboxes.idle, 'idle hurtbox should exist');
});

test('moves array present', () => {
  assert.equal(config.moves.length, 3);
});

// ---------------------------------------------------------------------------
// Section 4: Move conversion - light_punch
// ---------------------------------------------------------------------------
console.log('\n[4] Move conversion');

const lightPunch = config.moves.find((m) => m.id === 'light_punch');

test('light_punch move exists', () => {
  assert.ok(lightPunch, 'light_punch should be found');
});

test('trigger fields added', () => {
  assert.deepEqual(lightPunch.trigger.allowedStates, ['idle', 'walk_forward', 'walk_back']);
  assert.deepEqual(lightPunch.trigger.sequence, ['lp']);
  assert.equal(lightPunch.trigger.window, 6);
});

test('hitbox knockbackX/Y converted to knockback:{x,y}', () => {
  const activePhase = lightPunch.phases.find((p) => p.name === 'active');
  assert.ok(activePhase, 'active phase should exist');
  const hitboxEvent = activePhase.events.find((e) => e.event.type === 'hitbox_active');
  assert.ok(hitboxEvent, 'hitbox_active event should exist');
  assert.deepEqual(hitboxEvent.event.hitbox.knockback, { x: 4, y: 0 });
  assert.equal(hitboxEvent.event.hitbox.knockbackX, undefined, 'knockbackX should not be on converted hitbox');
});

test('hitbox blockstun derived from hitstun (60%)', () => {
  const activePhase = lightPunch.phases.find((p) => p.name === 'active');
  const hitboxEvent = activePhase.events.find((e) => e.event.type === 'hitbox_active');
  assert.equal(hitboxEvent.event.hitbox.blockstun, Math.round(14 * 0.6));
});

test('hitbox_end synthesized in recovery phase', () => {
  const recoveryPhase = lightPunch.phases.find((p) => p.name === 'recovery');
  assert.ok(recoveryPhase, 'recovery phase should exist');
  const endEvent = recoveryPhase.events.find((e) => e.event.type === 'hitbox_end' && e.onFrame === 0);
  assert.ok(endEvent, 'hitbox_end should be synthesized in recovery phase');
});

test('cancelInto defaults to empty array', () => {
  assert.deepEqual(lightPunch.cancelInto, []);
});

// ---------------------------------------------------------------------------
// Section 5: Projectile conversion - fireball
// ---------------------------------------------------------------------------
console.log('\n[5] Projectile conversion');

const fireball = config.moves.find((m) => m.id === 'fireball');

test('fireball move exists', () => {
  assert.ok(fireball, 'fireball should be found');
});

test('trigger sequence normalizes heavy_punch -> hp', () => {
  assert.deepEqual(fireball.trigger.sequence, ['down', 'down-forward', 'forward', 'hp']);
});

test('projectile event has spawn_projectile type', () => {
  const releasePhase = fireball.phases.find((p) => p.name === 'release');
  assert.ok(releasePhase);
  const projEvent = releasePhase.events.find((e) => e.event.type === 'spawn_projectile');
  assert.ok(projEvent, 'spawn_projectile event should exist');
  assert.equal(projEvent.event.projectile.id, 'smoke_ball');
});

test('projectile speedX/Y converted to velocity:{x,y}', () => {
  const releasePhase = fireball.phases.find((p) => p.name === 'release');
  const projEvent = releasePhase.events.find((e) => e.event.type === 'spawn_projectile');
  assert.deepEqual(projEvent.event.projectile.velocity, { x: 6, y: -0.5, relativeToFacing: true });
  assert.equal(projEvent.event.projectile.speed, 6);
});

test('projectile hitbox generated', () => {
  const releasePhase = fireball.phases.find((p) => p.name === 'release');
  const projEvent = releasePhase.events.find((e) => e.event.type === 'spawn_projectile');
  assert.ok(projEvent.event.projectile.hitbox, 'projectile hitbox should exist');
  assert.equal(projEvent.event.projectile.hitbox.damage, 65);
});

// ---------------------------------------------------------------------------
// Section 6: Heavy kick - explicit hitbox_end not duplicated
// ---------------------------------------------------------------------------
console.log('\n[6] Explicit hitbox_end dedup');

const heavyKick = config.moves.find((m) => m.id === 'heavy_kick');

test('trigger sequence normalizes medium_kick -> mk', () => {
  assert.deepEqual(heavyKick.trigger.sequence, ['mk']);
});

test('explicit hitbox_end not duplicated in recovery', () => {
  const recoveryPhase = heavyKick.phases.find((p) => p.name === 'recovery');
  const endEvents = recoveryPhase.events.filter((e) => e.event.type === 'hitbox_end' && e.onFrame === 0);
  assert.equal(endEvents.length, 1, 'should have exactly one hitbox_end at frame 0 in recovery');
});

test('trigger allowedStates from draft override', () => {
  assert.deepEqual(heavyKick.trigger.allowedStates, ['idle', 'walk_forward', 'walk_back', 'crouch']);
});

// ---------------------------------------------------------------------------
// Section 7: Error cases
// ---------------------------------------------------------------------------
console.log('\n[7] Error cases');

test('throws on missing draft', () => {
  assert.throws(
    () => convertDraftToCharacterConfig({ draft: null, frameData: null, manifest: null }),
    { message: /draft is required/ }
  );
});

test('throws on missing draft id', () => {
  assert.throws(
    () => convertDraftToCharacterConfig({ draft: {}, frameData: null, manifest: null }),
    { message: /draft.id is required/ }
  );
});

// ---------------------------------------------------------------------------
// Section 8: Full export to disk via repository
// ---------------------------------------------------------------------------
console.log('\n[8] Full export to disk');

let rootDir;
try {
  rootDir = await mkdtemp(path.join(os.tmpdir(), 'smoke-cms-export-'));

  const outputDir = path.join(rootDir, 'public', 'fighters');
  const storage = new FileCmsStorage({ rootDir: path.join(rootDir, 'cms-data') });
  const repository = new CharacterContentRepository(storage, {
    clock: () => new Date('2026-05-19T12:00:00.000Z'),
  });

  // Seed the draft directly (no AI needed)
  await repository.saveDraft('smoke_fighter', FIXTURE_DRAFT);

  const result = await exportCharacterToRuntime({
    runtime: { repository, storage },
    characterId: 'smoke_fighter',
    outputDir,
    copyAssets: false,
  });

  test('export returns characterId', () => {
    assert.equal(result.characterId, 'smoke_fighter');
  });

  test('export configPath is set', () => {
    assert.ok(result.configPath.endsWith('smoke_fighter/config.json'));
  });

  test('config.json written to disk', async () => {
    const raw = await readFile(result.configPath, 'utf8');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.id, 'smoke_fighter');
    assert.equal(parsed.displayName, 'Smoke Fighter');
    assert.ok(Array.isArray(parsed.moves));
    assert.equal(parsed.moves.length, 3);
  });

  test('written config has required CharacterConfig fields', async () => {
    const raw = await readFile(result.configPath, 'utf8');
    const parsed = JSON.parse(raw);
    const required = [
      'id', 'displayName', 'walkForwardSpeed', 'walkBackSpeed',
      'jumpVelocity', 'jumpForwardVelocity', 'jumpBackVelocity',
      'gravity', 'maxFallSpeed', 'maxHealth', 'hurtboxes',
      'pivotOffsetY', 'sprite', 'animations', 'moves',
    ];
    for (const field of required) {
      assert.ok(parsed[field] !== undefined, `missing required field: ${field}`);
    }
  });

  // Export again with copyAssets: true, after seeding pack assets and a
  // generated SFX (sounds live outside the fighter pack).
  await storage.putBytes(
    'characters/smoke_fighter/assets/fighter-pack/sprites/base/base_001.png',
    Buffer.from('fake png'),
    { contentType: 'image/png' },
  );
  await storage.putBytes(
    'characters/smoke_fighter/assets/sounds/hit.wav',
    Buffer.from('fake wav'),
    { contentType: 'audio/wav' },
  );

  const resultWithAssets = await exportCharacterToRuntime({
    runtime: { repository, storage },
    characterId: 'smoke_fighter',
    outputDir,
    copyAssets: true,
  });

  test('export copies fighter pack sprites', () => {
    assert.ok(
      resultWithAssets.filesCopied.some((f) => f.endsWith(path.join('sprites', 'base', 'base_001.png'))),
      'sprites/base/base_001.png should be copied',
    );
  });

  test('export copies generated sounds', async () => {
    const soundPath = path.join(outputDir, 'smoke_fighter', 'sounds', 'hit.wav');
    assert.ok(
      resultWithAssets.filesCopied.includes(soundPath),
      'sounds/hit.wav should be in filesCopied',
    );
    assert.equal(await readFile(soundPath, 'utf8'), 'fake wav');
  });
} finally {
  if (rootDir) await rm(rootDir, { force: true, recursive: true });
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('');
console.log(`CMS export smoke test: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
