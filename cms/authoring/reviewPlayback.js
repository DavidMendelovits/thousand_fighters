import {moveVisualFrameAt} from '../../shared/moveVisualFrame.js';
import {convertMove} from '../export/convertDraftToCharacterConfig.js';

const loops = new Set(['idle','walk_forward','walk_back']);
const eventNames = {hitbox_active:'Hitbox on',hitbox_end:'Hitbox off',grab_check:'Grab check',grab_end:'Grab off',spawn_projectile:'Projectile release',spawn_projectile_at_target:'Target projectile',spawn_projectile_from_sky:'Sky projectile',spawn_projectile_behind_target:'Rear projectile',summon_control:'Summon control',recall_summon:'Recall summon',transform:'Transform',revert_form:'Revert form',power_up:'Power up',spawn_effect:'Effect release'};
const ticks = value => Number.isInteger(value) && value > 0 && value <= 216000;

/** A no-contact timeline. Grabs, hitstop, interrupts and airborne duration
 * depend on the opponent/state and still require the actual playtest. */
export function reviewPlayback(draft, row, frames, {mode='game',moveId}={}) {
  if (!['game','source'].includes(mode)) throw new Error('Unknown review timing mode.');
  const moves = (draft.moves??[]).filter(move=>move.animation===row).map(move=>convertMove(move,{frameData:{frames:{[row]:frames}},preserveGeometry:true}));
  const move = moveId ? moves.find(move=>move.id===moveId) : moves[0];
  if (moveId && !move) throw new Error('Move does not use this animation row.');
  const playback=draft.sprite?.rowPlayback?.[row];
  const warnings=[];
  if(mode==='source') return {sequence:frames.map((frame,index)=>({index,duration:Math.max(1,Math.round(frame.durationFrames??playback?.ticksPerFrame??6))})),events:[],loop:playback?.loop??loops.has(row),mode:'source',warnings:['All extracted poses at extraction timing, not combat timing.'],description:'All extracted poses, including poses skipped by combat. This is not the original video speed.'};
  let total, sample, loop=false, description;
  const eventsByTick=new Map();
  const event=(tick,type,label)=>{
    const existing=eventsByTick.get(tick);
    if(existing)existing.label+=` · ${label}`;
    else eventsByTick.set(tick,{tick,type,label});
  };
  if(move){
    if(!move.phases?.length||move.phases.some(phase=>!ticks(phase.frames)))throw new Error('Invalid move phase timing.');
    total=move.phases.reduce((sum,phase)=>sum+phase.frames,0);
    if(move.visualTimeline?.some(pose=>!ticks(pose.duration)||!Number.isInteger(pose.frame)||pose.frame<0||pose.frame>=frames.length))throw new Error('Invalid move visual timeline.');
    sample=tick=>moveVisualFrameAt(move,tick,frames.length);
    let start=0;
    for(const phase of move.phases){
      event(start,'phase',phase.name??'Phase');
      for(const entry of phase.events??[]){
        if(!Number.isInteger(entry.onFrame)||entry.onFrame<0||entry.onFrame>=phase.frames){warnings.push(`An event outside ${phase.name} will not execute in the runtime.`);continue;}
        if(eventNames[entry.event?.type])event(start+entry.onFrame,entry.event.type,eventNames[entry.event.type]);
      }
      start+=phase.frames;
    }
    description=`Game timing · ${move.displayName??move.id} · no-contact playback. Hitstop, cancels, grabs and interruptions require a playtest.`;
    if(moves.length>1)warnings.push(`This row is used by ${moves.length} moves. Inspect each move variant before approval.`);
    if(move.phases.some(p=>p.events?.some(e=>e.event?.type==='grab_check')))warnings.push('This is the unconnected grab. Holding an opponent uses interactive grip timing; verify it in Play current draft.');
  }else if(row==='base'){
    return {...reviewPlayback(draft,row,frames,{mode:'source'}),description:'Base reference poses. Runtime states choose their own base frame; not a standalone combat animation.'};
  }else{
    const duration=playback?.durationTicks??(row==='landing'?4:row==='getup'?25:row==='hurt'?12:null);
    if(duration!=null){
      if(!ticks(duration))throw new Error('Invalid state duration.');
      total=duration;sample=tick=>Math.min(frames.length-1,Math.floor(tick*frames.length/total));
    }else{
      // Dash and legacy controlled-hand idle currently use the runtime's
      // fixed six-tick state-row cadence, not extraction frame holds.
      const actorIdle=(draft.actors??[]).some(a=>a.idleAnimation===row)||(row==='hands_idle'&&(draft.actors??[]).some(a=>a.id==='hands'));
      const step=/^dash_/.test(row)||actorIdle?6:(playback?.ticksPerFrame??6);
      if(!ticks(step))throw new Error('Invalid state frame cadence.');
      total=frames.length*step;sample=tick=>Math.min(frames.length-1,Math.floor(tick/step));
      loop=playback?.loop??(loops.has(row)||actorIdle);
    }
    description=`Game state timing · ${row.replaceAll('_',' ')}. State exit can interrupt this row.`;
    if(row==='hurt'&&!playback?.durationTicks)warnings.push('Hurt shown as a 12-tick example. Actual hitstun/stun duration comes from the incoming move.');
    if(/^dash_|^jump$/.test(row))warnings.push('Movement and state exit depend on the simulation. This isolates pose cadence, not the travel path.');
  }
  if(!ticks(total))throw new Error('Review timeline exceeds the supported duration.');
  const sequence=[];
  for(let tick=0;tick<total;tick++){
    const index=sample(tick),last=sequence.at(-1);
    if(last?.index===index)last.duration++;else sequence.push({index,duration:1});
  }
  if(sequence.length>4096)throw new Error('Too many review poses.');
  return {sequence,events:[...eventsByTick.values()],loop,mode:'game',moveId:move?.id,warnings,description};
}
