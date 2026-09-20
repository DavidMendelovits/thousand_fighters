/** Shared by the runtime and CMS review. Timing changes belong in the move,
 * never in a second preview-only interpretation of its sprite sequence. */
export function moveVisualFrameAt(move, elapsed, frameCount) {
  const maxFrame = Math.max(0, frameCount - 1);
  const clamp = frame => Math.max(0, Math.min(maxFrame, frame));
  const tick = Math.max(0, elapsed);
  if (move.visualTimeline?.length) {
    let cursor = 0;
    for (const visual of move.visualTimeline) {
      cursor += visual.duration;
      if (tick < cursor) return clamp(visual.frame);
    }
    return clamp(move.visualTimeline[move.visualTimeline.length - 1].frame);
  }
  const duration = move.phases.reduce((sum, phase) => sum + phase.frames, 0);
  return clamp(Math.floor(tick / Math.max(duration, 1) * frameCount));
}
