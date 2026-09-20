import test from 'node:test';
import assert from 'node:assert/strict';
import {heldGripFrame} from '../src/core/gripPlayback';
import {scenarioPositions} from '../src/testbed/scenarioLayout';

test('held grip visits the inclusive authored interval without entering recovery',()=>{
  const frames=Array.from({length:24},(_,i)=>heldGripFrame(7,11,24-i,24,20));
  assert.deepEqual([...new Set(frames)],[7,8,9,10,11]);
  assert.equal(frames[0],7);assert.equal(frames.at(-1),11);
  assert.ok(frames.every((f,i)=>i===0||f>=frames[i-1]));
});
test('grip playback clamps short holds and invalid intervals to available art',()=>{
  assert.equal(heldGripFrame(7,11,1,1,20),7);
  assert.deepEqual([3,2,1].map(remaining=>heldGripFrame(7,11,remaining,3,20)),[7,9,11]);
  assert.equal(heldGripFrame(25,30,-1,24,20),19);
  assert.equal(heldGripFrame(-1,3,200,24,20),0);
  assert.equal(heldGripFrame(7,2,1,24,20),7);
});
test('both facing and wall presets preserve spacing inside stage bounds',()=>{
  for(const layout of ['center-right','center-left','right-wall','left-wall'] as const){
    for(const gap of [40,148,420]){
      const p=scenarioPositions(layout,gap);
      assert.equal(Math.abs(p.playerX-p.dummyX),gap);
      assert.equal(Math.sign(p.dummyX-p.playerX),p.facing);
      assert.ok(p.playerX>=96&&p.playerX<=704&&p.dummyX>=96&&p.dummyX<=704);
    }
  }
});
