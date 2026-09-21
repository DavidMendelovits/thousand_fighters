import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CharacterCreationPipeline} from '../cms/pipeline/CharacterCreationPipeline.js';
import {PipelinePort} from '../cms/pipeline/ports.js';
import {convertDraftToCharacterConfig} from '../cms/export/convertDraftToCharacterConfig.js';
import {InputBuffer} from '../src/core/InputBuffer';
import {selectTriggeredMove} from '../src/core/moveSelection';

const phases=(damage=20)=>[
  {name:'startup',frames:2,events:[]},
  {name:'active',frames:2,events:[{frame:0,event:{type:'hitbox_active',hitbox:{x:20,y:-70,width:45,height:30,damage,hitstun:18,blockstun:8,knockback:{x:2,y:0}}}}]},
  {name:'recovery',frames:7,events:[]},
];
const generated=(name:string,button:string,damage:number)=>({
  id:'model_id_is_not_the_contract',displayName:name,description:`Exclusive ${name} follow-up`,animation:'model_cannot_choose_this',controlledActor:null,
  trigger:{sequence:[button],directions:null},phases:phases(damage),
});
const neutral=(button='lk')=>({left:false,right:false,up:false,down:false,lp:false,mp:false,hp:false,lk:button==='lk',mk:button==='mk',hk:false,lpPrev:false,mpPrev:false,hpPrev:false,lkPrev:false,mkPrev:false,hkPrev:false});

test('authored combo creates stable custom rows and cancel-only runtime moves',async()=>{
  let draft:any={id:'paint',displayName:'Paint',description:'Fluid paint fighter',stats:{},sprite:{scale:1,frameCounts:{}},moves:[{
    id:'jab',displayName:'Jab',description:'Opener',animation:'jab',trigger:{sequence:['lp']},phases:phases(),
  }],combos:[]};
  const modelMoves=[generated('Split Current','lk',28),generated('Flood Crown','hp',44)];
  const pipeline=new CharacterCreationPipeline({resolve(port:string){
    if(port===PipelinePort.TEXT_MODEL)return {completeStructured:async()=>({value:{moves:modelMoves},provider:'test'})};
    if(port===PipelinePort.CHARACTER_REPOSITORY)return {getDraft:async()=>structuredClone(draft),saveDraft:async(_id:string,next:any)=>{draft=structuredClone(next);return draft;}};
    throw new Error(port);
  }} as any);

  const result=await pipeline.authorCombo({characterId:'paint',comboId:'wet_finish',segments:[{moveId:'jab'},{description:'split into crossing ribbons'},{description:'collapse into an upward paint crown'}],generateSprites:false});
  assert.deepEqual(result.combo.segments,['jab','combo_wet_finish_2','combo_wet_finish_3']);
  assert.deepEqual(result.combo.ownedMoveIds,['combo_wet_finish_2','combo_wet_finish_3']);
  const [link,ender]=draft.moves.slice(1);
  assert.equal(link.animation,'combo_wet_finish_2');
  assert.equal(ender.animation,'combo_wet_finish_3');
  assert.equal(link.category,'string');
  assert.equal(link.trigger.cancelOnly,true);
  assert.deepEqual(link.trigger.cancelFrom,['jab']);
  assert.deepEqual(ender.trigger.cancelFrom,['combo_wet_finish_2']);
  assert.equal(link.artStatus,'proxy');

  const runtime:any=convertDraftToCharacterConfig({draft,frameData:null,manifest:null});
  const opener=runtime.moves.find((move:any)=>move.id==='jab');
  const follow=runtime.moves.find((move:any)=>move.id==='combo_wet_finish_2');
  assert.ok(opener.cancelInto.includes(follow.id));
  const idleBuffer=new InputBuffer();idleBuffer.record(neutral('lk'),1);
  assert.equal(selectTriggeredMove(runtime.moves,idleBuffer,{state:'idle',grounded:true,currentMove:null},false),null,'combo-only link must not fire from neutral');
  const cancelBuffer=new InputBuffer();cancelBuffer.record(neutral('lk'),1);
  assert.equal(selectTriggeredMove(runtime.moves,cancelBuffer,{state:'attack',grounded:true,currentMove:opener,hitThisMove:true},true)?.id,follow.id);

  await pipeline.authorCombo({characterId:'paint',comboId:'wet_finish',segments:[{moveId:'jab'},{description:'revised crossing ribbons'},{description:'revised paint crown'}],generateSprites:false});
  assert.equal(draft.moves.filter((move:any)=>move.comboOwner==='wet_finish').length,2,'re-authoring replaces owned moves');
  assert.deepEqual(draft.moves.filter((move:any)=>move.comboOwner==='wet_finish').map((move:any)=>move.animation),['combo_wet_finish_2','combo_wet_finish_3']);
});
