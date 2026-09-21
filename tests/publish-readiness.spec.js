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
    const moves=[{id:'test_jab',animation:'idle',phases:[{name:'startup',frames:2,events:[]},{name:'active',frames:1,events:[]},{name:'recovery',frames:3,events:[]}],visualTimeline:[{frame:0,duration:2},{frame:10,duration:1},{frame:23,duration:3}]},{id:'test_cross',animation:'idle',phases:[{name:'active',frames:10,events:[]}]}];
    await runtime.repository.saveDraft(characterId,{...draft,moves,displayName:'Isolated review fixture',requireMotionCoverage:true,sprite:{...draft.sprite,frames:frameData.frames},motionRows:{idle:{uniqueFrames:frames.length,clippedFrames:[],status:'needs-visual-review'}}});
    // The shared viewer is served by Vite; all of this fixture's API reads stay
    // on its disposable CMS instead of the user's everyday database.
    await page.route('http://127.0.0.1:5173/api/**',async route=>{
      const url=new URL(route.request().url());
      await route.fulfill({response:await route.fetch({url:fixture.url+url.pathname+url.search})});
    });
    await page.goto(`${fixture.url}/roster/${characterId}?standalone=1`);
    await page.locator('[data-studio-section="build"]').click();
    await expect(page.locator('[data-readiness-publish]')).toBeDisabled();
    await page.locator('.release-rows summary').click();
    await page.locator('[data-review-row="idle"]').click();
    const form=page.locator('[data-motion-review-form]');
    await expect(form).toBeVisible();
    await expect(page.frameLocator('[data-workbench-preview]').locator('#clip-title')).toContainText('idle');
    const viewer=page.frameLocator('[data-workbench-preview]');
    await expect(viewer.locator('#tick-total')).toHaveText('006');
    await expect(viewer.getByRole('combobox',{name:'Canvas zoom'})).toHaveValue('art');
    // Check the nested viewport too: an outer page can fit while an iframe's
    // zoom selector is clipped on a narrow phone.
    expect(await viewer.locator('html').evaluate(el=>el.scrollWidth<=el.ownerDocument.defaultView.innerWidth)).toBe(true);
    await viewer.getByRole('button',{name:'active at tick 2',exact:true}).click();
    await expect(viewer.locator('#tick-readout')).toHaveText('002');
    await page.locator('[data-preview-timing]').selectOption('source');
    await expect(viewer.locator('#tick-total')).toHaveText('072');
    await page.locator('[data-preview-timing]').selectOption('game');
    await page.locator('[data-preview-move]').selectOption('test_cross');
    await expect(viewer.locator('#tick-total')).toHaveText('010');
    await page.locator('[data-preview-move]').selectOption('test_jab');
    await expect(viewer.locator('#tick-total')).toHaveText('006');
    await form.locator('[name=notes]').fill('Controlled test: approval persistence and version checks, not a new art acceptance.');
    await form.locator('[name=confirmed]').check();
    await form.getByRole('button',{name:'Approve inspected version'}).click();
    await expect(page.locator('#publish-readiness .release-heading')).toContainText('1/9');
    const reviewed=await runtime.repository.getDraft(characterId),fingerprint=reviewed.motionRows.idle.review.fingerprint;
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    await page.locator('.release-rows summary').click();
    await page.locator('[data-review-row="idle"]').click();
    await form.locator('[name=notes]').fill('Test feedback: release pose needs revision.');
    await form.getByRole('button',{name:'Request changes'}).click();
    await expect(form.locator('[role=status]')).toContainText('Confirm that you inspected');
    await form.locator('[name=confirmed]').check();
    await form.getByRole('button',{name:'Request changes'}).click();
    await expect(page.locator('#publish-readiness .release-heading')).toContainText('0/9');
    await page.reload();
    await page.locator('.release-rows summary').click();
    await expect(page.locator('.release-rows')).toContainText('Changes requested');
    await page.locator('[data-review-row="idle"]').click();
    await expect(form.locator('[name=notes]')).toHaveValue('Test feedback: release pose needs revision.');
    await form.locator('[name=confirmed]').check();
    await form.getByRole('button',{name:'Approve inspected version'}).click();
    await expect(page.locator('#publish-readiness .release-heading')).toContainText('1/9');
    const key=`${pack}/${frames[0].file}`;
    await runtime.storage.putBytes(key,Buffer.concat([await runtime.storage.getBytes(key),Buffer.from('changed')]));
    await page.locator('[data-refresh-readiness]').click();
    await expect(page.locator('#publish-readiness .release-heading')).toContainText('0/9');
    await page.locator('.release-rows summary').click();
    await expect(page.locator('.release-rows')).toContainText('Changed since review');
    await expect(page.locator('[data-readiness-publish]')).toBeDisabled();
    expect(await runtime.storage.exists(`releases/latest/characters/${characterId}.json`)).toBe(false);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:test.info().outputPath('readiness-stale.png')});
  }finally{await fixture.close();}
});
