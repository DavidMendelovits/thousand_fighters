import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareDraftPreview} from '../cms/export/prepareDraftPreview.js';

test('draft playtest proxies missing body and summon rows without mutating source assets',()=>{
  const base=[{file:'sprites/base/base_001.png'}],summon=[{file:'sprites/orb/orb_001.png'}];
  const frameData={frames:{base,surveyor_idle_orbit:summon}};
  const draft={actors:[{id:'surveyor',idleAnimation:'surveyor_idle_orbit'}],moves:[{id:'slash',animation:'ribbon_lash'},{id:'cut',animation:'surveyor_cut',controlledActor:'surveyor'}]};
  const result=prepareDraftPreview({draft,frameData,manifest:{frameCounts:{base:1,surveyor_idle_orbit:1}}});
  assert.deepEqual(result.frameData.frames.ribbon_lash,base);
  assert.deepEqual(result.frameData.frames.surveyor_cut,summon);
  assert.ok(result.fallbackRows.some(item=>item.row==='surveyor_cut'&&item.source==='surveyor_idle_orbit'));
  assert.equal(frameData.frames.ribbon_lash,undefined);
  assert.equal(result.manifest.frameCounts.surveyor_cut,1);
});

test('draft playtest refuses to substitute the body for a missing summon identity',()=>{
  assert.throws(()=>prepareDraftPreview({draft:{actors:[{id:'orb',idleAnimation:'orb_idle'}],moves:[{animation:'orb_cut',controlledActor:'orb'}]},frameData:{frames:{base:[{file:'base.png'}]}}}),/isolated orb reference/);
});
