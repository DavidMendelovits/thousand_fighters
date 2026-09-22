import test from 'node:test';
import assert from 'node:assert/strict';
import {workbenchMotionPrompt} from '../cms/pipeline/adapters/workbenchMotionPrompt.js';

test('independent actor idle is a one-subject loop even for custom row names',()=>{
  const draft={artStyle:'pixel',actors:[{id:'surveyor',idleAnimation:'surveyor_idle_orbit',description:'small lantern orb'}],moves:[]};
  const result=workbenchMotionPrompt({draft,row:'surveyor_idle_orbit',actorId:'surveyor',prompt:'Create the surveyor idle orbit.'});
  assert.equal(result.profile.loop,true);
  assert.match(result.motionPrompt,/exactly ONE small lantern orb/);
  assert.match(result.motionPrompt,/Never split, duplicate/);
  assert.match(result.motionPrompt,/IDLE LOOP ONLY/);
});
test('attached reach motion keeps the full extension out of body video',()=>{
  const draft={artStyle:'pixel',moves:[{id:'lasso',animation:'lasso',extension:{kind:'ribbon',color:1,accent:2,thickness:8}}]};
  const result=workbenchMotionPrompt({draft,row:'lasso',prompt:'Cast a long lasso.'});
  assert.match(result.motionPrompt,/ATTACHED REACH IS RENDERED BY THE GAME ENGINE/);
  assert.match(result.motionPrompt,/Do not paint the long ribbon/);
});
