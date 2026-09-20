import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDavidWatercolor} from '../shared/davidWatercolor.js';
import {characterArtDirection} from '../cms/pipeline/adapters/pixelArtDirection.js';

test('watercolor medium replaces pixel restrictions only when explicitly selected',()=>{
  assert.match(characterArtDirection('watercolor'),/translucent pigment/);
  assert.doesNotMatch(characterArtDirection('watercolor'),/NO.*gradients/);
  assert.match(characterArtDirection(undefined),/16-bit/);
});
test('paint revision keeps gameplay timing, trajectories and finite grab rules',()=>{
  const projectile={id:'ink_construct',animation:'david_ink',visual:{kind:'ink-fist',color:1,accent:2},impact:{id:'ink_impact',kind:'ink',durationTicks:18,radius:30},velocity:{x:7,y:0},hitbox:{damage:58}};
  const draft={moves:[{id:'mic_reel',extension:{kind:'mic-cable'},phases:[{frames:13,events:[{onFrame:0,event:{type:'grab_check',grab:{holdDuration:22,pullFrames:16,groundOnly:true}}}]}],cancelInto:['cascade']},{id:'ink_construct',phases:[{frames:9,events:[{onFrame:0,event:{type:'spawn_projectile',projectile}}]}]}]};
  const before=structuredClone(draft);
  applyDavidWatercolor(draft);
  assert.deepEqual(draft.moves[0].phases,before.moves[0].phases);
  assert.deepEqual(draft.moves[0].cancelInto,before.moves[0].cancelInto);
  assert.equal(draft.moves[0].extension.kind,'paint-ribbon');
  const p=draft.moves[1].phases[0].events[0].event.projectile;
  assert.equal(p.visual.kind,'paint-fist');assert.equal(p.impact.kind,'watercolor');
  assert.deepEqual(p.velocity,projectile.velocity);assert.equal(draft.requireMotionCoverage,true);
  applyDavidWatercolor(draft);assert.equal(p.animation,'david_ink_watercolor');
});
