import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('fight preload never downloads the authoring assets index', async () => {
  const source = await readFile(new URL('../src/scenes/FightScene.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /load\.json\([^\n]*assets-index/);
});
