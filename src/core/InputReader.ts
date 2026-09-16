import type { RawInput } from '../schema/types';
import { TouchInput } from './TouchInput';

type KeyMap = Record<keyof Omit<RawInput, 'lpPrev' | 'mpPrev' | 'hpPrev' | 'lkPrev' | 'mkPrev' | 'hkPrev'>, string>;

const keyMaps: Record<1 | 2, KeyMap> = {
  1: {
    dash: 'SHIFT', power: 'E', transform: 'Q',
    left: 'A',
    right: 'D',
    up: 'W',
    down: 'S',
    lp: 'F',
    mp: 'G',
    hp: 'H',
    lk: 'G',
    mk: 'F',
    hk: 'H',
  },
  2: {
    dash: 'N', power: 'O', transform: 'U',
    left: 'LEFT',
    right: 'RIGHT',
    up: 'UP',
    down: 'DOWN',
    lp: 'J',
    mp: 'K',
    hp: 'L',
    lk: 'K',
    mk: 'J',
    hk: 'L',
  },
};

export class InputReader {
  private static sessions = new WeakMap<Phaser.Input.Keyboard.KeyboardPlugin, {
    previous: Record<1 | 2, RawInput | null>;
    keys: Map<string, { key: Phaser.Input.Keyboard.Key; timeDown: number }>;
  }>();

  static reset(keyboard: Phaser.Input.Keyboard.KeyboardPlugin): void {
    const keys = new Map<string, { key: Phaser.Input.Keyboard.Key; timeDown: number }>();
    for (const name of new Set(Object.values(keyMaps).flatMap(Object.values))) {
      const key = keyboard.addKey(name);
      key.reset();
      keys.set(name, { key, timeDown: key.timeDown });
    }
    this.sessions.set(keyboard, { previous: { 1: null, 2: null }, keys });
    TouchInput.clearAll();
  }

  static read(player: 1 | 2, keyboard: Phaser.Input.Keyboard.KeyboardPlugin): RawInput {
    const map = keyMaps[player];
    if (!this.sessions.has(keyboard)) this.reset(keyboard);
    const session = this.sessions.get(keyboard)!;
    const prev = session.previous[player];
    // timeDown survives keyup (unlike Phaser's JustDown flag), retaining a
    // tap until the next simulation tick, including ticks delayed by hitstop.
    // Read each physical key once: F/G/H intentionally have logical aliases.
    const pressed = new Set<string>();
    for (const name of new Set(Object.values(map))) {
      const tracked = session.keys.get(name)!;
      if (tracked.key.timeDown > 0 && tracked.key.timeDown !== tracked.timeDown) pressed.add(name);
      tracked.timeDown = tracked.key.timeDown;
    }
    const held = (name: string): boolean => session.keys.get(name)!.key.isDown;
    const state = {
      dash: pressed.has(map.dash), power: pressed.has(map.power), transform: pressed.has(map.transform),
      left: held(map.left),
      right: held(map.right),
      up: held(map.up),
      down: held(map.down),
      lp: held(map.lp) || pressed.has(map.lp),
      mp: held(map.mp) || pressed.has(map.mp),
      hp: held(map.hp) || pressed.has(map.hp),
      lk: held(map.lk) || pressed.has(map.lk),
      mk: held(map.mk) || pressed.has(map.mk),
      hk: held(map.hk) || pressed.has(map.hk),
    };

    const touchPressed = player === 1 ? TouchInput.consumePresses() : new Set<string>();
    if (player === 1) {
      const touch = TouchInput.snapshot();
      state.dash=state.dash||touchPressed.has('dash');state.power=state.power||touchPressed.has('power');state.transform=state.transform||touchPressed.has('transform');
      state.left = state.left || touch.left;
      state.right = state.right || touch.right;
      state.up = state.up || touch.up;
      state.down = state.down || touch.down;
      state.lp = state.lp || touch.lp || touchPressed.has('lp');
      state.mp = state.mp || touch.mp || touchPressed.has('mp');
      state.hp = state.hp || touch.hp || touchPressed.has('hp');
      state.lk = state.lk || touch.lk || touchPressed.has('lk');
      state.mk = state.mk || touch.mk || touchPressed.has('mk');
      state.hk = state.hk || touch.hk || touchPressed.has('hk');
    }

    const wasHeld = (button: 'lp' | 'mp' | 'hp' | 'lk' | 'mk' | 'hk'): boolean =>
      !pressed.has(map[button]) && !touchPressed.has(button) && (prev?.[button] ?? false);
    const raw: RawInput = {
      ...state,
      lpPrev: wasHeld('lp'),
      mpPrev: wasHeld('mp'),
      hpPrev: wasHeld('hp'),
      lkPrev: wasHeld('lk'),
      mkPrev: wasHeld('mk'),
      hkPrev: wasHeld('hk'),
    };
    session.previous[player] = raw;
    return raw;
  }
}
