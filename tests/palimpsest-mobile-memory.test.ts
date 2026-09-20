import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { CharacterConfig } from '../src/schema/types';
import { spritePreloadPlan } from '../src/core/spritePreloadPlan';

test('Palimpsest preloads each runtime frame once and does not queue its legacy sprite', () => {
  const config = JSON.parse(readFileSync('public/fighters/palimpsest/config.json', 'utf8')) as CharacterConfig;
  const plan = spritePreloadPlan(config);
  assert.deepEqual(plan.map(entry => entry.keyPrefix), ['palimpsest:lead', 'palimpsest:hands']);

  const files = plan.flatMap(entry => Object.values(entry.sprite.frames ?? {}).flat().map(frame => frame.file));
  assert.equal(files.length, 480);
  assert.equal(new Set(files).size, 480);
  assert.ok(!plan.some(entry => entry.keyPrefix === 'palimpsest'));
});
