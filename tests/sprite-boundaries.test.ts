import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateSpriteBoundaries} from '../cms/export/validateSpriteBoundaries.js';
import {convertDraftToCharacterConfig} from '../cms/export/convertDraftToCharacterConfig.js';
import {validateCombatRules} from '../cms/export/validateCombatRules.js';
import {createLocalPublisher} from '../cms/pipeline/adapters/localAdapters.js';

test('export rejects padded frames whose original source was clipped',()=>{
  const frameData={frames:{base:[{file:'base.png',width:128,height:128,anchor:{x:64,y:120},silhouetteHeight:100,sourceClipped:true}]}};
  assert.throws(()=>validateSpriteBoundaries(frameData),/Source clipping/);
  assert.throws(()=>convertDraftToCharacterConfig({draft:{id:'test',moves:[]},frameData}),/Source clipping/);
  frameData.frames.base[0].sourceClipped=false;
  assert.doesNotThrow(()=>validateSpriteBoundaries(frameData));
});

test('stale passing QA and force cannot publish newly detected missing source pixels',async()=>{
  let wrote=false;
  const publisher=createLocalPublisher({storage:{exists:async()=>true,getJson:async()=>({frames:{punch:[{file:'punch.png',sourceClipped:true}]}})},repository:{getLatestQaReport:async()=>({status:'pass'}),createVersion:async()=>{wrote=true;}}});
  await assert.rejects(publisher.publishCharacter({characterId:'test'}),/Source clipping/);
  await assert.rejects(publisher.publishCharacter({characterId:'test',force:true}),/Source clipping/);
  assert.equal(wrote,false);
});

test('authored height scales measured art and collision boxes together without changing frame pixels',()=>{
  const frame={file:'base.png',width:128,height:128,anchor:{x:64,y:120},silhouetteHeight:100,hurtbox:{x:-20,y:-90,width:40,height:90}};
  const frameData={frames:{base:[frame]}};
  const base=convertDraftToCharacterConfig({draft:{id:'test',moves:[],sprite:{relativeHeight:1}},frameData});
  const tall=convertDraftToCharacterConfig({draft:{id:'test',moves:[],sprite:{relativeHeight:1.5}},frameData});
  assert.ok(Math.abs(tall.sprite.scale/base.sprite.scale-1.5)<1e-8);
  assert.ok(tall.hurtboxes.idle.height>base.hurtboxes.idle.height);
  assert.deepEqual(tall.sprite.frames,base.sprite.frames);
});

test('authoring rejects invalid size and reaction timers but accepts a six-tick interrupt',()=>{
  assert.throws(()=>validateCombatRules({sprite:{relativeHeight:Infinity}}),/relativeHeight/);
  assert.throws(()=>validateCombatRules({moves:[{phases:[{events:[{event:{hitbox:{stun:-1}}}]}]}]}),/stun/);
  assert.doesNotThrow(()=>validateCombatRules({moves:[{phases:[{events:[{event:{hitbox:{stun:6,hitstop:0}}}]}]}]}));
});

test('melee export preserves authored interrupt, pause, knockdown and launch stats',()=>{
  const draft={id:'test',moves:[{id:'tap',animation:'punch',trigger:{sequence:['lp']},phases:[{name:'active',frames:1,events:[{onFrame:0,event:{type:'hitbox_active',hitbox:{x:0,y:-20,width:20,height:20,damage:10,hitstun:18,stun:6,hitstop:0,launches:true,knockdown:true}}}]}]}]};
  const config=convertDraftToCharacterConfig({draft});
  const hitbox=config.moves[0].phases[0].events[0].event.hitbox;
  assert.equal(hitbox.stun,6);assert.equal(hitbox.hitstop,0);assert.equal(hitbox.hitstun,18);
  assert.equal(hitbox.launches,true);assert.equal(hitbox.knockdown,true);
});
