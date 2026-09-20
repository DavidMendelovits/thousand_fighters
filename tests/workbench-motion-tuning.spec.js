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
    await runtime.repository.saveDraft(characterId,{...draft,moves:[move],sprite:{...draft.sprite,frames:frameData.frames},motionRows:{hands_pinch:{uniqueFrames:20,clippedFrames:[],status:'needs-visual-review'}}});
    await page.goto(`${fixture.url}/roster/${characterId}?standalone=1`);
    const card=page.locator('[data-move-card="hands_pinch"]');
    await expect(card.getByRole('button',{name:'Frames 20',exact:true})).toBeVisible();
    await expect(card.locator('.frame-strip img')).toHaveCount(20);
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
