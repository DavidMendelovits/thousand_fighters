/** Inclusive authored interval, including the last pose on the final held tick. */
export function heldGripFrame(first: number, last: number, remaining: number, duration: number, frameCount: number): number {
  const start = Math.max(0, Math.min(frameCount - 1, first));
  const end = Math.max(start, Math.min(frameCount - 1, last));
  const ticks = Math.max(1, duration);
  const elapsed = Math.max(0, Math.min(ticks - 1, ticks - remaining));
  return Math.min(end, start + Math.round(elapsed * (end - start) / Math.max(1, ticks - 1)));
}
