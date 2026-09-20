import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {FileCmsStorage} from '../cms/storage/FileCmsStorage.js';
import {CharacterContentRepository} from '../cms/repositories/CharacterContentRepository.js';
import {workbenchLibrary, workbenchDetail, updateWorkbench, workbenchReviewClip} from '../cms/authoring/workbenchLibrary.js';
import {parseAnimationClip} from '../shared/animationClip';
import {renderReference} from '../admin/workbenchPreview.js';
import {CharacterCreationPipeline} from '../cms/pipeline/CharacterCreationPipeline.js';
import {PipelinePort} from '../cms/pipeline/ports.js';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-library-'));
  t.after(() => rm(root, {recursive:true,force:true}));
  const repository = new CharacterContentRepository(new FileCmsStorage({rootDir:root}));
  const id = 'ribbon_fixture';
  const pack = `characters/${id}/assets/current`;
  const frames = [0,1].map(i => ({file:`sprites/idle/idle_00${i+1}.png`,width:20,height:30,anchor:{x:10,y:28},durationFrames:i+2}));
  await repository.saveDraft(id, {displayName:'Ribbon', moves:[], assets:{rootKey:pack}, sprite:{frames:{idle:frames},rowPlayback:{idle:{loop:true}}}});
  const sheet = Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(sheet);sheet.writeUInt32BE(40,16);sheet.writeUInt32BE(30,20);
  await repository.storage.putBytes(`${pack}/sheets/idle.png`,sheet);
  for (const frame of frames) await repository.storage.putBytes(`${pack}/${frame.file}`,Buffer.from('fixture'));
  await repository.storage.putBytes(`characters/${id}/assets/old/sprites/idle/idle_099.png`,Buffer.from('old revision'));
  return {repository,id,pack};
}

test('library counts active assets only; incomplete and test drafts stay separate',async t=>{
  const {repository,id}=await fixture(t);
  await repository.saveDraft('empty_draft',{moves:[]});
  const entries=await workbenchLibrary(repository);
  assert.equal(entries.find(c=>c.id===id).frameCount,2);
  assert.equal(entries.find(c=>c.id===id).group,'animated');
  assert.equal(entries.find(c=>c.id==='empty_draft').group,'drafts');
  assert.equal(entries.find(c=>c.id===id).published,false);
});

test('archive and restore preserve assets, moves and lineage',async t=>{
  const {repository,id,pack}=await fixture(t);
  const before=await repository.getDraft(id);
  assert.equal((await updateWorkbench(repository,id,{archived:true})).group,'archived');
  assert.equal((await updateWorkbench(repository,id,{archived:false})).group,'animated');
  assert.deepEqual((await repository.getDraft(id)).sprite,before.sprite);
  assert.equal(await repository.storage.exists(`${pack}/sprites/idle/idle_001.png`),true);
  assert.ok((await repository.storage.lineage.events(id)).events.some(e=>e.type==='workbench-restored'));
});

test('reference approval is bound to exact bytes, never to a reusable filename',async t=>{
  const {repository,id}=await fixture(t);
  const key=`characters/${id}/assets/concept/concept_art.png`;
  await repository.storage.putBytes(key,Buffer.from('first'));
  const original=(await workbenchDetail(repository,id)).reference;
  await updateWorkbench(repository,id,{referenceStatus:'rejected',sha256:original.sha256,notes:'Unwanted feet'});
  assert.equal((await workbenchDetail(repository,id)).reference.status,'rejected');
  await repository.storage.putBytes(key,Buffer.from('replacement'));
  assert.equal((await workbenchDetail(repository,id)).reference.status,'unreviewed');
  await assert.rejects(updateWorkbench(repository,id,{referenceStatus:'approved',sha256:original.sha256,notes:'old image'}),/Reference changed/);
});

test('reference selection follows replacement formats and the restored working branch',async t=>{
  const {repository,id}=await fixture(t);
  const base=`characters/${id}/assets`;
  await repository.storage.putBytes(`${base}/concept/concept_art.png`,Buffer.from('old png'));
  await repository.storage.putBytes(`${base}/concept/concept_art.webp`,Buffer.from('replacement'),{referenceGeneratedAt:'2026-09-19T12:00:00Z'});
  assert.equal((await workbenchDetail(repository,id)).reference.key,`${base}/concept/concept_art.webp`);
  const root=`${base}/revisions/restored`;
  await repository.storage.putBytes(`${root}/concept/concept_art.png`,Buffer.from('restored image'));
  const draft=await repository.getDraft(id);
  await repository.saveDraft(id,{...draft,history:{workingRoot:root}});
  assert.equal((await workbenchDetail(repository,id)).reference.key,`${root}/concept/concept_art.png`);
});

test('review clip uses game cadence, retains extraction mode and preserves geometry',async t=>{
  const {repository,id,pack}=await fixture(t);
  const clip=parseAnimationClip(await workbenchReviewClip(repository,id,'idle'));
  assert.equal(clip.totalTicks,12);assert.equal(clip.playback,'loop');
  const extracted=parseAnimationClip(await workbenchReviewClip(repository,id,'idle',{mode:'source'}));
  assert.equal(extracted.totalTicks,5);assert.equal(extracted.provenance.timingMode,'source');
  assert.equal(clip.layers[0].frames[1].x,20);assert.equal(clip.qa.status,'needs-review');
  assert.ok(decodeURIComponent(clip.layers[0].sheet).includes(pack));
  const invalid=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(invalid);invalid.writeUInt32BE(39,16);invalid.writeUInt32BE(30,20);
  await repository.storage.putBytes(`${pack}/sheets/idle.png`,invalid);
  await assert.rejects(workbenchReviewClip(repository,id,'idle'),/geometry/);
  await assert.rejects(workbenchReviewClip(repository,id,'../secret'),/Invalid/);
});

