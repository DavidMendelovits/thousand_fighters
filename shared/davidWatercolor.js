/** Re-theme authored mechanics without changing collision, timing or cancel rules. */
export function applyDavidWatercolor(draft){
  draft.artStyle='watercolor';draft.videoGenerator='pruna-video';draft.requireMotionCoverage=true;
  draft.concept={...draft.concept,role:'Watercolor conjurer / juggling mix-up artist',biography:'A comedian and artist whose gestures turn watercolor pigment into moving forms. Juggled paint, painted resonance, liquid fists and wrapping ribbons share one medium.',accent:'#45bdbd',tags:['WATERCOLOR','PIGMENT JUGGLING','PAINT RIBBON'],artStatus:'Watercolor revision in progress; only reviewed video rows may publish.'};
  draft.description=draft.concept.biography;
  draft.artBrief='David: slim adult man, swept brown hair, narrow face, vivid red yellow teal abstract short-sleeved shirt tucked into blue jeans, belt and light sneakers. Handheld microphone firmly gripped. Hand-painted watercolor with translucent pigment and indigo contours. Right-facing full body, flat magenta background. Body and paint effects are separate passes.';
  const names={punch:'Pigment Jab',kick:'Brushstroke Kick',cascade:'Pigment Cascade',sound_wave:'Painted Resonance',ink_construct:'Wet-on-Wet',mic_reel:'Ribbon Reel',clinch:'Wet Wrap'};
  const descriptions={cascade:'Three staggered watercolor droplets arc through the air; hit-confirm into painted resonance or a pigment fist.',sound_wave:'The microphone projects a translucent painted wave with strong knockback.',ink_construct:'A brush gesture sends out wet pigment that forms a painted fist after six ticks and launches on impact.',mic_reel:'A watercolor ribbon unfurls from the microphone gesture, wraps a grounded opponent and reels them in. Jump to evade; punish whiff recovery.',clinch:'A close-range watercolor wrap and throw with a finite hold.'};
  const repaint=p=>{
    if(!p?.visual)return;
    const kinds={'juggling-ball':'paint-orb',wave:'paint-wave','ink-fist':'paint-fist'};
    p.visual.kind=kinds[p.visual.kind]??p.visual.kind;
    if(p.visual.kind==='paint-fist')p.visual.color=0x4365ad;
    p.visual.accent=0xf4b963;
    p.impact={...p.impact,kind:'watercolor',color:p.visual.color,accent:0xf4b963};
    p.animation=`${p.animation.replace(/_watercolor$/,'')}_watercolor`;
  };
  for(const p of draft.projectiles??[])repaint(p);
  for(const move of draft.moves??[]){
    move.displayName=names[move.id]??move.displayName;
    move.description=descriptions[move.id]??move.description;
    if(move.extension)move.extension={kind:'paint-ribbon',color:0x43aaa9,accent:0xecab70,thickness:7};
    for(const phase of move.phases??[])for(const {event} of phase.events??[])if(event.projectile)repaint(event.projectile);
  }
  return draft;
}
