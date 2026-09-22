/** Shared by paid generation and offline reprocessing; never substitute a body for a summon. */
export function motionActorReference(draft, row, frameData) {
  const move = draft.moves?.find(m => m.id === row || m.animation === row);
  const actorId = draft.motionActors?.[row] ?? move?.controlledActor ?? draft.actors?.find(a => a.idleAnimation === row)?.id;
  const actor = actorId ? draft.actors?.find(a => a.id === actorId) : null;
  if (actorId && !actor) throw new Error(`Unknown motion actor: ${actorId}`);
  const referenceFile = actor
    ? actor.sprite?.frames?.base?.[0]?.file ?? frameData?.frames?.[actor.idleAnimation]?.[0]?.file ?? draft.sprite?.frames?.[actor.idleAnimation]?.[0]?.file
    : draft.sprite?.frames?.base?.[0]?.file ?? 'sprites/base/base_001.png';
  if (!referenceFile) throw new Error(`Create and extract the isolated ${actorId} idle reference before generating its video. The body reference will not be substituted.`);
  return { actorId, referenceFile };
}

export function motionCompilerSettings(artStyle, provider = 'fal') {
  const paint = ['paint', 'watercolor'].includes(artStyle);
  // Pruna can alternate between magenta and white even within one video.
  // Validate and key each frame independently, including large background
  // gaps enclosed by orbiting ribbons. A fixed magenta key mistakes white
  // frames for a clipped full-canvas actor.
  const pixelVideo = !paint;
  return { style: paint ? 'watercolor' : 'pixel',
    background: paint ? 'paint-auto' : 'pruna-frame',
    rootMode: paint ? 'fixed' : 'pelvis', expandCanvas: paint || pixelVideo,
    despillMagenta: pixelVideo };
}

export function motionCompilerArgs(settings) {
  return ['--style', settings.style, '--background', settings.background, '--root-mode', settings.rootMode,
    ...(settings.expandCanvas ? ['--expand-canvas'] : []),
    ...(settings.despillMagenta ? ['--despill-magenta-edges'] : [])];
}

export function motionReferenceOccupancy(artStyle, provider = 'fal', row = '') {
  if (['paint', 'watercolor'].includes(artStyle)) return 0.35;
  // Pruna's action videos can stretch a ribbon well beyond the source body.
  // Reserve lateral space before submission; the compiler still rejects any
  // genuinely clipped result instead of cropping the effect into a sheet.
  if(provider === 'pruna' && /lasso|lash|tether|whip|surge|extend/.test(row))return 0.35;
  return provider === 'pruna' ? 0.5 : 0.65;
}

export function motionReferenceCanvasSize(artStyle, provider = 'fal', actorId = null, row = '') {
  if(provider === 'pruna' && !['paint','watercolor'].includes(artStyle) && (actorId || /lasso|lash|tether|whip|surge|extend/.test(row))) return 1536;
  return provider === 'pruna' && !['paint', 'watercolor'].includes(artStyle) ? 1024 : 768;
}
