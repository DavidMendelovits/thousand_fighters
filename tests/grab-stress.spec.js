// Live CMS draft acceptance: requires the dev app and CMS. No paid API calls.
import {test,expect} from '@playwright/test';
const values=page=>page.locator('#hud').evaluate(el=>Object.fromEntries([...el.querySelectorAll('.k')].map(k=>[k.textContent,k.nextElementSibling.textContent])));
async function step(page){
  await page.locator('#step-btn').click();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function capture(page,layout='center-right'){
  await page.goto('http://127.0.0.1:5173/testbed.html?id=palimpsest');
  await expect(page.locator('#hud')).toContainText('dummy state');
  await page.locator('[data-mode=pause]').click();
  await page.locator('[data-dummy=reactive]').click();
  await page.locator('#distance').fill('148');
  await page.locator('#scenario-layout').selectOption(layout);
  await page.locator('[title="Trigger summon"]').click();
  for(let i=0;i<35;i++)await step(page);
  expect((await values(page))['summon ticks']).not.toBe('None');
  await page.locator('[title="Trigger hands_pinch"]').click();
  for(let i=0;i<30&&(await values(page))['dummy state']!=='grabbed';i++)await step(page);
  expect((await values(page))['dummy state']).toBe('grabbed');
}
for(const layout of ['center-right','center-left','right-wall','left-wall'])test(`draft grab captures and naturally releases: ${layout}`,async({page})=>{
  await capture(page,layout);
  const start=await values(page);
  expect(start.facing).toContain(layout.includes('left')?'left':'right');
  for(let i=0;i<45&&(await values(page))['dummy state']==='grabbed';i++)await step(page);
  const end=await values(page);
  expect(end['dummy state']).not.toBe('grabbed');
  expect(end['hold ticks']).toBe('None');
  expect(end['summon ticks']).not.toBe('None');
  await expect(page.locator('#hud-hitboxes')).not.toContainText('engine error');
});
for(const [button,label] of [['inject-hit','Injected hit · 6 ticks'],['force-ko','Forced summoner KO'],['expire-summon','Timer set to 1']])test(`draft held opponent is freed by ${button}`,async({page})=>{
  await capture(page);
  await page.getByText('Interaction stress tests',{exact:true}).click();
  await page.locator(`#${button}`).click();
  for(let i=0;i<8;i++)await step(page);
  const end=await values(page);
  expect(end['dummy state']).not.toBe('grabbed');
  expect(end['hold ticks']).toBe('None');
  expect(end['summon ticks']).toBe('None');
  await expect(page.locator('#intervention-status')).toContainText(label);
  if(button==='force-ko')expect(end['player hp']).toBe('0');
  await page.locator('#reset-btn').click();
  await expect.poll(async()=> (await values(page))['player hp']).not.toBe('0');
  expect((await values(page))['dummy size']).toBe('100%');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
