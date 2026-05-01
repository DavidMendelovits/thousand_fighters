export class HitPause {
  static trigger(scene: { hitPauseFrames: number }, frames: number): void {
    scene.hitPauseFrames = Math.max(scene.hitPauseFrames, frames);
  }
}
