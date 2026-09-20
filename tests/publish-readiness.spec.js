import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {historyFixture} from './helpers/historyFixture.js';

test('review queue approves an exact version and detects replacement without publishing',async({page})=>{
  const fixture=await historyFixture();
  try{
    const {runtime,characterId,pack}=fixture;
    const source=JSON.parse(await readFile('public/fighters/palimpsest/frameData.json','utf8'));
    const frames=source.frames.idle;
    for(const frame of frames)await runtime.storage.putBytes(`${pack}/${frame.file}`,await readFile(`public/fighters/palimpsest/${frame.file}`),{contentType:'image/png'});
    await runtime.storage.putBytes(`${pack}/sheets/idle.png`,await readFile('public/fighters/palimpsest/sheets/idle.png'),{contentType:'image/png'});
    const draft=await runtime.repository.getDraft(characterId);
    const frameData={frames:{...draft.sprite.frames,idle:frames}};
    await runtime.storage.putJson(`${pack}/frameData.json`,frameData);
    await runtime.repository.saveDraft(characterId,{...draft,displayName:'Isolated review fixture',requireMotionCoverage:true,sprite:{...draft.sprite,frames:frameData.frames},motionRows:{idle:{uniqueFrames:frames.length,clippedFrames:[],status:'needs-visual-review'}}});
    // The shared viewer is served by Vite; all of this fixture's API reads stay
    // on its disposable CMS instead of the user's everyday database.
    await page.route('http://127.0.0.1:5173/api/**',async route=>{
      const url=new URL(route.request().url());
      await route.fulfill({response:await route.fetch({url:fixture.url+url.pathname+url.search})});
    });
    await page.goto(`${fixture.url}/roster/${characterId}?standalone=1`);
    await expect(page.locator('[data-readiness-publish]')).toBeDisabled();
    await page.locator('.release-rows summary').click();
    await page.locator('[data-review-row="idle"]').click();
    const form=page.locator('[data-motion-review-form]');
    await expect(form).toBeVisible();
    await expect(page.frameLocator('[data-workbench-preview]').locator('#clip-title')).toContainText('idle');
    await form.locator('[name=notes]').fill('Controlled test: approval persistence and version checks, not a new art acceptance.');
    await form.locator('[name=confirmed]').check();
    await form.getByRole('button',{name:'Approve inspected version'}).click();
    await expect(page.locator('.release-heading')).toContainText('1/9');
    const reviewed=await runtime.repository.getDraft(characterId),fingerprint=reviewed.motionRows.idle.review.fingerprint;
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const key=`${pack}/${frames[0].file}`;
    await runtime.storage.putBytes(key,Buffer.concat([await runtime.storage.getBytes(key),Buffer.from('changed')]));
    await page.locator('[data-refresh-readiness]').click();
    await expect(page.locator('.release-heading')).toContainText('0/9');
    await page.locator('.release-rows summary').click();
    await expect(page.locator('.release-rows')).toContainText('Changed since review');
    await expect(page.locator('[data-readiness-publish]')).toBeDisabled();
    expect(await runtime.storage.exists(`releases/latest/characters/${characterId}.json`)).toBe(false);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:test.info().outputPath('readiness-stale.png')});
  }finally{await fixture.close();}
});
