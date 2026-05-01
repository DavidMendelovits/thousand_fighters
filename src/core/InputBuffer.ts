import type { InputToken, RawInput } from '../schema/types';

const emptyInput: RawInput = {
  left: false,
  right: false,
  up: false,
  down: false,
  lp: false,
  mp: false,
  hp: false,
  lk: false,
  mk: false,
  hk: false,
  lpPrev: false,
  mpPrev: false,
  hpPrev: false,
  lkPrev: false,
  mkPrev: false,
  hkPrev: false,
};

export class InputBuffer {
  private history: Array<{ tokens: InputToken[]; frame: number; raw: RawInput }> = [];
  private currentFrame = 0;
  private readonly maxHistory = 60;

  record(raw: RawInput, facing: 1 | -1): void {
    const tokens: InputToken[] = [];
    const forward = facing === 1 ? raw.right : raw.left;
    const back = facing === 1 ? raw.left : raw.right;

    if (raw.up && forward) tokens.push('up-forward');
    else if (raw.up && back) tokens.push('up-back');
    else if (raw.down && forward) tokens.push('down-forward');
    else if (raw.down && back) tokens.push('down-back');
    else if (raw.up) tokens.push('up');
    else if (raw.down) tokens.push('down');
    else if (forward) tokens.push('forward');
    else if (back) tokens.push('back');
    else tokens.push('neutral');

    if (raw.lp && !raw.lpPrev) tokens.push('lp');
    if (raw.mp && !raw.mpPrev) tokens.push('mp');
    if (raw.hp && !raw.hpPrev) tokens.push('hp');
    if (raw.lk && !raw.lkPrev) tokens.push('lk');
    if (raw.mk && !raw.mkPrev) tokens.push('mk');
    if (raw.hk && !raw.hkPrev) tokens.push('hk');

    this.history.push({ tokens, frame: this.currentFrame, raw: { ...raw } });
    this.currentFrame += 1;
    if (this.history.length > this.maxHistory) this.history.shift();
  }

  matchSequence(sequence: InputToken[], windowFrames = 15): boolean {
    if (sequence.length === 0) return false;

    const recent = this.history.slice(-windowFrames);
    let seqIdx = 0;

    for (const entry of recent) {
      for (const token of entry.tokens) {
        if (token === sequence[seqIdx]) {
          seqIdx += 1;
          if (seqIdx === sequence.length) return true;
        }
      }
    }

    return false;
  }

  current(): RawInput {
    return this.history[this.history.length - 1]?.raw ?? emptyInput;
  }
}
