/**
 * smoke_cms_author_combo.mjs — author a combo from intent (create + stitch).
 *
 * author_combo lets a segment be an EXISTING move id OR a NEW move described in
 * words. This pins the contract:
 *   [A] new segments become real moves with server-assigned rows + inputs, the
 *       combo descriptor stitches everything, and convert wires the cancel graph
 *       so the chain fires. Sprites generate in-flow (mock image gen).
 *   [B] the 6-row ceiling is respected: when no rows are free, created moves
 *       reuse an owned row WITHOUT regenerating it (no clobber) and warn.
 *
 * Run: node scripts/smoke_cms_author_combo.mjs
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CharacterContentRepository } from '../cms/repositories/CharacterContentRepository.js';
import { createMockTextModel, createMockImageGenerator } from '../cms/pipeline/adapters/mockAdapters.js';
import { CharacterCreationPipeline } from '../cms/pipeline/CharacterCreationPipeline.js';
import { PipelineRegistry } from '../cms/pipeline/PipelineRegistry.js';
import { PipelinePort } from '../cms/pipeline/ports.js';
import { FileCmsStorage } from '../cms/storage/FileCmsStorage.js';
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

function makeMove(id, animation, sequence) {
  return {
    id,
    animation,
    trigger: { sequence },
    phases: [
      { name: 'startup', frames: 4, events: [] },
      { name: 'active', frames: 3, events: [{ frame: 0, event: { type: 'hitbox_active', hitbox: { x: 30, y: -100, width: 60, height: 36, damage: 50 } } }, { frame: 2, event: { type: 'hitbox_end' } }] },
      { name: 'recovery', frames: 8, events: [] },
    ],
  };
}

async function build(rootDir, draft) {
  const storage = new FileCmsStorage({ rootDir });
  const repository = new CharacterContentRepository(storage, { clock: () => new Date('2026-06-14T00:00:00.000Z') });
  const registry = new PipelineRegistry({
    [PipelinePort.ASSET_STORAGE]: storage,
    [PipelinePort.CHARACTER_REPOSITORY]: repository,
    [PipelinePort.TEXT_MODEL]: createMockTextModel(),
    [PipelinePort.IMAGE_GENERATOR]: createMockImageGenerator(),
  });
  const pipeline = new CharacterCreationPipeline(registry, { clock: () => new Date('2026-06-14T00:00:00.000Z') });
  await repository.saveDraft(draft.id, draft, { provider: 'test', adapterId: 'seed' });
  return { pipeline, repository };
}

const rootDir = await mkdtemp(path.join(os.tmpdir(), 'tf-author-combo-'));
try {
  // ---------------------------------------------------------------------------
  console.log('\n[A] author a combo mixing an existing move + two new ones');
  {
    const draft = { id: 'cbf', displayName: 'Combo Fighter', description: 'a test fighter', sprite: { frameCounts: { base: 6, punch: 6 } }, moves: [makeMove('jab', 'punch', ['lp'])], combos: [], projectiles: [] };
    const { pipeline, repository } = await build(path.join(rootDir, 'a'), draft);
    const result = await pipeline.authorCombo({
      characterId: 'cbf',
      comboId: 'kick_string',
      comboDisplayName: 'Kick String',
      segments: [{ moveId: 'jab' }, { description: 'roundhouse kick' }, { description: 'headbutt finisher' }],
      generateSprites: true,
    });
    const saved = await repository.getDraft('cbf');

    test('two new moves were created', () => {
      assert.equal(result.createdMoves.length, 2);
    });
    test('created moves got DISTINCT free rows (not the taken "punch")', () => {
      const rows = result.createdMoves.map((m) => m.animation);
      assert.ok(!rows.includes('punch'), 'must not reuse the taken punch row');
      assert.equal(new Set(rows).size, 2, 'each new move gets its own row when rows are free');
    });
    test('created moves have non-empty inputs', () => {
      for (const m of result.createdMoves) assert.ok((m.trigger?.sequence ?? []).length > 0, `${m.id} needs an input`);
    });
    test('draft has the merged moves + the combo descriptor', () => {
      assert.equal(saved.moves.length, 3, 'jab + 2 created');
      const combo = (saved.combos ?? []).find((c) => c.id === 'kick_string');
      assert.ok(combo, 'combo persisted');
      assert.equal(combo.segments[0], 'jab');
      assert.equal(combo.segments.length, 3);
    });
    test('convert wires the cancel graph across the whole chain', () => {
      const config = convertDraftToCharacterConfig({ draft: saved, frameData: null, manifest: null });
      const byId = new Map(config.moves.map((m) => [m.id, m]));
      const [a, b, c] = (saved.combos.find((x) => x.id === 'kick_string')).segments;
      assert.ok(byId.get(a).cancelInto.includes(b), 'a → b');
      assert.ok(byId.get(b).cancelInto.includes(c), 'b → c');
      assert.ok(byId.get(b).trigger.cancelFrom.includes(a), 'b cancelFrom a');
      assert.ok(byId.get(b).trigger.allowedStates.includes('attack'), 'b reachable mid-attack');
    });
    test('follow-ups are CANCEL-ONLY; the existing starter stays neutral-accessible', () => {
      const config = convertDraftToCharacterConfig({ draft: saved, frameData: null, manifest: null });
      const byId = new Map(config.moves.map((m) => [m.id, m]));
      const [a, b, c] = (saved.combos.find((x) => x.id === 'kick_string')).segments;
      // starter (existing jab) remains doable from neutral
      assert.ok(byId.get(a).trigger.allowedStates.includes('idle'), 'starter accessible from neutral');
      // created follow-ups are NOT accessible from neutral — only via the combo
      for (const id of [b, c]) {
        assert.ok(!byId.get(id).trigger.allowedStates.includes('idle'), `${id} must not be doable from neutral`);
        assert.deepEqual(byId.get(id).trigger.allowedStates, ['attack'], `${id} is cancel-only`);
      }
    });
    test('sprites generated in-flow for the new rows (mock image gen)', () => {
      assert.ok(result.spriteResults.length >= 1, 'at least one row sprite generated');
    });
    test('no row-scarcity warnings when rows are free', () => {
      assert.ok(!result.warnings.some((w) => /shares row|reuses/.test(w)), `unexpected scarcity warning: ${JSON.stringify(result.warnings)}`);
    });
  }

  // ---------------------------------------------------------------------------
  console.log('\n[B] row ceiling: no free rows → reuse owned row WITHOUT regenerating');
  {
    const moves = ['punch', 'kick', 'special_1', 'special_2', 'grab', 'throw'].map((row, i) => makeMove(`m_${row}`, row, [['lp'], ['mp'], ['hp'], ['lk'], ['mk'], ['hk']][i]));
    const draft = { id: 'full', displayName: 'Full', description: 'all rows used', sprite: { frameCounts: { base: 6 } }, moves, combos: [], projectiles: [] };
    const { pipeline, repository } = await build(path.join(rootDir, 'b'), draft);
    const result = await pipeline.authorCombo({
      characterId: 'full',
      comboId: 'overflow',
      segments: [{ moveId: 'm_punch' }, { description: 'spinning elbow' }],
      generateSprites: true,
    });
    const saved = await repository.getDraft('full');

    test('new move reuses an owned row and warns (no distinct sprite)', () => {
      assert.equal(result.createdMoves.length, 1);
      assert.ok(['punch', 'kick', 'special_1', 'special_2', 'grab', 'throw'].includes(result.createdMoves[0].animation));
      assert.ok(result.warnings.some((w) => /no free animation rows|reuses/.test(w)), `expected a ceiling warning, got ${JSON.stringify(result.warnings)}`);
    });
    test('did NOT regenerate any owned row (no clobber)', () => {
      assert.equal(result.spriteResults.length, 0, 'owned rows are never regenerated by a combo');
    });
    test('combo still wired end-to-end', () => {
      const combo = saved.combos.find((c) => c.id === 'overflow');
      assert.equal(combo.segments.length, 2);
      assert.equal(combo.segments[0], 'm_punch');
    });
  }
} finally {
  await rm(rootDir, { recursive: true, force: true });
}

console.log(`\nCMS author-combo smoke test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
