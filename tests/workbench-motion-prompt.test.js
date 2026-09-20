import test from 'node:test';
import assert from 'node:assert/strict';
import {workbenchMotionPrompt} from '../cms/pipeline/adapters/workbenchMotionPrompt.js';
import {withMotionReviewFeedback} from '../shared/motionReviewFeedback.js';

test('edited paint brief wins over saved recipe and retains paired-grab constraints',()=>{
  const draft={artStyle:'paint',motionPrompts:{pinch:'OLD invisible small ball'},moves:[{animation:'pinch',phases:[{events:[{event:{grab:{actorGrip:{actor:'hands'}}}}]}]}],motionRows:{pinch:{review:{decision:'changes-requested',notes:'Exactly two hands. Needle stays pinched.'}}}};
  const prompt=withMotionReviewFeedback('NEW torso-sized space between opposing palms.',draft,'pinch');
  const result=workbenchMotionPrompt({draft,row:'pinch',prompt,actorId:'hands'});
  assert.ok(result.motionPrompt.includes('NEW torso-sized space'));
  assert.ok(!result.motionPrompt.includes('OLD invisible small ball'));
  assert.ok(result.motionPrompt.includes('reference summoned entity'));
  assert.ok(result.motionPrompt.includes('Paired capture:'));
  assert.ok(result.motionPrompt.includes('engine-controlled lift and swing'));
  assert.ok(result.motionPrompt.includes('Background stays uniform white.'));
  assert.equal(result.motionPrompt.split('Exactly two hands.').length,2);
  assert.equal(result.profile.frames,20);
});

test('known video actions preserve user direction and saved recipes are fallback only',()=>{
  const custom=workbenchMotionPrompt({draft:{},row:'walk_forward',prompt:'March with high knees and wave the brush.'});
  assert.ok(custom.motionPrompt.includes('March with high knees'));
  assert.equal(custom.profile.loop,true);
  assert.equal(custom.profile.frames,24);
  const saved=workbenchMotionPrompt({draft:{artStyle:'paint',motionPrompts:{block:'Fold into an ochre diamond.'}},row:'block'});
  assert.ok(saved.motionPrompt.includes('Fold into an ochre diamond.'));
  const fallback=workbenchMotionPrompt({draft:{artStyle:'paint'},row:'walk_back'});
  assert.ok(fallback.motionPrompt.includes('No human footwork'));
});
