/**
 * preserveTunedAnchors.js
 *
 * Re-extraction / re-normalization rebuilds a fighter's frameData from the
 * source art, which would clobber anchors hand-tuned in the Character Gym.
 * These helpers preserve a frame's tuned anchor (and its anchor-relative
 * collision boxes) across a rebuild — but ONLY while the frame dimensions
 * still match. If the art changed size, the manual anchor no longer maps to
 * the same pixel, so we take the fresh measurement and warn (A6/T5).
 *
 * The gym stamps tuned frames with `anchorEdited: true` (see src/gym).
 */

/**
 * @param {Array<object>} priorFrames - existing frames for one sheet (may be undefined)
 * @param {Array<object>} freshFrames - freshly-extracted frames for one sheet
 * @param {(warning: string) => void} [onWarning]
 * @returns {Array<object>} merged frames
 */
export function mergePreservedAnchorFrames(priorFrames, freshFrames, onWarning) {
  const prior = Array.isArray(priorFrames) ? priorFrames : [];
  return freshFrames.map((frame, index) => {
    const old = prior[index];
    if (!old?.anchorEdited) return frame;
    if (old.width === frame.width && old.height === frame.height) {
      return {
        ...frame,
        anchor: old.anchor,
        hurtbox: old.hurtbox ?? frame.hurtbox,
        attackBox: old.attackBox ?? frame.attackBox,
        anchorEdited: true,
      };
    }
    onWarning?.(
      `frame ${index + 1}: hand-tuned anchor dropped — frame size changed `
      + `${old.width}x${old.height} -> ${frame.width}x${frame.height} on re-extraction`,
    );
    return frame;
  });
}

/**
 * Merge tuned anchors across a whole-pack frameData rebuild.
 *
 * @param {object|null} priorFrameData - existing frameData ({ frames: {...} })
 * @param {object} freshFrameData - freshly-built frameData
 * @param {(warning: string) => void} [onWarning]
 * @returns {object} merged frameData (a shallow copy; freshFrameData is not mutated)
 */
export function mergePreservedFrameData(priorFrameData, freshFrameData, onWarning) {
  if (!priorFrameData?.frames || !freshFrameData?.frames) return freshFrameData;
  const merged = { ...freshFrameData, frames: { ...freshFrameData.frames } };
  for (const sheetId of Object.keys(merged.frames)) {
    if (!Array.isArray(merged.frames[sheetId])) continue;
    merged.frames[sheetId] = mergePreservedAnchorFrames(
      priorFrameData.frames[sheetId],
      merged.frames[sheetId],
      onWarning ? (w) => onWarning(`${sheetId}: ${w}`) : undefined,
    );
  }
  return merged;
}
