import {test} from 'node:test';
import assert from 'node:assert/strict';
import {patchMove} from '../admin/moveInspector.js';
import {motionMarkers} from '../admin/motionTiming.js';
import {activeSpriteAssets} from '../admin/activeSpriteAssets.js';

const fixture=()=>({sprite:{frames:{pinch:Array.from({length:20},(_,i)=>({file:`sprites/pinch/pinch_${i}.png`}))}},motionRows:{pinch:{status:'approved'}},moves:[{id:'pinch',animation:'pinch',phases:[{name:'startup',frames:11,events:[]},{name:'active',frames:5,events:[]},{name:'recovery',frames:30,events:[]}]}]});
test('reviewed contact and recovery poses align with gameplay without changing collision ticks',()=>{
  const draft=fixture(),next=patchMove(draft,'pinch',{motion:{contactFrame:4,recoveryFrame:7}}),move=next.moves[0];
  assert.deepEqual(motionMarkers(move),{contactFrame:4,recoveryFrame:7});
  assert.deepEqual(move.phases,draft.moves[0].phases);
  assert.equal(move.visualTimeline.reduce((n,f)=>n+f.duration,0),46);
  assert.equal(next.motionRows.pinch.status,'needs-visual-review');
  assert.equal(draft.motionRows.pinch.status,'approved');
  for(const motion of [{contactFrame:0,recoveryFrame:7},{contactFrame:4,recoveryFrame:4},{contactFrame:4,recoveryFrame:20},{contactFrame:1.5,recoveryFrame:7}])assert.throws(()=>patchMove(draft,'pinch',{motion}),/Contact/);
});
test('current thumbnails omit superseded poses but leave source and legacy assets available',()=>{
  const assets=['sprites/pinch/pinch_0.png','sprites/pinch/pinch_19.png','sprites/pinch/pinch_20.png','sprites/legacy/legacy_0.png','sheets/pinch.png','projectiles/needle.png'].map(relativePath=>({relativePath:`pack/${relativePath}`,key:`characters/paint/assets/pack/${relativePath}`}));
  assert.deepEqual(activeSpriteAssets(fixture(),assets),assets.filter((_,i)=>i!==2));
  const draft=fixture();draft.sprite.frames.pinch=[];
  assert.deepEqual(activeSpriteAssets(draft,assets),assets.slice(3));
  draft.actors=[{id:'echo',sprite:{frames:{pinch:[{file:'sprites/pinch/pinch_20.png'}]}}}];
  assert.deepEqual(activeSpriteAssets(draft,assets),assets.slice(2));
});
