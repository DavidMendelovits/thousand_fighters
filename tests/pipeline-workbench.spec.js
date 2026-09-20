import {test,expect} from '@playwright/test';
import {buildFixture} from './helpers/buildFixture.js';
import {runVideoJob} from '../scripts/generate_animation_video.mjs';
import {readFile} from 'node:fs/promises';

test('saved plan, one admitted attempt and benchmark survive browser reload',async({page})=>{
  const fixture=await buildFixture({delayMs:1500});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(`${fixture.url}/roster/${fixture.characterId}?standalone=1`);
    const panel=page.locator('#character-build-plans');
    await panel.getByText('New saved plan',{exact:true}).click();
    await panel.locator('[name="estimatedCostUsd"]').fill('0');
    await panel.locator('[name="maxSubmissions"]').fill('1');
    await panel.getByRole('button',{name:'Save plan · no generation'}).click();
    await expect(panel).toContainText('0/1 submissions reserved');
    expect(fixture.calls).toBe(0);
    await page.reload();
    await expect(panel).toContainText('0/1 submissions reserved');
    page.once('dialog',dialog=>dialog.accept());
    await panel.getByRole('button',{name:'Check reviews / continue one step'}).click();
    await expect(panel).toContainText('1/1 submissions reserved');
    await expect(page.locator('[data-build-status="completed"]')).toBeVisible({timeout:45000});
    await page.reload();
    page.once('dialog',dialog=>dialog.accept());
    await panel.getByRole('button',{name:'Check reviews / continue one step'}).click();
    await expect(panel).toContainText('Review identity');
    expect(fixture.calls).toBe(1);
    const report=await (await page.request.get(`${fixture.url}/api/benchmarks`)).json();
    expect(report.summary.attempts).toBe(1);
    expect(report.summary.succeeded).toBe(1);
    expect(report.groups[0].measurementKind).toBe('fixture');
    await page.goto(`${fixture.url}/pipeline?standalone=1`);
    await expect(page.locator('#pipeline-benchmarks')).toContainText('1 unique attempts');
    await expect(page.locator('#pipeline-benchmarks')).toContainText('fixture');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    expect(errors).toEqual([]);
  }finally{await fixture.close();}
});

test('isolated trial starts once, survives refresh and reaches the shared attempt ledger',async({page})=>{
  let submissions=0;
  const fixture=await buildFixture({delayMs:1,trialTransport:(options,context)=>runVideoJob(options,{...context,adapter:{provider:'fixture',
    submit:async()=>{submissions++;return {requestId:'controlled-trial-request'};},
    poll:async(_task,{onStatus})=>{await onStatus('IN_PROGRESS');await new Promise(resolve=>setTimeout(resolve,1500));},
    result:async()=>({}),download:async()=>Buffer.from('controlled transport bytes; not playback evidence'),
  }})});
  try{
    const reference=`characters/${fixture.characterId}/assets/source/trial.png`;
    await fixture.runtime.storage.putBytes(reference,await readFile(new URL('../public/fighters/palimpsest/portrait.png',import.meta.url)),{contentType:'image/png'});
    const response=await page.request.post(`${fixture.url}/api/benchmark-trials`,{data:{name:'Controlled transport trial',characterId:fixture.characterId,budgetUsd:2,referenceKeys:[reference],candidates:[{provider:'fal',model:'fal-ai/kling-video/v3/standard/image-to-video'},{provider:'pruna',model:'p-video-2-pro'}],actions:[{moveId:'walk_forward',prompt:'Same controlled motion'}],settings:{resolution:'provider-native',durationSeconds:5,artStyle:'paint'}}});
    expect(response.status()).toBe(201);
    const {trial}=await response.json();
    await page.goto(`${fixture.url}/pipeline?standalone=1`);
    const saved=page.locator(`[data-trial-id="${trial.id}"]`);
    await saved.locator('summary').click();
    page.once('dialog',dialog=>dialog.accept());
    await saved.getByRole('button',{name:'Run this candidate/action'}).first().click();
    await expect(saved).toContainText('running');
    await page.reload();
    await page.locator(`[data-trial-id="${trial.id}"] > summary`).click();
    await expect(saved).toContainText('completed');
    expect(submissions).toBe(1);
    const repeated=await page.request.post(`${fixture.url}/api/benchmark-trials/${trial.id}/run`,{data:{candidateIndex:0,actionIndex:0,confirmed:true,acceptUnknownCost:true}});
    expect((await repeated.json()).reused).toBe(true);expect(submissions).toBe(1);
    const report=await (await page.request.get(`${fixture.url}/api/benchmarks`)).json();
    expect(report.summary.attempts).toBe(1);expect(report.groups[0].measurementKind).toBe('fixture');
    expect(await fixture.runtime.storage.getBytes(reference)).toEqual(await fixture.runtime.storage.lineage.readArtifact(trial.references[0]));
  }finally{await fixture.close();}
});

test('unknown-price plan blocks submission and trial definitions never generate',async({page})=>{
  const fixture=await buildFixture({delayMs:10});
  try{
    await page.goto(`${fixture.url}/roster/${fixture.characterId}?standalone=1`);
    const panel=page.locator('#character-build-plans');
    await panel.getByText('New saved plan',{exact:true}).click();
    await panel.getByRole('button',{name:'Save plan · no generation'}).click();
    await expect(panel).toContainText('0/4 submissions reserved');
    page.once('dialog',dialog=>dialog.accept());
    await panel.getByRole('button',{name:'Check reviews / continue one step'}).click();
    await expect(panel).toContainText('Price is unknown');
    expect(fixture.calls).toBe(0);
    const reference=`characters/${fixture.characterId}/assets/source/test-reference.png`;
    await fixture.runtime.storage.putBytes(reference,Buffer.from('Controlled immutable reference bytes'),{contentType:'image/png'});
    await page.goto(`${fixture.url}/pipeline?standalone=1`);
    await page.getByText('Plan a controlled model trial',{exact:true}).click();
    const form=page.locator('[data-trial-form]');
    await form.locator('[name="name"]').fill('Controlled comparison');
    await form.locator('[name="characterId"]').fill(fixture.characterId);
    await form.locator('[name="budgetUsd"]').fill('1');
    await form.locator('[name="references"]').fill(reference);
    await form.locator('[name="candidates"]').fill(JSON.stringify([{provider:'fixture',model:'a'},{provider:'fixture',model:'b'}]));
    await form.locator('[name="actions"]').fill(JSON.stringify([{moveId:'walk_forward',prompt:'Same fixed movement'}]));
    await form.getByRole('button',{name:'Save trial without generating'}).click();
    await expect(form).toContainText('Trial saved. No provider requests were made.');
    await page.reload();
    await expect(page.locator('[data-trial-list]')).toContainText('Controlled comparison');
    expect(fixture.calls).toBe(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }finally{await fixture.close();}
});
