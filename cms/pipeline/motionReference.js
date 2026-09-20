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

export function motionCompilerSettings(artStyle) {
  return { style: ['paint', 'watercolor'].includes(artStyle) ? 'watercolor' : 'pixel',
    background: artStyle === 'paint' ? 'paint-auto' : 'magenta', rootMode: artStyle === 'paint' ? 'fixed' : 'pelvis', expandCanvas: artStyle === 'paint' };
}

export function motionCompilerArgs(settings) {
  return ['--style', settings.style, '--background', settings.background, '--root-mode', settings.rootMode,
    ...(settings.expandCanvas ? ['--expand-canvas'] : [])];
}
