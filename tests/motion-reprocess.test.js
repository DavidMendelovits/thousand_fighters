import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { historyFixture } from './helpers/historyFixture.js';
import { reprocessArchivedVideo, validateReprocess, resolveMotionVideo } from '../cms/pipeline/reprocessArchivedVideo.js';
import { motionActorReference, motionCompilerSettings } from '../cms/pipeline/motionReference.js';
import { motionMarkers } from '../admin/motionTiming.js';

test('offline options reject invalid ranges, poses and coercion', () => {
  for (const opts of [{frames:7},{frames:'20'},{start:2.1},{start:30,end:10},{end:5},{loop:'false'},{matteCleanup:1},{contactFrame:0},{contactFrame:19},{contactFrame:6,recoveryFrame:5}]) assert.throws(()=>validateReprocess(opts));
  validateReprocess({frames:20,start:0,end:64,contactFrame:7,recoveryFrame:12,matteCleanup:true});
  assert.throws(()=>validateReprocess({frames:20,start:0,end:19,loop:true}),/loops omit/);
  assert.deepEqual(motionCompilerSettings('paint'),{style:'watercolor',background:'paint-auto',rootMode:'fixed',expandCanvas:true});
  assert.equal(motionCompilerSettings('watercolor').style,'watercolor');
  assert.throws(()=>motionActorReference({motionActors:{pinch:'hands'},actors:[]},'pinch',{}),/Unknown motion actor/);
});

test('real saved video reprocess uses summon art, branches assets, records lineage and leaves publication alone',async t=>{
  const fixture=await historyFixture();t.after(()=>fixture.close());
  const {runtime:{storage,repository},characterId,pack}=fixture;
  const referenceFile='sprites/hands_idle/hands_idle_001.png';
  const reference=await readFile(`public/fighters/palimpsest/${referenceFile}`);
  await storage.putBytes(`${pack}/${referenceFile}`,reference,{contentType:'image/png'});
  const frames={hands_idle:[{file:referenceFile}],hands_pinch:[{file:referenceFile}]};
  await storage.putJson(`${pack}/frameData.json`,{frames});
  const move={id:'pinch',animation:'hands_pinch',controlledActor:'hands',phases:[{frames:11,events:[]},{frames:5,events:[{onFrame:0,event:{type:'grab_check',grab:{actorGrip:{actor:'hands',holdStartFrame:4,holdEndFrame:6}}}}]},{frames:30,events:[]}]};
  const video=await storage.lineage.artifact(await readFile('artifacts/hands-repair/provider-source.mp4'),{contentType:'video/mp4'});
  const event=await storage.lineage.event(characterId,{type:'generation-output',moveId:'hands_pinch',artifact:video});
  // The current source is older than one page of noisy artifact events.
  for(let i=0;i<201;i++)await storage.lineage.event(characterId,{type:'test-noise'});
  assert.equal((await resolveMotionVideo({storage,characterId,sourceSha256:video.sha256})).id,event.id);
  const initial=await repository.saveDraft(characterId,{...(await repository.getDraft(characterId)),artStyle:'paint',moves:[move],sprite:{basePath:'/fighters/test',frames},actors:[{id:'hands',idleAnimation:'hands_idle',sprite:{basePath:'/fighters/test',frames:{base:[{file:referenceFile}],...frames},frameCounts:{}}}],motionRows:{hands_pinch:{sourceSha256:video.sha256,status:'approved'}}});
  const request={repository,storage,characterId,action:'hands_pinch',frames:20,start:0,end:64,matteCleanup:true,contactFrame:7,recoveryFrame:12,expectedSourceSha256:video.sha256,expectedUpdatedAt:initial.updatedAt};
  await assert.rejects(reprocessArchivedVideo({...request,expectedUpdatedAt:'stale'}),/draft changed/);
  const result=await reprocessArchivedVideo(request);t.after(()=>rm(result.directory,{recursive:true,force:true}));
  assert.equal(result.providerRequests,0);assert.equal(result.frameCount,20);assert.ok(result.compileMs>0);
  const current=await repository.getDraft(characterId),row=current.motionRows.hands_pinch;
  assert.notEqual(current.assets.rootKey,pack);assert.match(current.assets.rootKey,/revisions/);
  assert.equal(row.status,'needs-visual-review');assert.equal(row.review,undefined);
  assert.equal(row.provenance.options.matteCleanup,true);assert.equal(row.provenance.options.rootMode,'fixed');
  assert.deepEqual(row.sourceRange,[0,64]);assert.equal(row.uniqueFrames,20);assert.deepEqual(row.clippedFrames,[]);
  assert.deepEqual(motionMarkers(current.moves[0]),{contactFrame:7,recoveryFrame:12});
  assert.equal(current.moves[0].phases[1].events[0].event.grab.actorGrip.holdEndFrame,11);
  assert.deepEqual(await storage.getJson(`${pack}/frameData.json`),{frames});
  assert.deepEqual(await storage.getBytes(`${pack}/${referenceFile}`),reference);
  assert.equal((await repository.getVersion(characterId,result.safetyVersionId)).motionRows.hands_pinch.status,'approved');
  assert.equal((await repository.getVersion(characterId,result.versionId)).motionRows.hands_pinch.status,'needs-visual-review');
  const complete=(await storage.lineage.events(characterId)).events.find(e=>e.type==='motion-reprocessed');
  assert.equal(complete.parentEventId,event.id);assert.equal(complete.providerRequests,0);
  assert.equal((await storage.list('benchmarks/generation-attempts')).length,0);
  // Corruption is detected before the live row or its assets can be changed.
  const before=await repository.getDraft(characterId);
  await assert.rejects(reprocessArchivedVideo({...request,expectedUpdatedAt:before.updatedAt,end:359}),/Selected source range/);
  assert.deepEqual(await repository.getDraft(characterId),before);
  const failingStorage = new Proxy(storage,{get(target,key){
    if(key==='putBytes')return async (asset,...args)=>{
      if(asset.includes('/assets/revisions/') && !asset.startsWith(before.history.workingRoot) && asset.endsWith('.png'))throw new Error('Simulated private asset write failure');
      return target.putBytes(asset,...args);
    };
    return Reflect.get(target,key);
  }});
  const failingRepository=Object.create(repository);failingRepository.storage=failingStorage;
  await assert.rejects(reprocessArchivedVideo({...request,repository:failingRepository,storage:failingStorage,expectedUpdatedAt:before.updatedAt}),/private asset write failure/);
  assert.deepEqual(await repository.getDraft(characterId),before);
  assert.deepEqual(await storage.getJson(`${pack}/frameData.json`),{frames});
});
