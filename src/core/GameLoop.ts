export class GameLoop {
  private readonly frameMs = 1000 / 60;
  private accumulator = 0;
  private lastTime: number | null = null;

  reset(): void {
    this.lastTime = null;
    this.accumulator = 0;
  }

  update(time: number, step: () => void, timeScale = 1): void {
    if (this.lastTime === null) {
      this.lastTime = time;
      return;
    }

    const delta = Math.max(0, Math.min(time - this.lastTime, this.frameMs * 5));
    this.lastTime = time;
    this.accumulator += delta * timeScale;

    // Tolerate floating point timestamp roundoff at exact tick boundaries.
    while (this.accumulator + 1e-8 >= this.frameMs) {
      this.accumulator -= this.frameMs;
      step();
    }
    this.accumulator = Math.max(0, this.accumulator);
  }
}
