import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {importPublishedCharacter} from '../cms/import/importPublishedCharacter.js';
import {createCmsStorage} from '../cms/storage/createCmsStorage.js';
import {CharacterContentRepository} from '../cms/repositories/CharacterContentRepository.js';
import {convertDraftToCharacterConfig} from '../cms/export/convertDraftToCharacterConfig.js';
import {exportCharacterToRuntime} from '../cms/export/exportCharacterToRuntime.js';

test('scoped import preserves Brine geometry, forms, extensions and animations without overwriting drafts',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'fighter-import-test-'));
  try{
    const storage=createCmsStorage({provider:'file',rootDir:root}),repository=new CharacterContentRepository(storage);
    const before=await readFile('public/fighters/brine/config.json','utf8'),original=JSON.parse(before);
    const draft=await importPublishedCharacter({characterId:'brine',repository});
    assert.equal(draft.id,'brine');assert.ok(draft.forms.length);assert.deepEqual(draft.moves,original.moves);
    const frameData=await storage.getJson('characters/brine/assets/fighter-pack/frameData.json');
    assert.ok(frameData.frames.base[0].silhouetteHeight>0);
    assert.ok(await storage.exists('characters/brine/assets/fighter-pack/sprites/base/base_001.png'));
    const manifest=await storage.getJson('characters/brine/assets/fighter-pack/manifest.json');
    const out=convertDraftToCharacterConfig({draft,frameData,manifest});
    assert.deepEqual(out.hurtboxes,original.hurtboxes);assert.deepEqual(out.forms,original.forms);
    assert.deepEqual(out.moves.find(m=>m.id==='tidal_reach').extension,original.moves.find(m=>m.id==='tidal_reach').extension);
    assert.deepEqual(out.moves.find(m=>m.id==='tidal_reach').phases[1].events[0],original.moves.find(m=>m.id==='tidal_reach').phases[1].events[0]);
    await assert.rejects(importPublishedCharacter({characterId:'brine',repository}),/already has a draft/);
    await assert.rejects(importPublishedCharacter({characterId:'../brine',repository}),/fighter id/);
    assert.equal(await readFile('public/fighters/brine/config.json','utf8'),before);
    await exportCharacterToRuntime({runtime:{repository,storage},characterId:'brine',outputDir:path.join(root,'export')});
    assert.ok((await readFile(path.join(root,'export/brine/poses.png'))).length>0);
  }finally{await rm(root,{recursive:true,force:true});}
});
