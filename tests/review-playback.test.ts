import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {reviewPlayback} from '../cms/authoring/reviewPlayback.js';
import {moveVisualFrameAt} from '../shared/moveVisualFrame.js';
import {requiredMotionRows} from '../cms/pipeline/motionRowArtifacts.js';
import {withMotionReviewFeedback} from '../shared/motionReviewFeedback.js';

const frames=Array.from({length:24},()=>({durationFrames:3}));
const sequenceTicks=timing=>timing.sequence.flatMap(p=>Array(p.duration).fill(p.index));

test('review corrections reach retries once and disappear after explicit approval',()=>{
  const draft={motionRows:{hands:{review:{decision:'changes-requested',notes:'Exactly two hands; needle stays pinched.'}}}};
  const prompt=withMotionReviewFeedback('Open, clasp and release.',draft,'hands');
  assert.ok(prompt.includes('Exactly two hands'));
  assert.equal(withMotionReviewFeedback(prompt,draft,'hands'),prompt);
  assert.equal(withMotionReviewFeedback('Original.',{motionRows:{hands:{review:{notes:'approved'}}}},'hands'),'Original.');
});

test('review matches runtime on every tick, preserving repeats, skipped poses and hold-last',()=>{
  const move={id:'splash',animation:'splash',phases:[{name:'startup',frames:2,events:[]},{name:'active',frames:3,events:[{onFrame:1,event:{type:'spawn_projectile',projectileId:'paint_ball'}}]},{name:'recovery',frames:3,events:[]}],visualTimeline:[{frame:1,duration:2},{frame:19,duration:1},{frame:8,duration:2}]};
  const timing=reviewPlayback({moves:[move]},'splash',frames);
  assert.deepEqual(sequenceTicks(timing),Array.from({length:8},(_,t)=>moveVisualFrameAt(move,t,24)));
  assert.deepEqual(sequenceTicks(timing),[1,1,19,8,8,8,8,8]);
  assert.ok(timing.events.some(e=>e.tick===3&&e.label==='Projectile release'));
});
test('fallback move cadence, variants and invalid rows are explicit',()=>{
  const moves=[{id:'jab',animation:'ribbon',phases:[{frames:5}]},{id:'cross',animation:'ribbon',phases:[{frames:9}]}];
  const timing=reviewPlayback({moves},'ribbon',frames,{moveId:'cross'});
  assert.equal(sequenceTicks(timing).length,9);assert.equal(timing.moveId,'cross');
  assert.ok(timing.warnings.some(w=>w.includes('each move variant')));
  assert.throws(()=>reviewPlayback({moves},'ribbon',frames,{moveId:'missing'}),/does not use/);
  assert.throws(()=>reviewPlayback({moves:[{...moves[0],visualTimeline:[{frame:24,duration:1}]}]},'ribbon',frames),/visual timeline/);
  assert.throws(()=>reviewPlayback({moves:[{...moves[0],phases:[{frames:216001}]}]},'ribbon',frames),/phase timing/);
});
test('state duration wins over extraction holds; contextual reactions stay labeled',()=>{
  assert.equal(sequenceTicks(reviewPlayback({sprite:{rowPlayback:{crouch:{durationTicks:8}}}},'crouch',frames)).length,8);
  assert.equal(sequenceTicks(reviewPlayback({},'landing',frames)).length,4);
  assert.equal(sequenceTicks(reviewPlayback({},'getup',frames)).length,25);
  assert.ok(reviewPlayback({},'hurt',frames).warnings.some(w=>w.includes('12-tick example')));
  assert.equal(sequenceTicks(reviewPlayback({},'idle',frames)).length,144);
  const source=reviewPlayback({},'idle',frames,{mode:'source'});
  assert.equal(sequenceTicks(source).length,72);assert.equal(source.mode,'source');
});
test('real Palimpsest moves have preview/runtime parity and optional owned rows are reviewed',async()=>{
  const draft=JSON.parse(await readFile('public/fighters/palimpsest/config.json','utf8'));
  const data=JSON.parse(await readFile('public/fighters/palimpsest/frameData.json','utf8'));
  for(const move of draft.moves){
    const source=data.frames[move.animation];
    const timing=reviewPlayback(draft,move.animation,source,{moveId:move.id});
    const expected=Array.from({length:move.phases.reduce((n,p)=>n+p.frames,0)},(_,tick)=>moveVisualFrameAt(move,tick,source.length));
    assert.deepEqual(sequenceTicks(timing),expected,move.id);
  }
  const rows=requiredMotionRows({...draft,sprite:{...draft.sprite,frames:data.frames}});
  assert.ok(rows.includes('hands_idle'));assert.ok(rows.includes('dash_forward'));
});
