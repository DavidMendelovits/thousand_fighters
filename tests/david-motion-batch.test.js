import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {requiredMotionRows,assertMotionCoverage} from '../cms/pipeline/motionRowArtifacts.js';

const draft=JSON.parse(await readFile('cms-data/characters/david/draft/content.json','utf8'));
test('David watercolor pack has complete reviewed video rows and retrievable sources',async()=>{
  const approved=Object.keys(draft.motionRows).filter(row=>draft.motionRows[row].status==='approved');
  assert.ok(approved.length>=15);
  if(draft.moves.some(m=>m.artStatus==='proxy'))assert.throws(()=>assertMotionCoverage(draft),/Incomplete motion pack/);
  else assertMotionCoverage(draft);
  const frameData=JSON.parse(await readFile(`cms-data/${draft.assets.frameDataKey}`,'utf8'));
  for(const action of approved){
    const row=draft.motionRows[action];
    assert.equal(createHash('sha256').update(await readFile(row.source)).digest('hex'),row.sourceSha256);
    if(row.provenance?.compilerSha256){
      const hash=row.provenance.compilerSha256;
      const compiler=await readFile(`cms-data/lineage/blobs/sha256/${hash.slice(0,2)}/${hash}`);
      assert.equal(createHash('sha256').update(compiler).digest('hex'),hash);
    }
    assert.equal(frameData.frames[action].length,row.frameCount);
    assert.equal(draft.sprite.frameCounts[action],row.frameCount);
    const unique=new Set();
    for(const f of frameData.frames[action]){
      assert.deepEqual(f.anchor,{x:192,y:352});
      unique.add(createHash('sha256').update(await readFile(`cms-data/${draft.assets.rootKey}/${f.file}`)).digest('hex'));
    }
    assert.ok(unique.size>=8,action);
    assert.deepEqual(row.clippedFrames,[]);
  }
});
test('three paint releases retain combat ticks and use three visual release poses',()=>{
  const move=draft.moves.find(m=>m.id==='cascade');
  const timeline=move.visualTimeline.flatMap(x=>Array(x.duration).fill(x.frame));
  assert.equal(timeline.length,move.phases.reduce((n,p)=>n+p.frames,0));
  let offset=0;const ticks=[];
  for(const p of move.phases){for(const e of p.events??[])if(e.event.type==='spawn_projectile')ticks.push(offset+e.onFrame);offset+=p.frames;}
  assert.deepEqual(ticks,[12,19,26]);
  assert.deepEqual(ticks.map(t=>timeline[t]),[12,21,22]);
  assert.equal(draft.motionRows.idle.provenance.options.pingPong,true);
});
