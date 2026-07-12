import type { Fighter } from './Fighter';
import type { RawInput } from '../schema/types';

type InputPlanStep = {
  frames: number;
  input: Partial<RawInput>;
};

const neutralButtons = {
  lp: false,
  mp: false,
  hp: false,
  lk: false,
  mk: false,
  hk: false,
};

function emptyRaw(prev: RawInput | null): RawInput {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
    ...neutralButtons,
    lpPrev: prev?.lp ?? false,
    mpPrev: prev?.mp ?? false,
    hpPrev: prev?.hp ?? false,
    lkPrev: prev?.lk ?? false,
    mkPrev: prev?.mk ?? false,
    hkPrev: prev?.hk ?? false,
  };
}

export class ComputerPlayer {
  private previous: RawInput | null = null;
  private plan: InputPlanStep[] = [];
  private thinkCooldown = 0;

  read(self: Fighter, opponent: Fighter, frame: number): RawInput {
    const raw = this.nextInput(self, opponent, frame);
    this.previous = raw;
    return raw;
  }

  private nextInput(self: Fighter, opponent: Fighter, frame: number): RawInput {
    if (this.plan.length > 0) {
      const step = this.plan[0];
      const raw = { ...emptyRaw(this.previous), ...step.input };
      step.frames -= 1;
      if (step.frames <= 0) this.plan.shift();
      return raw;
    }

    const raw = emptyRaw(this.previous);
    if (self.state === 'attack' || self.state === 'hitstun' || self.state === 'blockstun' || self.state === 'grabbed' || self.state === 'juggle') {
      return raw;
    }

    this.thinkCooldown = Math.max(0, this.thinkCooldown - 1);
    const distance = Math.abs(opponent.x - self.x);
    const forwardKey = self.facing === 1 ? 'right' : 'left';
    const backKey = self.facing === 1 ? 'left' : 'right';

    if (opponent.state === 'attack' && distance < 105) {
      return { ...raw, [backKey]: true, down: opponent.currentMove?.id === 'crouch_low_kick' };
    }

    if (this.thinkCooldown > 0) {
      return distance > 92 ? { ...raw, [forwardKey]: true } : raw;
    }

    if (distance > 280) {
      this.enqueueMotion(self.facing, 'projectile');
      this.thinkCooldown = 54;
      return this.nextInput(self, opponent, frame);
    }

    if (distance > 145) {
      if (frame % 150 < 38) {
        this.enqueueMotion(self.facing, 'dash');
        this.thinkCooldown = 42;
        return this.nextInput(self, opponent, frame);
      }
      return { ...raw, [forwardKey]: true };
    }

    if (frame % 210 < 44) {
      this.enqueueMotion(self.facing, 'uppercut');
    } else if (frame % 96 < 34) {
      this.enqueueMotion(self.facing, 'low');
    } else {
      this.enqueueMotion(self.facing, 'jab');
    }
    this.thinkCooldown = 34;
    return this.nextInput(self, opponent, frame);
  }

  private enqueueMotion(facing: 1 | -1, motion: 'projectile' | 'uppercut' | 'dash' | 'low' | 'jab'): void {
    const forward = facing === 1 ? 'right' : 'left';
    const downForward = { down: true, [forward]: true };

    if (motion === 'projectile') {
      this.plan = [
        { frames: 3, input: { down: true } },
        { frames: 3, input: downForward },
        { frames: 2, input: { [forward]: true, hp: true } },
      ];
    } else if (motion === 'uppercut') {
      this.plan = [
        { frames: 2, input: { [forward]: true } },
        { frames: 2, input: { down: true } },
        { frames: 2, input: { ...downForward, hp: true } },
      ];
    } else if (motion === 'dash') {
      this.plan = [
        { frames: 2, input: { [forward]: true } },
        { frames: 1, input: {} },
        { frames: 2, input: { [forward]: true, lp: true } },
      ];
    } else if (motion === 'low') {
      this.plan = [{ frames: 2, input: { down: true, lk: true } }];
    } else {
      this.plan = [{ frames: 2, input: { lp: true } }];
    }
  }
}
