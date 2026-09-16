import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { evaluateAnimationClip, parseAnimationClip } from '../shared/animationClip';

const fixture = (id = 'acrobatics') => JSON.parse(readFileSync(new URL(`../public/animation-lab/${id}/clip.json`, import.meta.url), 'utf8'));

test('compiled demos validate and authored holds advance exactly at their boundary', () => {
  for (const id of ['acrobatics', 'morph', 'energy_cast', 'janitor_vault', 'janitor_morph']) {
    const clip = parseAnimationClip(fixture(id));
    let tick = 0;
    clip.layers[0].frames.forEach((frame, index) => {
      assert.equal(evaluateAnimationClip(clip, tick).frameIndex, index);
      assert.equal(evaluateAnimationClip(clip, tick + frame.durationTicks - 1).frameIndex, index);
      tick += frame.durationTicks;
    });
    assert.equal(tick, clip.totalTicks);
  }
});

test('loop wraps, once/hold retain their last pose, and invalid time starts at zero', () => {
  const clip = parseAnimationClip(fixture());
  assert.equal(evaluateAnimationClip(clip, clip.totalTicks).frameIndex, 0);
  assert.equal(evaluateAnimationClip(clip, -5).tick, 0);
  assert.equal(evaluateAnimationClip(clip, NaN).tick, 0);
  for (const playback of ['once', 'hold'] as const) {
    const result = evaluateAnimationClip({ ...clip, playback }, clip.totalTicks + 100);
    assert.equal(result.frameIndex, clip.layers[0].frames.length - 1);
    assert.equal(result.finished, true);
  }
});

test('layer composition preserves authored z-order, additive blend and marker ticks', () => {
  const data = fixture('energy_cast');
  data.layers[1].blend = 'add';
  const clip = parseAnimationClip(data);
  const result = evaluateAnimationClip(clip, clip.events[0].tick);
  assert.equal(result.layers.length, 3);
  assert.deepEqual(result.layers.map(item => item.layer.z), [...clip.layers.map(layer => layer.z)].sort((a, b) => a - b));
  assert.ok(result.layers.some(item => item.layer.blend === 'add'));
  assert.deepEqual(result.events[0], clip.events[0]);
});

test('rejects broken timing, duplicate layer identities and out-of-range events', () => {
  const timing = fixture(); timing.layers[0].frames[0].durationTicks = 0;
  assert.throws(() => parseAnimationClip(timing), /durationTicks/);
  const sum = fixture(); sum.totalTicks++;
  assert.throws(() => parseAnimationClip(sum), /sum to totalTicks/);
  const duplicate = fixture('energy_cast'); duplicate.layers[1].id = duplicate.layers[0].id;
  assert.throws(() => parseAnimationClip(duplicate), /duplicate layer/);
  const event = fixture(); event.events[0].tick = event.totalTicks;
  assert.throws(() => parseAnimationClip(event), /event.tick/);
  const mismatched = fixture('energy_cast');
  mismatched.layers[1].frames[0].durationTicks++;
  mismatched.layers[1].frames[1].durationTicks--;
  assert.throws(() => parseAnimationClip(mismatched), /layer timings/);
});
