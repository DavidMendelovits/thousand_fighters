import type {CharacterConfig,Move,MoveEvent,InputToken,Hitbox} from '../schema/types';
const hit=(patch:Partial<Hitbox>={}):Hitbox=>({x:22,y:-88,width:66,height:38,damage:34,hitstun:12,blockstun:7,hitstop:3,knockback:{x:2,y:0},level:'mid',impact:{id:'pigment-contact',kind:'watercolor',color:0xcb432f,accent:0xbba0d6,radius:24,durationTicks:14},...patch});
function move(id:string,name:string,button:InputToken,timing:[number,number,number],events:MoveEvent[],description:string,directions?:InputToken[]):Move{
 return {id,displayName:name,animation:id,requiredAnimation:id,artStatus:'ready',description,
 trigger:{allowedStates:['idle','walk_forward','walk_back','crouch','block','landing'],sequence:[button],directions,window:10},
 phases:[{name:'startup',frames:timing[0],events:[{onFrame:0,event:{type:'set_velocity',vx:0}}]},
 {name:'active',frames:timing[1],events:events.map(event=>({onFrame:0,event}))},
 {name:'recovery',frames:timing[2],events:[{onFrame:0,event:{type:'hitbox_end'}},{onFrame:0,event:{type:'grab_end'}}]}]};
}
export function createPalimpsest():CharacterConfig{
 const jab=move('ribbon_jab','Ribbon Flick','lp',[6,4,12],[{type:'hitbox_active',hitbox:hit()}],'A thin pigment ribbon snaps forward. Confirm into Undertow or Impasto.');
 const low=move('undertow','Undertow','lk',[10,5,19],[{type:'hitbox_active',hitbox:hit({y:-25,height:25,width:92,damage:42,level:'low',knockback:{x:4,y:0}})}],'A low paint ribbon sweeps beneath standing guard.');
 const rise=move('rising_ochre','Rising Ochre','lp',[11,6,24],[{type:'hitbox_active',hitbox:hit({y:-142,height:110,width:64,damage:55,launches:true,knockback:{x:3,y:-8},hitstun:22})}],'Down + light: a rising paint crescent catches aerial approaches.',['down','down-forward','down-back']);
 const heavy=move('impasto','Impasto','hp',[15,7,26],[{type:'hitbox_active',hitbox:hit({width:106,damage:65,knockback:{x:8,y:-3},launches:true,hitstun:20})}],'Heavy: the entire spiral uncoils into a forceful wave.');
 const bind=move('bind','Wet Binding','grab',[15,21,27],[{type:'grab_check',grab:{hitbox:{x:25,y:-90,width:35,height:45},damage:55,holdOffsetX:60,holdDuration:18,pullFrames:12,releaseKnockback:{x:5,y:-3},releaseHitstun:12,releaseLaunches:true,groundOnly:true},keyframes:[{atFrame:0,x:25},{atFrame:12,x:160},{atFrame:20,x:25}]}],'Light + medium: an extending paint loop catches and reels in grounded opponents. Jump to evade.');
 bind.extension={kind:'paint-ribbon',color:0xa68cca,accent:0xf2b44a,thickness:7};
 const summon=move('summon','Borrowed Hands','hp',[18,1,15],[{type:'summon_control',actor:'hands',duration:240,speed:4.1,offsetX:85,offsetY:-35}],'Down + heavy: spend 30 pigment to control floating needle-hands for four seconds. Body remains vulnerable; a hit dismisses them.',['down','down-forward','down-back']);summon.cost={meter:30};
 const needle=move('needle_thrust','Needle Stitch','lp',[7,5,13],[{type:'hitbox_active',actor:'hands',hitbox:hit({x:10,y:-72,width:74,height:35,damage:28,hitstun:10,knockback:{x:2,y:0}})}],'Hands light: a precise needle thrust.');needle.controlledActor='hands';
 const pinch=move('hands_pinch','Pigment Pinch','lk',[11,5,30],[{type:'grab_check',actor:'hands',grab:{hitbox:{x:-10,y:-76,width:70,height:65},damage:40,holdOffsetX:0,holdDuration:24,actorGrip:{actor:'hands',socketX:0,socketY:-48,lift:36,swing:16},releaseKnockback:{x:5,y:-3},releaseHitstun:10,releaseLaunches:true,groundOnly:false}}],'Hands medium: opposing palms close around the torso, lift and swing the opponent, then throw.');pinch.controlledActor='hands';
 const recall=move('hands_recall','Return to Canvas','hp',[5,1,6],[{type:'recall_summon'}],'Hands heavy: dismiss early and regain body control.');recall.controlledActor='hands';
 jab.cancelInto=['undertow','impasto'];jab.cancelOn='hit';jab.phases[2].cancellable=true;
 low.cancelInto=['impasto'];low.cancelOn='hit';low.phases[2].cancellable=true;
 const moves=[rise,summon,bind,jab,low,heavy,needle,pinch,recall];
 const labels:Record<string,string>={ribbon_jab:'F',undertow:'G',rising_ochre:'↓ + F',impasto:'H',bind:'F + G',summon:'↓ + H',needle_thrust:'Hands: F',hands_pinch:'Hands: G',hands_recall:'Hands: H'};
 for(const m of moves)m.inputLabel=labels[m.id];
 return {id:'palimpsest',displayName:'Palimpsest',selectable:true,rosterGroup:'oddities',walkForwardSpeed:3,walkBackSpeed:2,jumpVelocity:10.5,jumpForwardVelocity:3.4,jumpBackVelocity:2.8,gravity:.5,maxFallSpeed:12,maxHealth:950,pivotOffsetY:0,pushboxWidth:42,
 poseStyle:'fluid',hurtboxes:{idle:{x:-27,y:-105,width:54,height:105},crouch:{x:-35,y:-52,width:70,height:52}},animations:{idle:'idle',hitstun:'hurt',attack:'ribbon_jab',dead:'crouch',knockdown:'crouch'},
 stats:{attack:1,defense:.95,speed:1,weight:.9,projectileAttack:1,projectileDefense:1,size:1},moves,
 comboRoutes:[{name:'Wet into wet',moves:['ribbon_jab','undertow','impasto'],purpose:'A light confirm flows through a low sweep into heavy pushback.'}],
 concept:{role:'Living-paint puppet fighter',biography:'A spiral of crimson, lavender and ochre pigment, animated by currents rather than joints. It borrows a pair of needle-bearing painted hands to reach beyond its own canvas.',accent:'#bca0d6',tags:['LIQUID LIMBS','CONTROLLED SUMMON','PAINT TETHER'],counterplay:'Jump Wet Binding. Punish Impasto recovery. During Borrowed Hands the core cannot move or guard; strike either core or hands to dismiss the summon.',artStatus:'BFL reference paintings; Pruna video-derived motion. Separate controllable hands actor.'}};
}
