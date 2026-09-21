import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {buildFixture} from './helpers/buildFixture.js';
import {CharacterBuildJobs} from '../cms/jobs/CharacterBuildJobs.js';

test('real workbench submission survives reload and extracts on the server',async({page})=>{
  const fixture=await buildFixture({delayMs:4500});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto(`${fixture.url}/roster/${fixture.characterId}?standalone=1`);
    await page.locator('[data-studio-section="build"]').click();
    await expect(page.locator('#character-build-jobs')).toContainText('No tracked builds yet');
    await page.locator('[data-studio-section="motion"]').click();
    const row=page.locator('[data-gen-move="base"]');await row.click();
    await page.locator('[data-studio-section="build"]').click();
    await expect(page.locator('[data-build-status="running"]')).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-build-status="running"]')).toBeVisible();
    await expect(page.locator('[data-build-status="completed"]')).toBeVisible({timeout:45000});
    expect(fixture.calls).toBe(1);
    const {jobs}=await (await page.request.get(`${fixture.url}/api/characters/${fixture.characterId}/build-jobs`)).json();
    expect(jobs).toHaveLength(1);expect(jobs[0].result.framesReady).toBe(true);
    const manifest=await fixture.runtime.storage.getJson(jobs[0].result.extraction.manifestKey);
    expect(manifest.sprites.base.length).toBe(6);
    page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Reload saved draft'}).click();
    await expect(page.locator('[data-build-status="completed"]')).toBeVisible();
    await expect(page.locator('[data-move-card="base"]')).toContainText('6');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    expect(errors).toEqual([]);
  }finally{await fixture.close();}
});

test('HTTP duplicate key cannot purchase a second identity generation',async({request})=>{
  const fixture=await buildFixture({delayMs:50});
  try{
    const url=`${fixture.url}/api/characters/${fixture.characterId}/build-jobs`;
    const data={idempotencyKey:randomUUID(),tool:'generate_character_concept',input:{characterId:fixture.characterId,prompt:'Controlled identity fixture'}};
    const responses=await Promise.all([request.post(url,{data}),request.post(url,{data})]);
    expect(responses.every(r=>r.status()===202)).toBe(true);
    const [a,b]=await Promise.all(responses.map(r=>r.json()));expect(a.job.id).toBe(b.job.id);
    await expect.poll(async()=>((await (await request.get(`${url}/${a.job.id}`)).json()).job.status)).toBe('completed');
    expect(fixture.calls).toBe(1);
    expect((await request.post(url,{data:{...data,input:{...data.input,prompt:'Changed'}}})).status()).toBe(409);
  }finally{await fixture.close();}
});

test('an interrupted build requires an explicit checked resolution, with no paid replay',async({page})=>{
  const fixture=await buildFixture({delayMs:10});
  try{
    const previous=new CharacterBuildJobs({storage:fixture.runtime.storage,repository:fixture.runtime.repository,invoke:()=>{throw Error('Never execute');}});
    previous.drain=async()=>{};
    await previous.submit(fixture.characterId,{idempotencyKey:randomUUID(),tool:'generate_character_concept',input:{characterId:fixture.characterId,prompt:'Interrupted fixture'}});
    await page.goto(`${fixture.url}/roster/${fixture.characterId}?standalone=1`);
    await page.locator('[data-studio-section="build"]').click();
    const card=page.locator('[data-build-status="needs-recovery"]');await expect(card).toBeVisible();
    await card.locator('.build-recovery summary').click();
    const note='Checked fixture worker stopped; no external request was ever submitted.';
    await card.locator('[data-build-note]').fill(note);
    await page.locator('[data-build-refresh]').click();
    await expect(card.locator('[data-build-note]')).toHaveValue(note);
    await card.locator('[data-build-resolve]').click();
    await expect(card.locator('[data-build-resolution-status]')).toContainText('Confirm');
    await card.locator('[data-build-confirm]').check();await card.locator('[data-build-resolve]').click();
    await expect(page.locator('[data-build-status="resolved"]')).toContainText(note);
    expect(fixture.calls).toBe(0);
  }finally{await fixture.close();}
});

test('a lost submission response retains the nonce and reuses the paid job',async({page})=>{
  const fixture=await buildFixture({delayMs:1500});
  try{
    await page.goto(`${fixture.url}/roster/${fixture.characterId}?standalone=1`);
    await page.locator('[data-studio-section="identity"]').click();
    let dropped=false;
    await page.route('**/build-jobs',async route=>{
      if(route.request().method()==='POST'&&!dropped){dropped=true;await route.fetch();await route.abort();}
      else await route.continue();
    });
    await page.locator('[data-gen-concept]').click();
    await expect(page.locator('[data-gen-concept]')).toBeEnabled();
    await page.locator('[data-gen-concept]').click();
    await page.locator('[data-studio-section="build"]').click();
    await expect(page.locator('[data-build-status="completed"]')).toBeVisible();
    expect(fixture.calls).toBe(1);
    const {jobs}=await (await page.request.get(`${fixture.url}/api/characters/${fixture.characterId}/build-jobs`)).json();
    expect(jobs).toHaveLength(1);
  }finally{await fixture.close();}
});
