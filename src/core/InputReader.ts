import type { RawInput } from '../schema/types';

type KeyMap = Record<keyof Omit<RawInput, 'lpPrev' | 'mpPrev' | 'hpPrev' | 'lkPrev' | 'mkPrev' | 'hkPrev'>, string>;

const keyMaps: Record<1 | 2, KeyMap> = {
  1: {
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
  private static previous: Record<1 | 2, RawInput | null> = { 1: null, 2: null };

  static read(player: 1 | 2, keyboard: Phaser.Input.Keyboard.KeyboardPlugin): RawInput {
    const map = keyMaps[player];
    const prev = this.previous[player];
    const state = {
      left: keyboard.addKey(map.left).isDown,
      right: keyboard.addKey(map.right).isDown,
      up: keyboard.addKey(map.up).isDown,
      down: keyboard.addKey(map.down).isDown,
      lp: keyboard.addKey(map.lp).isDown,
      mp: keyboard.addKey(map.mp).isDown,
      hp: keyboard.addKey(map.hp).isDown,
      lk: keyboard.addKey(map.lk).isDown,
      mk: keyboard.addKey(map.mk).isDown,
      hk: keyboard.addKey(map.hk).isDown,
    };

    const raw: RawInput = {
      ...state,
      lpPrev: prev?.lp ?? false,
      mpPrev: prev?.mp ?? false,
      hpPrev: prev?.hp ?? false,
      lkPrev: prev?.lk ?? false,
      mkPrev: prev?.mk ?? false,
      hkPrev: prev?.hk ?? false,
    };
    this.previous[player] = raw;
    return raw;
  }
}
