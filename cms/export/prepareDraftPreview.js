/** Visual proxies for an unfinished draft's testbed only. Never persist/export. */
export function prepareDraftPreview({draft,frameData,manifest}){
  if(!frameData?.frames?.base?.length)throw new Error('Generate the base reference before previewing this draft.');
  const frames=structuredClone(frameData.frames);
  const counts={...(manifest?.frameCounts??{})};
  const fallbackRows=[];
  const actorById=new Map((draft.actors??[]).map(actor=>[actor.id,actor]));
  const rows=new Map();
  for(const row of ['idle','walk_forward','walk_back','jump','landing','crouch','block','hurt','getup'])rows.set(row,null);
  for(const move of draft.moves??[])rows.set(move.animation,move.controlledActor??null);
  for(const actor of draft.actors??[])if(actor.idleAnimation)rows.set(actor.idleAnimation,actor.id);
  for(const [row,actorId] of rows){
    if(!row||frames[row]?.length)continue;
    const source=actorId?actorById.get(actorId)?.idleAnimation:'base';
    if(!source||!frames[source]?.length)throw new Error(`Preview needs an isolated ${actorId} reference before ${row}.`);
    frames[row]=structuredClone(frames[source]);
    counts[row]=frames[row].length;
    fallbackRows.push({row,source});
  }
  return {frameData:{...frameData,frames},manifest:{...(manifest??{}),frameCounts:counts},fallbackRows};
}
