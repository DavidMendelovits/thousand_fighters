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

    // LP+LK pressed together on the same frame → emit 'grab' and suppress the
    // bare lp/lk so the grab token doesn't also shadow-match a bare-button move.
    const lpNew = raw.lp && !raw.lpPrev;
    const lkNew = raw.lk && !raw.lkPrev;
    if (lpNew && lkNew) {
      tokens.push('grab');
    } else {
      if (lpNew) tokens.push('lp');
      if (lkNew) tokens.push('lk');
    }
    if (raw.mp && !raw.mpPrev) tokens.push('mp');
    if (raw.hp && !raw.hpPrev) tokens.push('hp');
    if (raw.mk && !raw.mkPrev) tokens.push('mk');
    if (raw.hk && !raw.hkPrev) tokens.push('hk');

    this.history.push({ tokens, frame: this.currentFrame, raw: { ...raw } });
    this.currentFrame += 1;
    if (this.history.length > this.maxHistory) this.history.shift();
  }

  matchSequence(sequence: InputToken[], windowFrames = 15, activationFrames = 6): boolean {
    if (sequence.length === 0) return false;

    const recent = this.history.slice(-windowFrames);
    let seqIdx = 0;

    for (const entry of recent) {
      for (const token of entry.tokens) {
        if (token === sequence[seqIdx]) {
          seqIdx += 1;
          // Motion recognition can be generous without keeping a completed
          // attack queued for the entire motion window. Six simulation ticks
          // permit deliberate recovery links without quarter-second ghost hits.
          if (seqIdx === sequence.length) {
            if (this.currentFrame - 1 - entry.frame < activationFrames) return true;
            seqIdx = 0;
          }
        }
      }
    }

    return false;
  }

  current(): RawInput {
    return this.history[this.history.length - 1]?.raw ?? emptyInput;
  }

  clear(): void { this.history = []; this.currentFrame = 0; }
  consumeButtons(): void {
    const buttons=new Set(['lp','mp','hp','lk','mk','hk','grab']);
    for(const entry of this.history)entry.tokens=entry.tokens.filter(t=>!buttons.has(t));
  }
}
