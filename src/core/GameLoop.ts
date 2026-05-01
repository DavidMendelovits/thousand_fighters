export class GameLoop {
  private readonly frameMs = 1000 / 60;
  private accumulator = 0;
  private lastTime: number | null = null;

  update(time: number, step: () => void): void {
    if (this.lastTime === null) {
      this.lastTime = time;
      return;
    }

    const delta = Math.min(time - this.lastTime, this.frameMs * 5);
    this.lastTime = time;
    this.accumulator += delta;

    while (this.accumulator >= this.frameMs) {
      step();
      this.accumulator -= this.frameMs;
    }
  }
}
