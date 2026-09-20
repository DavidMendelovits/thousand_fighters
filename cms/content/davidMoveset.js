import {retimeMotion} from '../pipeline/motionRowArtifacts.js';

const ground=['idle','walk_forward','walk_back','crouch','block','landing'];
const down=['down','down-forward','down-back'];
/** Mechanics prototype. Unique requiredAnimation rows deliberately block art publication. */
export function expandDavidMoveset(original){
  const draft=structuredClone(original);
  if(draft.id!=='david')throw new Error('This authored moveset belongs to David');
  const existing=new Map(draft.moves.map(m=>[m.id,m]));
  const added=[];
  function normal(id,name,button,directions,timing,damage,box,options={}){
    const animation=options.animation??(button==='lk'?'kick':'punch');
    const [startup,active,recovery]=timing;
    const hitbox={x:20,y:-94,width:52,height:30,damage,hitstun:options.hitstun??14,blockstun:7,hitstop:3,knockback:{x:options.push??1.5,y:options.launch?-5:0},level:'mid',...box};
    const move={id,displayName:name,category:options.category??'directional',animation,requiredAnimation:id,artStatus:'proxy',description:options.description??name,inputLabel:options.label,
      trigger:{allowedStates:options.air?['airborne']:ground,sequence:[button],window:8,...(directions?{directions}:{})},
      phases:[{name:'startup',frames:startup,events:[{onFrame:0,event:{type:'set_velocity',vx:options.advance??0,relativeToFacing:true}}]},
        {name:'active',frames:active,events:[{onFrame:0,event:{type:'hitbox_active',hitbox}}]},
        {name:'recovery',frames:recovery,cancellable:true,events:[{onFrame:0,event:{type:'hitbox_end'}},{onFrame:0,event:{type:'set_velocity',vx:0}}]}],
      cancelOn:'hit',cancelInto:[],airOk:!!options.air,groundOk:!options.air};
    const row=draft.motionRows?.[animation];
    if(row)move.visualTimeline=retimeMotion(move,row.frameCount,row.contactFrame,row.recoveryFrame);
    added.push(move);return move;
  }
  normal('forward_jab','Advancing Stroke','lp',['forward'],[9,3,17],40,{width:78},{advance:1.2,label:'→ + J',description:'Advancing mid poke; longer reach, slower recovery than neutral jab.'});
  normal('down_jab','Low Dab','lp',down,[6,2,11],22,{y:-38,width:46,height:24,level:'low'},{label:'↓ + J',description:'Fast low interrupt; modest reward and short range.'});
  normal('back_jab','Retreating Stroke','lp',['back'],[10,3,18],35,{width:58},{advance:-1.1,label:'← + J',description:'Retreating mid check; sacrifices pressure for spacing.'});
  normal('forward_kick','Long Brush','lk',['forward'],[13,3,21],58,{width:100},{advance:1,label:'→ + K',push:4});
  normal('down_kick','Pigment Sweep','lk',down,[12,3,24],48,{y:-28,width:80,height:24,level:'low'},{label:'↓ + K',push:4,description:'Long low sweep; punishable when blocked or missed.'});
  normal('back_kick','Rising Heel','lk',['back'],[16,3,24],58,{y:-130,width:62,height:74},{label:'← + K',launch:true,hitstun:22});
  added.find(m=>m.id==='down_jab').trigger.directions=['down','down-back'];
  normal('uppercut','Rising Brush','lp',['down-forward'],[10,3,25],55,{y:-148,width:48,height:105},{label:'↘ + J',launch:true,hitstun:22});
  normal('air_jab','Air Dab','lp',undefined,[6,3,13],28,{y:-95,width:57,height:34},{category:'air',air:true,label:'Air J'});
  normal('air_kick','Air Sweep','lk',undefined,[9,4,18],45,{y:-68,width:78,height:45},{category:'air',air:true,label:'Air K',push:3});
  const reverse=structuredClone(existing.get('clinch'));
  reverse.id='reverse_throw';reverse.displayName='Reverse Wrap';reverse.category='throw';reverse.inputLabel='← + Grab';reverse.trigger={allowedStates:ground,sequence:['grab'],directions:['back'],window:8};
  reverse.requiredAnimation='reverse_throw';reverse.artStatus='proxy';
  for(const phase of reverse.phases)for(const {event}of phase.events)if(event.grab)event.grab.releaseKnockback.x=-Math.abs(event.grab.releaseKnockback.x);
  added.push(reverse);
  function follow(id,name,from,button,animation,timing,damage,box={},options={}){
    const m=normal(id,name,button,undefined,timing,damage,box,{animation,category:'string',...options});
    m.trigger={allowedStates:['attack'],sequence:[button],window:24,activationFrames:24,cancelOnly:true,cancelFrom:[from],cancelOn:'always'};
    return m;
  }
  follow('jab_second','Double Stroke','punch','lp','punch',[5,2,12],26);
  follow('jab_third','Triple Stroke','jab_second','lp','punch',[7,3,19],42,{width:65},{push:3});
  follow('jab_kick_end','Brush Finish','jab_second','lk','kick',[8,3,21],48,{width:76},{push:4});
  follow('jab_low_end','Low Finish','jab_second','hp','kick',[12,3,24],44,{y:-32,width:76,height:26,level:'low'},{push:3});
  follow('forward_second','Advancing Double','forward_jab','lp','punch',[6,2,15],32,{width:68});
  follow('forward_finish','Advancing Launch','forward_second','lk','kick',[12,3,25],50,{y:-125,width:65,height:75},{launch:true,hitstun:22});
  follow('back_finish','Retreating Finish','back_jab','lk','kick',[10,3,21],44,{width:80},{push:4});
  follow('kick_second','Double Brush','kick','lk','kick',[8,3,17],35,{width:75});
  follow('kick_finish','Cross Stroke','kick_second','lp','punch',[8,3,20],43,{width:69},{push:3});
  follow('low_follow','Low-to-Mid','down_jab','lk','kick',[8,3,17],32,{width:60});
  const ids=new Set(added.map(m=>m.id));
  for(const move of added){
    const prior=existing.get(move.id),row=draft.motionRows?.[move.requiredAnimation];
    if(prior?.artStatus==='ready'&&prior.animation===move.requiredAnimation&&row?.status==='approved'){
      move.animation=prior.animation;move.artStatus='ready';move.visualTimeline=retimeMotion(move,row.frameCount,row.contactFrame,row.recoveryFrame);
    }
  }
  draft.moves=draft.moves.filter(m=>!ids.has(m.id));
  for(const m of draft.moves){m.category=['punch','kick'].includes(m.id)?'basic':m.id==='clinch'?'throw':'special';}
  draft.moves.push(...added);
  for(const [id,directions]of [['sound_wave',['forward']],['ink_construct',down],['mic_reel',['back']]]){
    const move=draft.moves.find(m=>m.id===id);
    if(move)move.trigger.directions=directions;
  }
  for(const id of ['punch','kick'])for(const phase of draft.moves.find(m=>m.id===id).phases)phase.cancellable=phase.name==='recovery';
  const routes=[
    ['double_stroke','J J',['punch','jab_second'],'Short confirm; stop here or branch.'],
    ['triple_stroke','J J J',['punch','jab_second','jab_third'],'Mid ender and spacing reset.'],
    ['brush_finish','J J K',['punch','jab_second','jab_kick_end'],'Knockback ender.'],
    ['low_finish','J J S',['punch','jab_second','jab_low_end'],'Slower low ender; defender can crouch-block.'],
    ['jab_kick','J K',['punch','kick'],'Existing hit-confirm link.'],
    ['advancing_double','→ J J',['forward_jab','forward_second'],'Advancing pressure string.'],
    ['advancing_launch','→ J J K',['forward_jab','forward_second','forward_finish'],'Slower launcher ender.'],
    ['retreating_finish','← J K',['back_jab','back_finish'],'Retreating check into pushback.'],
    ['double_brush','K K',['kick','kick_second'],'Two-kick pressure.'],
    ['cross_stroke','K K J',['kick','kick_second','kick_finish'],'Punch ender after kicks.'],
    ['low_to_mid','↓ J K',['down_jab','low_follow'],'Low starter into a mid.'],
    ['resonance_confirm','J J → S',['punch','jab_second','sound_wave'],'Hit-confirm into painted resonance.']
  ];
  // No ambiguous S branch: a string ender and neutral special cannot own the
  // same input at the same node. Reserve the projectile cancel for forward+S.
  for(const [,,segments]of routes){
    for(let i=0;i<segments.length-1;i++){
      const a=draft.moves.find(m=>m.id===segments[i]);
      a.cancelInto=[...new Set([...(a.cancelInto??[]),segments[i+1]])];
    }
  }
  // Directional special has priority over the neutral string finisher.
  draft.moves.find(m=>m.id==='jab_low_end').trigger.directions=['neutral'];
  draft.comboRoutes=[...(draft.comboRoutes??[]).filter(r=>!routes.some(([id])=>r.id===id)),...routes.map(([id,input,moves,purpose])=>({id,name:input,moves,purpose}))];
  draft.combos=[...(draft.combos??[]).filter(r=>!r.id?.startsWith('david_v2_')),...routes.map(([id,input,segments])=>({id:`david_v2_${id}`,displayName:input,segments}))];
  draft.movesetRevision='directional-strings-v2';
  draft.requireMotionCoverage=true;
  return draft;
}
