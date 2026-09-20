import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TouchInput } from '../src/core/TouchInput';
import { InputReader } from '../src/core/InputReader';
import { InputBuffer } from '../src/core/InputBuffer';
import { gameOrigin, fightUrl, allowGameNavigation } from '../mobile/gameUrl';

function keyboard() {
  const plugin = { addKey: () => ({ isDown: false, timeDown: 0, reset() {} }) } as unknown as Phaser.Input.Keyboard.KeyboardPlugin;
  InputReader.reset(plugin);
  return plugin;
}

test('one-touch grab works while punch is held and never leaks to player two', () => {
  const keys = keyboard();
  TouchInput.setButton('lp', true);
  InputReader.read(1, keys);
  TouchInput.setButton('grab', true); TouchInput.setButton('grab', false);
  assert.equal(InputReader.read(2, keys).lk, false);
  const input = InputReader.read(1, keys);
  const buffer = new InputBuffer(); buffer.record(input, 1);
  assert.equal(buffer.matchSequence(['grab']), true);
  assert.equal(buffer.matchSequence(['lp']), false);
  assert.equal(InputReader.read(1, keys).lk, false);
});
test('short jump tap survives a read delay and preserves the movement pad', () => {
  const keys = keyboard();
  TouchInput.setDirection(0);
  TouchInput.setButton('jump', true); TouchInput.setButton('jump', false);
  const input = InputReader.read(1, keys);
  assert.equal(input.up, true); assert.equal(input.right, true);
  assert.equal(InputReader.read(1, keys).up, false);
  TouchInput.clearAll();
  assert.equal(InputReader.read(1, keys).right, false);
});
test('mobile production requires HTTPS and limits navigation to the fight client', () => {
  assert.equal(gameOrigin(undefined, false), null);
  assert.equal(gameOrigin('http://example.com', false), null);
  assert.equal(gameOrigin('https://localhost', false), null);
  assert.equal(gameOrigin('https://user:password@example.com', false), null);
  assert.equal(gameOrigin('https://example.com/cms-admin', false), null);
  assert.equal(gameOrigin(undefined, true, '192.168.1.2:8088'), 'http://192.168.1.2:5174');
  const url = fightUrl('https://example.com', 'brine', 'meridian');
  assert.equal(allowGameNavigation(url, 'https://example.com'), true);
  assert.equal(allowGameNavigation('https://example.com/cms-admin', 'https://example.com'), false);
  assert.equal(fightUrl('https://example.com', 'brine', 'meridian').startsWith('https://example.com/fight?'), true);
  assert.equal(allowGameNavigation('https://example.com/fight', 'https://example.com'), true);
  assert.equal(allowGameNavigation('https://example.com/fight.html', 'https://example.com'), true);
  assert.equal(allowGameNavigation('https://evil.example/fight.html', 'https://example.com'), false);
});
