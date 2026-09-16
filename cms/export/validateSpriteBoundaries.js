/** Source clipping survives recanvas/padding and must not be certified away. */
export function clippedSourceFrames(frameData) {
  return Object.entries(frameData?.frames ?? {}).flatMap(([row, frames]) =>
    frames.filter(frame => frame.sourceClipped).map(frame => `${row}/${frame.file}`));
}

export function validateSpriteBoundaries(frameData) {
  const clipped = clippedSourceFrames(frameData);
  if (clipped.length) throw new Error(`Source clipping: ${clipped.join(', ')}. Regenerate with more motion margin or separate VFX before publishing. Padding cannot restore missing pixels.`);
}
