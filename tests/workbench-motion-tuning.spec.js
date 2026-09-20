import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {historyFixture} from './helpers/historyFixture.js';
import {motionMarkers} from '../admin/motionTiming.js';

test('workbench saves contact poses and keeps the selected provider and current thumbnails',async({page})=>{
  const fixture=await historyFixture();
  try{
    const {runtime,characterId,pack}=fixture;
    const source=JSON.parse(await readFile('public/fighters/palimpsest/frameData.json','utf8'));
    const oldFrames=source.frames.hands_pinch,frames=oldFrames.slice(0,20);
    // Leave all 24 files in storage, just as a shorter regenerated row does.
    for(const frame of oldFrames)await runtime.storage.putBytes(`${pack}/${frame.file}`,await readFile(`public/fighters/palimpsest/${frame.file}`),{contentType:'image/png'});
    const draft=await runtime.repository.getDraft(characterId);
    const frameData={frames:{...draft.sprite.frames,hands_pinch:frames}};
    await runtime.storage.putJson(`${pack}/frameData.json`,frameData);
    const move={id:'pinch',displayName:'Test pinch',animation:'hands_pinch',trigger:{sequence:['lk']},phases:[{name:'startup',frames:11,events:[]},{name:'active',frames:5,events:[]},{name:'recovery',frames:30,events:[]}]};
    move.visualTimeline=[{frame:0,duration:3},{frame:2,duration:3},{frame:1,duration:5},{frame:18,duration:5},{frame:19,duration:30}];
    await runtime.repository.saveDraft(characterId,{...draft,artStyle:'paint',moves:[move],sprite:{...draft.sprite,frames:frameData.frames},motionRows:{hands_pinch:{sourceSha256:'a'.repeat(64),sourceRange:[0,123],sourceFrameCount:124,frameCount:20,uniqueFrames:20,clippedFrames:[],status:'needs-visual-review'}}});
    await page.goto(`${fixture.url}/roster/${characterId}?standalone=1`);
    const card=page.locator('[data-move-card="hands_pinch"]');
    await expect(card.getByRole('button',{name:'Frames 20',exact:true})).toBeVisible();
    await expect(card.locator('.frame-strip img')).toHaveCount(20);
    const reprocess=card.locator('[data-motion-reprocess]');
    await reprocess.locator('summary').click();
    await reprocess.locator('[data-reprocess-field="end"]').fill('5');
    await reprocess.getByRole('button',{name:'Create reprocessed candidate'}).click();
    await expect(reprocess.getByRole('status')).toContainText('source interval');
    await reprocess.locator('[data-reprocess-field="end"]').fill('64');
    await reprocess.locator('[data-reprocess-field="contact"]').fill('8');
    await reprocess.locator('[data-reprocess-field="recovery"]').fill('13');
    let request;
    await page.route('**/history/reprocess',async route=>{
      request=route.request().postDataJSON();
      await route.fulfill({json:{ok:true,result:{frameCount:20,compileMs:5200,providerRequests:0}}});
    });
    await reprocess.getByRole('button',{name:'Create reprocessed candidate'}).click();
    await expect(card.locator('[data-reprocess-status]')).toContainText('No provider calls');
    expect(request).toMatchObject({action:'hands_pinch',frames:20,start:0,end:64,contactFrame:7,recoveryFrame:12,matteCleanup:true,loop:false,expectedSourceSha256:'a'.repeat(64)});
    await expect(card.locator('[data-reprocess-video]')).toBeEnabled();
    await expect(card.locator('[data-reextract]')).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.unroute('**/history/reprocess');
    await card.locator('[data-row-generator]').selectOption('pruna-video');
    await card.getByRole('button',{name:'Data',exact:true}).click();
    await card.locator('.move-inspector summary').click();
    await card.getByRole('spinbutton',{name:'Test pinch Meter cost'}).fill('1');
    await card.getByRole('button',{name:'Save move & effect'}).click();
    await expect(card.locator('.move-save-status')).toContainText('Saved to draft');
    expect((await runtime.repository.getDraft(characterId)).moves[0].visualTimeline).toEqual(move.visualTimeline);
    await card.getByRole('spinbutton',{name:'Test pinch Contact pose (1-based)'}).fill('5');
    await card.getByRole('spinbutton',{name:'Test pinch Recovery pose (1-based)'}).fill('8');
    await card.getByRole('button',{name:'Save move & effect'}).click();
    await expect(card.locator('.move-save-status')).toContainText('Saved to draft');
    await expect(card.locator('[data-row-generator]')).toHaveValue('pruna-video');
    await expect(card.getByRole('spinbutton',{name:'Test pinch Contact pose (1-based)'})).toHaveValue('5');
    const saved=await runtime.repository.getDraft(characterId);
    expect(motionMarkers(saved.moves[0])).toEqual({contactFrame:4,recoveryFrame:7});
    expect(saved.moves[0].phases.map(({name,frames,events})=>({name,frames,events}))).toEqual(move.phases);
    expect(saved.motionRows.hands_pinch.status).toBe('needs-visual-review');
    expect(await runtime.storage.exists(`${pack}/${oldFrames[23].file}`)).toBe(true);
    await expect(card.locator('.frame-strip img')).toHaveCount(20);
  }finally{await fixture.close();}
});
