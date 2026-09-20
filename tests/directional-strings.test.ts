import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {InputBuffer} from '../src/core/InputBuffer';
import {MoveExecutor} from '../src/core/MoveExecutor';
import {selectTriggeredMove} from '../src/core/moveSelection';
import {expandDavidMoveset} from '../cms/content/davidMoveset.js';
import {convertDraftToCharacterConfig} from '../cms/export/convertDraftToCharacterConfig.js';
import {assertMotionCoverage} from '../cms/pipeline/motionRowArtifacts.js';
const draft=expandDavidMoveset(JSON.parse(readFileSync('cms-data/characters/david/draft/content.json','utf8')));
const config=convertDraftToCharacterConfig({draft,frameData:null,manifest:null});
const raw=(values={})=>({left:false,right:false,up:false,down:false,lp:false,mp:false,hp:false,lk:false,mk:false,hk:false,lpPrev:false,mpPrev:false,hpPrev:false,lkPrev:false,mkPrev:false,hkPrev:false,...values});
function fighter(){return {inputBuffer:new InputBuffer(),meter:100,grounded:true,state:'idle',currentMove:null,activeHitboxes:new Map(),activeGrabs:new Map(),hasHitThisMove:new Set(),changeState(s){this.state=s;}} as any;}
function select(f:any,cancel=false){return selectTriggeredMove(config.moves,f.inputBuffer,f,cancel);}
test('direction is captured at button press, mirrored by facing, with diagonal uppercut',()=>{
  for(const [keys,facing,id] of [[{},1,'punch'],[{right:true},1,'forward_jab'],[{left:true},-1,'forward_jab'],[{left:true},1,'back_jab'],[{down:true},1,'down_jab'],[{down:true,right:true},1,'uppercut']] as any[]){
    const f=fighter();f.inputBuffer.record(raw({right:true}),1);f.inputBuffer.record(raw({...keys,lp:true}),facing);assert.equal(select(f)?.id,id);
  }
});
test('early J J K survives consumption and cannot cancel the first active hit away',()=>{
  const f=fighter();f.inputBuffer.record(raw({lp:true}),1);MoveExecutor.start(f,select(f)!);
  f.inputBuffer.record(raw(),1);f.inputBuffer.record(raw({lp:true}),1);f.inputBuffer.record(raw(),1);f.inputBuffer.record(raw({lk:true,mp:true}),1);
  const second=select(f,true)!;assert.equal(second.id,'jab_second');
  f.movePhaseIndex=1;assert.equal(MoveExecutor.tryCancel(f,second),false);
  f.movePhaseIndex=2;assert.equal(MoveExecutor.tryCancel(f,second),true);
  assert.equal(select(f,true)?.id,'jab_kick_end');
  f.movePhaseIndex=2;MoveExecutor.tryCancel(f,select(f,true)!);assert.equal(f.currentMove.id,'jab_kick_end');assert.equal(select(f,true),null);
});
test('continuations are unavailable from neutral and expire',()=>{
  const f=fighter();f.inputBuffer.record(raw({lp:true}),1);assert.equal(select(f)?.id,'punch');
  f.currentMove=config.moves.find(m=>m.id==='punch');f.state='attack';
  for(let i=0;i<25;i++)f.inputBuffer.record(raw(),1);assert.equal(select(f,true),null);
});
test('string direction branch does not shadow the hit-confirm special',()=>{
  const f=fighter();f.currentMove=config.moves.find(m=>m.id==='jab_second');f.state='attack';f.hitThisMove=true;
  f.inputBuffer.record(raw({right:true,hp:true}),1);assert.equal(select(f,true)?.id,'sound_wave');
});
test('expansion is repeatable, keeps approved art, and cannot publish proxy artwork',()=>{
  assert.equal(draft.moves.length,27);assert.equal(expandDavidMoveset(draft).moves.length,27);
  assert.equal(expandDavidMoveset(draft).comboRoutes.length,draft.comboRoutes.length);
  assert.ok(Object.values(draft.motionRows).filter((r:any)=>r.status==='approved').length>=15);
  const pending=structuredClone(draft);pending.moves.find(m=>m.id==='forward_jab').artStatus='proxy';
  assert.throws(()=>assertMotionCoverage(pending),/Incomplete motion pack|Proxy move artwork/);
  for(const move of draft.moves.filter(m=>m.artStatus==='ready'))assert.equal(expandDavidMoveset(draft).moves.find(m=>m.id===move.id).artStatus,'ready');
});