test('legacy cropped frames use padded sheet cells and preserve their authored pivots',async t=>{
  const {repository,id}=await fixture(t);
  const draft=await repository.getDraft(id);
  draft.sprite.frames.idle[1]={...draft.sprite.frames.idle[1],width:16,height:26,anchor:{x:7,y:24}};
  await repository.saveDraft(id,draft);
  const clip=parseAnimationClip(await workbenchReviewClip(repository,id,'idle'));
  assert.deepEqual(clip.canvas,{width:20,height:30});
  assert.equal(clip.layers[0].frames[1].x,20);
  assert.deepEqual(clip.layers[0].frames[1].offset,{x:1,y:0});
});

test('controlled actor rows are identified as summons, not the fighter body',async t=>{
  const {repository,id}=await fixture(t);
  const draft=await repository.getDraft(id);
  draft.actors=[{id:'floating_hands',idleAnimation:'idle'}];
  await repository.saveDraft(id,draft);
  const clip=parseAnimationClip(await workbenchReviewClip(repository,id,'idle'));
  assert.equal(clip.layers[0].id,'floating_hands');
  assert.equal(clip.layers[0].role,'summon');
});

test('single reference is never sliced or labelled as imaginary turnaround views',()=>{
  const html=renderReference({url:'/api/assets/reference.png',status:'rejected',notes:'<bad>'},null,'paint & ribbons');
  assert.equal((html.match(/<img /g)||[]).length,1);
  assert.ok(!/background-position|Front|Profile|Back/.test(html));
  assert.ok(html.includes('&lt;bad&gt;'));
});

test('rejected identity blocks new paid row generation before provider submission',async t=>{
  const {repository,id}=await fixture(t);
  await repository.storage.putBytes(`characters/${id}/assets/concept/concept_art.png`,Buffer.from('rejected identity'));
  const ref=(await workbenchDetail(repository,id)).reference;
  await updateWorkbench(repository,id,{referenceStatus:'rejected',sha256:ref.sha256,notes:'Inconsistent material'});
  let called=false;
  const pipeline=new CharacterCreationPipeline({resolve(port){
    if(port===PipelinePort.CHARACTER_REPOSITORY)return repository;
    if(port===PipelinePort.ASSET_STORAGE)return repository.storage;
    if(port===PipelinePort.IMAGE_GENERATOR)return {generateImage(){called=true;throw new Error('must not be reached');}};
    throw new Error(port);
  }});
  await assert.rejects(pipeline.generateSpriteSheet({characterId:id,prompt:'walk',moveId:'walk_forward'}),/reference was rejected/);
  assert.equal(called,false);
});

test('a replacement format supersedes rejected art in the actual generation request',async t=>{
  const {repository,id}=await fixture(t);
  const base=`characters/${id}/assets/concept/concept_art`;
  await repository.storage.putBytes(`${base}.png`,Buffer.from('old identity'));
  const ref=(await workbenchDetail(repository,id)).reference;
  await updateWorkbench(repository,id,{referenceStatus:'rejected',sha256:ref.sha256,notes:'Replace identity'});
  await repository.storage.putBytes(`${base}.webp`,Buffer.from('replacement'),{referenceGeneratedAt:'2026-09-19T12:00:00Z',contentType:'image/webp'});
  let request;
  const pipeline=new CharacterCreationPipeline({resolve(port){
    if(port===PipelinePort.CHARACTER_REPOSITORY)return repository;
    if(port===PipelinePort.ASSET_STORAGE)return repository.storage;
    if(port===PipelinePort.IMAGE_GENERATOR)return {generateImage(input){request=input;throw new Error('captured mock request');}};
    throw new Error(port);
  }});
  await assert.rejects(pipeline.generateSpriteSheet({characterId:id,prompt:'Reference pose',moveId:'base'}),/captured mock request/);
  assert.deepEqual(request.referenceAssetKeys,[`${base}.webp`]);
  assert.equal(request.referenceImages[0].contentType,'image/webp');
  assert.equal(Buffer.from(request.referenceImages[0].base64,'base64').toString(),'replacement');
});

test('saved row corrections reach the image provider request without triggering generation on review',async t=>{
  const {repository,id}=await fixture(t);
  const draft=await repository.getDraft(id);
  await repository.saveDraft(id,{...draft,motionRows:{idle:{review:{decision:'changes-requested',notes:'Keep exactly two hands and keep the needle pinched.'}}}});
  let request;
  const pipeline=new CharacterCreationPipeline({resolve(port){
    if(port===PipelinePort.CHARACTER_REPOSITORY)return repository;
    if(port===PipelinePort.ASSET_STORAGE)return repository.storage;
    if(port===PipelinePort.IMAGE_GENERATOR)return {generateImage(input){request=input;throw new Error('captured mock request');}};
    throw new Error(port);
  }});
  assert.equal(request,undefined);
  await assert.rejects(pipeline.generateSpriteSheet({characterId:id,prompt:'Floating paint hands at rest.',moveId:'idle'}),/captured mock request/);
  assert.ok(request.prompt.startsWith('Floating paint hands at rest.'));
  assert.ok(request.prompt.includes('Keep exactly two hands and keep the needle pinched.'));
});
