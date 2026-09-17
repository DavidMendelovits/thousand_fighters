import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GameLoop } from '../src/core/GameLoop';
import { InputReader } from '../src/core/InputReader';
import { InputBuffer } from '../src/core/InputBuffer';
import { TouchInput } from '../src/core/TouchInput';

test('60 Hz simulation is independent of 30/60/120/144 Hz display cadence', () => {
  for (const hz of [30, 60, 120, 144]) {
    for (const scale of [1, 1 / 6]) {
      const loop = new GameLoop();
      let ticks = 0;
      for (let frame = 0; frame <= hz * 4; frame++) {
        loop.update(frame * 1000 / hz, () => ticks++, scale);
      }
      assert.equal(ticks, 240 * scale, `${hz} Hz at ${scale} speed`);
    }
  }
});

test('stalls are bounded, reset discards debt, and backwards timestamps do not delay ticks', () => {
  const loop = new GameLoop();
  let ticks = 0;
  const step = () => ticks++;
  loop.update(0, step);
  loop.update(5000, step);
  assert.equal(ticks, 5);
  loop.reset();
  loop.update(10000, step);
  assert.equal(ticks, 5);
  loop.update(9990, step);
  loop.update(9990 + 1000 / 60, step);
  assert.equal(ticks, 6);
});

function keyboardFixture() {
  const keys = new Map<string, { isDown: boolean; timeDown: number; reset(): void }>();
  const keyboard = {
    addKey(name: string) {
      if (!keys.has(name)) keys.set(name, {
        isDown: false, timeDown: 0,
        reset() { this.isDown = false; this.timeDown = 0; },
      });
      return keys.get(name)!;
    },
  } as unknown as Phaser.Input.Keyboard.KeyboardPlugin;
  InputReader.reset(keyboard);
  let time = 1;
  return {
    keyboard,
    press(name: string) { const key = keys.get(name)!; key.isDown = true; key.timeDown = time++; },
    release(name: string) { keys.get(name)!.isDown = false; },
  };
}

test('released keyboard tap is retained once, including both logical aliases', () => {
  const f = keyboardFixture();
  f.press('F'); f.release('F');
  const raw = InputReader.read(1, f.keyboard);
  assert.equal(raw.lp, true);
  assert.equal(raw.mk, true);
  assert.equal(raw.lpPrev, false);
  const buffer = new InputBuffer();
  buffer.record(raw, 1);
  assert.equal(buffer.matchSequence(['lp']), true);
  const next = InputReader.read(1, f.keyboard);
  assert.equal(next.lp, false);
  assert.equal(next.mk, false);
});

test('short direction and jump taps survive until one simulation read', () => {
  const f = keyboardFixture();
  f.press('W'); f.release('W');
  f.press('D'); f.release('D');
  const raw = InputReader.read(1, f.keyboard);
  assert.equal(raw.up, true);
  assert.equal(raw.right, true);
  const next = InputReader.read(1, f.keyboard);
  assert.equal(next.up, false);
  assert.equal(next.right, false);
});

test('release/repress between reads is a new edge, but a hold never repeats', () => {
  const f = keyboardFixture();
  f.press('F');
  InputReader.read(1, f.keyboard);
  assert.equal(InputReader.read(1, f.keyboard).lpPrev, true);
  f.release('F'); f.press('F'); f.release('F');
  const raw = InputReader.read(1, f.keyboard);
  assert.equal(raw.lp, true);
  assert.equal(raw.lpPrev, false);
});

test('touch taps survive hitstop and release/repress without leaking to P2', () => {
  const f = keyboardFixture();
  TouchInput.setButton('lp', true);
  TouchInput.setButton('lp', false);
  assert.equal(InputReader.read(2, f.keyboard).lp, false);
  assert.equal(InputReader.read(1, f.keyboard).lp, true);
  TouchInput.setButton('lp', true);
  TouchInput.setButton('lp', false);
  const raw = InputReader.read(1, f.keyboard);
  assert.equal(raw.lp, true);
  assert.equal(raw.lpPrev, false);
  assert.equal(InputReader.read(1, f.keyboard).lp, false);
});

test('pause/restart reset discards queued and held input from keyboard and touch', () => {
  const f = keyboardFixture();
  f.press('F');
  TouchInput.setButton('hp', true);
  InputReader.reset(f.keyboard);
  const raw = InputReader.read(1, f.keyboard);
  assert.equal(raw.lp, false);
  assert.equal(raw.hp, false);
  f.press('F');
  assert.equal(InputReader.read(1, f.keyboard).lpPrev, false);
});

test('keyboard focus reset does not fabricate an attack when timestamp returns to zero', () => {
  const f = keyboardFixture();
  f.press('F');
  InputReader.read(1, f.keyboard);
  f.keyboard.addKey('F').reset();
  assert.equal(InputReader.read(1, f.keyboard).lp, false);
});

test('attack buffer allows six-tick recovery links but expires stale attacks', () => {
  const f = keyboardFixture();
  const buffer = new InputBuffer();
  f.press('F'); f.release('F');
  buffer.record(InputReader.read(1, f.keyboard), 1);
  for (let tick = 0; tick < 5; tick++) buffer.record(InputReader.read(1, f.keyboard), 1);
  assert.equal(buffer.matchSequence(['lp']), true);
  buffer.record(InputReader.read(1, f.keyboard), 1);
  assert.equal(buffer.matchSequence(['lp']), false);
  f.press('F'); f.release('F');
  buffer.record(InputReader.read(1, f.keyboard), 1);
  assert.equal(buffer.matchSequence(['lp']), true);
  buffer.consumeButtons();
  assert.equal(buffer.matchSequence(['lp']), false);
});

test('motion window stays generous while the final attack must be fresh', () => {
  const f = keyboardFixture();
  const buffer = new InputBuffer();
  f.press('S');
  buffer.record(InputReader.read(1, f.keyboard), 1);
  f.release('S');
  for (let tick = 0; tick < 8; tick++) buffer.record(InputReader.read(1, f.keyboard), 1);
  f.press('H'); f.release('H');
  buffer.record(InputReader.read(1, f.keyboard), 1);
  assert.equal(buffer.matchSequence(['down', 'hp'], 15), true);
  for (let tick = 0; tick < 6; tick++) buffer.record(InputReader.read(1, f.keyboard), 1);
  assert.equal(buffer.matchSequence(['hp'], 15), false);
});
