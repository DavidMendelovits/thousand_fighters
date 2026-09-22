import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ControlTelemetry} from '../src/core/ControlTelemetry';
import {timedStateRowFrame,resolveStateSheet} from '../src/core/animationRowPlayback';
import {patchMove,frameAdvantage} from '../admin/moveInspector.js';
import {validateCombatRules} from '../cms/export/validateCombatRules.js';
import {convertDraftToCharacterConfig} from '../cms/export/convertDraftToCharacterConfig.js';
import {FighterPackQaAdapter} from '../cms/pipeline/adapters/fighterPackQaAdapter.js';
import {composeSpriteSheetWithFfmpeg} from '../cms/pipeline/adapters/minimaxH3SpriteSheetGeneratorAdapter.js';
import {isRejectedSubmission} from '../cms/pipeline/adapters/workbenchVideoRow.js';

const fixture=()=>({id:'test',moves:[{id:'jab',animation:'punch',trigger:{sequence:['lp']},visualTimeline:[{frame:0,duration:4},{frame:1,duration:2},{frame:2,duration:10}],phases:[{name:'startup',frames:4,events:[]},{name:'active',frames:2,events:[{onFrame:0,event:{type:'hitbox_active',hitbox:{x:0,y:-20,width:20,height:20,damage:20,hitstun:12,stun:6,blockstun:6,knockback:{x:2,y:0}}}}]},{name:'recovery',frames:10,events:[]}]},{id:'kick',animation:'kick',phases:[],trigger:{sequence:['lk']}}]});
test('control telemetry counts exclusive buckets, contiguous locks, reset and snapshots',()=>{
  const t=new ControlTelemetry();
  for(let i=0;i<6;i++)t.record(['idle','stunned']);
  t.record(['attack','stunned'],true);t.record(['attack','idle']);
  const s=t.snapshot();assert.equal(s.totalTicks,8);assert.equal(s.players[1].ticks.stun,6);assert.equal(s.players[1].ticks.hitstop,1);assert.equal(s.players[1].longestLockMs,117);assert.equal(s.players[1].lockedPercent,87.5);
  for(const p of s.players)assert.equal(Object.values(p.ticks).reduce((a,b)=>a+b,0),8);
  s.players[1].ticks.stun=999;assert.equal(t.snapshot().players[1].ticks.stun,6);
  t.reset();assert.equal(t.snapshot().totalTicks,0);assert.equal(t.snapshot().players[1].longestLockMs,0);
});
test('six-tick reactions reach every pose and return to legacy fallback without a row',()=>{
  assert.deepEqual(Array.from({length:6},(_,i)=>timedStateRowFrame(i,6,6)),[0,1,2,3,4,5]);
  assert.equal(timedStateRowFrame(24,6,25),5);assert.equal(resolveStateSheet('stunned',()=>true),'hurt');assert.equal(resolveStateSheet('stunned',()=>false),'base');
});
test('editor retimes visual poses, validates scheduled events and does not mutate input',()=>{
  const d=fixture(),next=patchMove(d,'jab',{phases:[6,3,15],contact:{index:0,stun:6,hitstop:0},meter:12});
  assert.equal(next.moves[0].visualTimeline.reduce((n,p)=>n+p.duration,0),24);assert.equal(d.moves[0].phases[0].frames,4);
  assert.deepEqual(next.moves[0].visualTimeline.map(f=>f.duration),[6,3,15]);
  assert.equal(next.moves[0].cost.meter,12);
  d.moves[0].phases[1].events[0].onFrame=1;
  assert.throws(()=>patchMove(d,'jab',{phases:[4,1,10]}),/cut off/);
  assert.throws(()=>patchMove(d,'jab',{contact:{index:0,damage:null}}),/required/);
  assert.throws(()=>patchMove(d,'jab',{cancelInto:['missing']}),/existing moves/);
});
test('video reach uses reference calibration while legacy scale drift still fails QA',()=>{
  const qa=new FighterPackQaAdapter({}),frames={base:[{silhouetteHeight:100}],block:[{silhouetteHeight:200,normalizationMode:'video-uniform',normalizationReferenceHeight:100}]};
  assert.equal(qa._checkFrameHeightConsistency({frames}).status,'pass');
  delete frames.block[0].normalizationMode;assert.equal(qa._checkFrameHeightConsistency({frames}).status,'error');
});
test('saved-video resampling rejects unsafe or incomplete timestamps before ffmpeg',async()=>{
  for(const sampleTimes of [[1,2,3,4,4.5,4.9],[0,1,2,3,4,5],[0,1,1,2,3,4],[0,1]])await assert.rejects(composeSpriteSheetWithFfmpeg({sampleTimes,duration:5}),/six increasing/);
});
test('explicit regenerate may replace a balance rejection but never an uncertain accepted task',()=>{
  assert.equal(isRejectedSubmission({lastError:{statusCode:403}}),true);
  assert.equal(isRejectedSubmission({task:{requestId:'already-paid'},lastError:{statusCode:403}}),false);
  assert.equal(isRejectedSubmission({lastError:{statusCode:500}}),false);
  assert.equal(isRejectedSubmission({lastError:{statusCode:null}}),false);
});
test('grab tuning owns hold/pull/release and rejects pull longer than capture',()=>{
  const d=fixture();d.moves[0].phases[1].events=[{onFrame:0,event:{type:'grab_check',grab:{holdDuration:20,pullFrames:10,releaseHitstun:8}}}];
  const n=patchMove(d,'jab',{grab:{index:0,holdDuration:14,pullFrames:5,releaseHitstun:6}});
  assert.equal(n.moves[0].phases[1].events[0].event.grab.holdDuration,14);
  assert.throws(()=>patchMove(d,'jab',{grab:{index:0,holdDuration:5}}),/exceed/);
});
test('frame advantage uses explicit stun override and remaining recovery',()=>{
  const a=frameAdvantage(fixture().moves[0]);assert.equal(a.hit,-5);assert.equal(a.block,-5);
});
test('independent effect validates, survives export, replaces itself and changes no hitbox',()=>{
  const d=fixture(),effect={kind:'spark',color:0xffbb44,accent:0xffffff,radius:32,durationTicks:10,x:40,y:-50,attached:true};
  const a=patchMove(d,'jab',{effect}),b=patchMove(a,'jab',{effect:{...effect,radius:60}});
  const events=b.moves[0].phases.flatMap(p=>p.events).filter(e=>e.event.type==='spawn_effect');assert.equal(events.length,1);
  assert.deepEqual(b.moves[0].phases[1].events[0],d.moves[0].phases[1].events[0]);
  const out=convertDraftToCharacterConfig({draft:b});assert.equal(out.moves[0].phases[1].events[1].event.effect.radius,60);
  assert.doesNotThrow(()=>validateCombatRules(b));events[0].event.effect.radius=Infinity;assert.throws(()=>validateCombatRules(b),/radius/);
});
test('imported author-owned geometry and move extensions survive extraction/export',()=>{
  const d={...fixture(),geometryMode:'authored-runtime',hurtboxes:{idle:{x:-20,y:-100,width:40,height:100}},sprite:{scale:1,scaleMode:'authored-reference'},rosterGroup:'oddities'};
  d.moves[0].extension={kind:'tentacle',color:123,accent:345,thickness:7};d.moves[0].airOk=true;
  const c=convertDraftToCharacterConfig({draft:d,frameData:{frames:{base:[{silhouetteHeight:300}],punch:[{attackBox:{x:99,y:99,width:999,height:999}}]}}});
  assert.equal(c.sprite.scale,1);assert.deepEqual(c.hurtboxes.idle,d.hurtboxes.idle);assert.equal(c.moves[0].phases[1].events[0].event.hitbox.width,20);assert.deepEqual(c.moves[0].extension,d.moves[0].extension);assert.equal(c.moves[0].airOk,true);
});
test('move inspector extension authoring validates and exports a removable reach',()=>{
  const draft=fixture();
  const extension={kind:'ribbon',color:0x31546c,accent:0xa9e8df,thickness:11};
  const saved=patchMove(draft,'jab',{extension});
  assert.deepEqual(saved.moves[0].extension,extension);
  assert.deepEqual(convertDraftToCharacterConfig({draft:saved}).moves[0].extension,extension);
  assert.equal(patchMove(saved,'jab',{extension:null}).moves[0].extension,undefined);
  assert.throws(()=>patchMove(draft,'jab',{extension:{...extension,thickness:0}}),/thickness/);
});
