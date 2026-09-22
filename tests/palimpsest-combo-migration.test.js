import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm, readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {planPalimpsestComboMigration, preflightPalimpsestCombos, activatePalimpsestCombos, rollbackPalimpsestCombos} from '../cms/migrations/palimpsestCombos.js';

function fixture() {
  return {
    id:'palimpsest', displayName:'Palimpsest',
    assets:{rootKey:'characters/palimpsest/assets/pack'},
    moves:[
      {id:'jab', animation:'jab', trigger:{sequence:['lp']}, phases:[]},
      {id:'kick', animation:'kick', trigger:{sequence:['lk']}, phases:[]},
      {id:'exclusive', animation:'exclusive', trigger:{sequence:['hp'], cancelOnly:true, cancelFrom:['jab'], allowedStates:['attack']}, phases:[]},
    ],
    sprite:{frames:Object.fromEntries(['jab','kick','exclusive'].map(id=>[id,[{file:`${id}.png`,width:32,height:32,anchor:{x:16,y:30}}]]))},
    combos:[{id:'living_margin', segments:['jab','exclusive'], ownedMoveIds:['exclusive'], exclusiveFrom:1}],
    comboRoutes:[{name:'Wet into wet', moves:['jab','kick'], purpose:'Keep this authored note.'}],
  };
}
async function storage(t) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(),'combo-migration-'));
  t.after(()=>rm(rootDir,{recursive:true,force:true}));
  const draftPath=path.join(rootDir,'characters/palimpsest/draft/content.json');
  await mkdir(path.dirname(draftPath),{recursive:true});
  const original=Buffer.from(JSON.stringify(fixture())); // rollback preserves formatting too
  await writeFile(draftPath,original);
  const assetRoot=path.join(rootDir,fixture().assets.rootKey);
  await mkdir(assetRoot,{recursive:true});
  for(const file of ['jab.png','kick.png','exclusive.png']) await writeFile(path.join(assetRoot,file),'test frame bytes');
  const untouched = {
    'characters/david/draft/content.json':'{"id":"david","archived":true,"comboRoutes":[{"name":"keep"}]}',
    'characters/palimpsest/versions/v1/content.json':'{"published":"immutable"}',
    'characters/palimpsest/draft/content.json.metadata.json':'{"provenance":"keep"}',
    'characters/index.json':'{"characters":[{"id":"palimpsest"},{"id":"david","archived":true}]}',
  };
  for(const [key,body] of Object.entries(untouched)) { const target=path.join(rootDir,key); await mkdir(path.dirname(target),{recursive:true}); await writeFile(target,body); }
  return {rootDir,draftPath,original,untouched};
}
test('pure conversion preserves authored combo ownership and maps routes deterministically',()=>{
  const draft=fixture(), original=structuredClone(draft);
  const plan=planPalimpsestComboMigration(draft);
  assert.deepEqual(draft,original);
  assert.equal(plan.ok,true);
  assert.deepEqual(plan.added,['wet_into_wet']);
  assert.equal(plan.candidate.comboRoutes,undefined);
  assert.deepEqual(plan.candidate.combos[0],draft.combos[0]);
  assert.equal(plan.candidate.combos[1].purpose,'Keep this authored note.');
  assert.deepEqual(plan.candidate.moves,draft.moves);
  assert.equal(planPalimpsestComboMigration(plan.candidate).changed,false);
});
test('preflight blocks conflicts, invalid ids, missing moves, missing art and exclusive art reuse',()=>{
  for(const [change,pattern] of [
    [d=>d.id='david',/Only palimpsest/],
    [d=>d.comboRoutes.push({name:'Living Margin',moves:['jab','kick']}),/Conflicting legacy/],
    [d=>d.combos[0].segments.push('missing'),/unknown move/],
    [d=>delete d.sprite.frames.exclusive,/missing animation/],
    [d=>d.moves[2].animation='jab',/shares its animation/],
    [d=>d.moves[2].trigger.cancelOnly=false,/cancel-only/],
    [d=>d.combos[0].ownedMoveIds.push('kick'),/not a segment/],
    [d=>d.combos[0].id='',/nonempty id/],
    [d=>d.combos.push(null),/at least 2 segments/],
    [d=>d.combos[0].ownedMoveIds='exclusive',/Invalid owned moves/],
    [d=>d.comboRoutes.push({name:'Wet into-wet',moves:['kick','jab']}),/Conflicting legacy/],
  ]) {
    const draft=fixture(); change(draft);
    const result=planPalimpsestComboMigration(draft);
    assert.equal(result.ok,false); assert.match(result.errors.join(';'),pattern);
  }
});
test('read-only preflight, atomic activation and exact-byte rollback preserve every out-of-scope record',async t=>{
  const s=await storage(t);
  const report=await preflightPalimpsestCombos(s);
  assert.equal(report.ok,true);
  assert.deepEqual(await readdir(s.rootDir),['characters']);
  assert.deepEqual(await readFile(s.draftPath),s.original);
  const result=await activatePalimpsestCombos({...s,expectedHash:report.sourceHash,writersStopped:true});
  assert.equal(result.status,'activated');
  assert.equal(JSON.parse(await readFile(s.draftPath)).comboRoutes,undefined);
  assert.deepEqual(await readFile(path.join(result.bundleDir,'original.json')),s.original);
  assert.deepEqual(await readFile(path.join(result.bundleDir,'candidate.json')),await readFile(s.draftPath));
  const second=await activatePalimpsestCombos({...s,expectedHash:result.candidateHash,writersStopped:true});
  assert.equal(second.status,'already-canonical');
  const rollback=await rollbackPalimpsestCombos({...s,...result,writersStopped:true});
  assert.equal(rollback.status,'rolled-back');
  assert.deepEqual(await readFile(s.draftPath),s.original);
  assert.equal((await rollbackPalimpsestCombos({...s,...result,writersStopped:true})).status,'already-rolled-back');
  for(const [key,body] of Object.entries(s.untouched)) assert.equal(await readFile(path.join(s.rootDir,key),'utf8'),body);
});
test('refuses missing maintenance assertion and stale preflight instead of overwriting edits',async t=>{
  const s=await storage(t), report=await preflightPalimpsestCombos(s);
  await assert.rejects(activatePalimpsestCombos({...s,expectedHash:report.sourceHash}),/Stop CMS/);
  await writeFile(s.draftPath,JSON.stringify({...fixture(),displayName:'Edited'}));
  await assert.rejects(activatePalimpsestCombos({...s,expectedHash:report.sourceHash,writersStopped:true}),/changed since preflight/);
  assert.equal(JSON.parse(await readFile(s.draftPath)).displayName,'Edited');
});
test('concurrent activations serialize and only one can replace the source revision',async t=>{
  const s=await storage(t), report=await preflightPalimpsestCombos(s);
  const outcomes=await Promise.allSettled(Array.from({length:3},()=>activatePalimpsestCombos({...s,expectedHash:report.sourceHash,writersStopped:true})));
  assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);
  for(const result of outcomes.filter(result=>result.status==='rejected')) assert.match(result.reason.message,/owns the lock|changed since preflight/);
  assert.equal(JSON.parse(await readFile(s.draftPath)).combos.length,2);
});
test('rollback fails closed on subsequent edits and corrupted backup',async t=>{
  const s=await storage(t), report=await preflightPalimpsestCombos(s);
  const result=await activatePalimpsestCombos({...s,expectedHash:report.sourceHash,writersStopped:true});
  const candidate=await readFile(s.draftPath);
  await writeFile(s.draftPath,JSON.stringify({...JSON.parse(candidate),displayName:'New work'}));
  await assert.rejects(rollbackPalimpsestCombos({...s,...result,writersStopped:true}),/edits after migration/);
  assert.equal(JSON.parse(await readFile(s.draftPath)).displayName,'New work');
  await writeFile(s.draftPath,candidate);
  await writeFile(path.join(result.bundleDir,'original.json'),'{}');
  await assert.rejects(rollbackPalimpsestCombos({...s,...result,writersStopped:true}),/checksum mismatch/);
  assert.deepEqual(await readFile(s.draftPath),candidate);
});
test('an invalid preflight never writes draft data',async t=>{
  const s=await storage(t);
  const broken=fixture(); broken.combos[0].segments.push('missing');
  await writeFile(s.draftPath,JSON.stringify(broken));
  const report=await preflightPalimpsestCombos(s);
  assert.equal(report.ok,false);
  await assert.rejects(activatePalimpsestCombos({...s,expectedHash:report.sourceHash,writersStopped:true}),/validation failed/);
  assert.deepEqual(JSON.parse(await readFile(s.draftPath)),broken);
});
test('file preflight catches missing physical animation assets before migration',async t=>{
  const s=await storage(t);
  await rm(path.join(s.rootDir,fixture().assets.rootKey,'exclusive.png'));
  const report=await preflightPalimpsestCombos(s);
  assert.equal(report.ok,false);
  assert.match(report.errors.join(';'),/Missing animation file "exclusive.png"/);
  await assert.rejects(activatePalimpsestCombos({...s,expectedHash:report.sourceHash,writersStopped:true}),/Missing animation file/);
  assert.deepEqual(await readFile(s.draftPath),s.original);
});
