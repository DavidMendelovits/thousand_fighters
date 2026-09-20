import test from 'node:test';
import assert from 'node:assert/strict';
import {retimeMotion,requiredMotionRows,assertMotionCoverage} from '../cms/pipeline/motionRowArtifacts.js';
import {CharacterCreationPipeline} from '../cms/pipeline/CharacterCreationPipeline.js';
import {PipelinePort} from '../cms/pipeline/ports.js';
import {motionProfile} from '../cms/pipeline/motionProfiles.js';

test('paint locomotion uses material motion while preserving runtime frame and loop contracts',()=>{
  const paint=motionProfile('walk_forward','',{artStyle:'paint'}),human=motionProfile('walk_forward');
  assert.match(paint.prompt,/forward-flow/);assert.match(human.prompt,/heel contact/);
  assert.equal(paint.frames,human.frames);assert.equal(paint.loop,true);
  assert.match(motionProfile('crouch','',{artStyle:'paint'}).prompt,/puddle and HOLD/);
  assert.match(motionProfile('ribbon_lash','Long reaching ribbon',{artStyle:'paint'}).prompt,/Long reaching ribbon/);
});

test('motion retiming preserves collision ticks and puts contact at active start',()=>{
  const move={phases:[{frames:7},{frames:3},{frames:13}]};
  const original=structuredClone(move);
  const timeline=retimeMotion(move,20,9);
  const frames=timeline.flatMap(entry=>Array(entry.duration).fill(entry.frame));
  assert.equal(frames.length,23);
  assert.equal(frames[7],9);
  assert.ok(frames.every(frame=>frame>=0&&frame<20));
  assert.deepEqual(move,original);
  const reviewed=retimeMotion(move,24,10,20).flatMap(entry=>Array(entry.duration).fill(entry.frame));
  assert.equal(reviewed[7],10);
  assert.equal(reviewed[10],20);
  assert.equal(reviewed.length,23);
});
test('coverage includes custom moves, rejects pending review, retains legacy compatibility',()=>{
  const draft={requireMotionCoverage:true,moves:[{animation:'ink'},{animation:'ink'}],motionRows:{}};
  assert.equal(requiredMotionRows(draft).filter(row=>row==='ink').length,1);
  assert.throws(()=>assertMotionCoverage(draft),/Incomplete motion pack/);
  for(const row of requiredMotionRows(draft))draft.motionRows[row]={status:'approved',uniqueFrames:12};
  assert.doesNotThrow(()=>assertMotionCoverage(draft));
  draft.motionRows.ink.status='needs-visual-review';
  assert.throws(()=>assertMotionCoverage(draft),/ink/);
  assert.doesNotThrow(()=>assertMotionCoverage({moves:[]}));
});
test('publishing rejects incomplete motion before any release side effect',async()=>{
  let published=false;
  const pipeline=new CharacterCreationPipeline({resolve(port){
    if(port===PipelinePort.CHARACTER_REPOSITORY)return {getDraft:async()=>({requireMotionCoverage:true,moves:[]})};
    if(port===PipelinePort.PUBLISHER)return {publishCharacter:async()=>{published=true;}};
    throw new Error(port);
  }});
  await assert.rejects(pipeline.publishCharacter({characterId:'test'}),/Incomplete motion pack/);
  assert.equal(published,false);
});
