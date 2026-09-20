/** Retiming changes visual playback only. Collision/event ticks remain authored. */
export function retimeMotion(move, count, contact=Math.floor(count*.45), recoveryFrame) {
  contact=Math.max(1,Math.min(count-2,contact));
  const total=move.phases.reduce((n,p)=>n+p.frames,0);
  const startup=move.phases[0]?.frames??1;
  const active=move.phases[1]?.frames??1;
  const activeEnd=Math.max(contact+1,Math.min(count-1,recoveryFrame??contact+Math.max(1,Math.round(count*.15))));
  const timeline=[];
  for(let tick=0;tick<total;tick++){
    let frame=tick<startup?Math.floor(tick/startup*contact):tick<startup+active?contact+Math.floor((tick-startup)/active*(activeEnd-contact)):activeEnd+Math.floor((tick-startup-active)/Math.max(1,total-startup-active)*(count-activeEnd));
    frame=Math.min(count-1,frame);
    if(timeline.at(-1)?.frame===frame)timeline.at(-1).duration++;else timeline.push({frame,duration:1});
  }
  return timeline;
}

export function motionMarkers(move) {
  const startup=move.phases?.[0]?.frames??0, active=move.phases?.[1]?.frames??0;
  const at=tick=>{let end=0;for(const entry of move.visualTimeline??[]){end+=entry.duration;if(tick<end)return entry.frame;}return null;};
  return {contactFrame:at(startup),recoveryFrame:at(startup+active)};
}
