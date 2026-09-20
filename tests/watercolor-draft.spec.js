import {test,expect} from '@playwright/test';

test('watercolor draft uses only its active outfit and paint mechanics in the real testbed',async({page})=>{
  const images=[],errors=[];
  page.on('request',request=>{if(request.resourceType()==='image')images.push(decodeURIComponent(request.url()));});
  page.on('pageerror',error=>errors.push(error.stack??error.message));
  await page.goto('http://127.0.0.1:5173/testbed.html?id=david');
  await expect(page.getByRole('button',{name:/^Pigment Cascade /})).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForFunction(()=>document.querySelector('#status')?.style.display==='none');
  const runtime=await page.request.get('http://127.0.0.1:8787/api/characters/david/runtime-config');
  const {config,assetRoot}=await runtime.json();
  expect(assetRoot).toContain('fighter-pack-watercolor-v1');
  expect(config.sprite.scale).toBe(.5);
  expect(config.sprite.frameCounts.walk_forward).toBe(24);
  expect(config.moves.find(move=>move.id==='mic_reel').extension.kind).toBe('paint-ribbon');
  expect(images.filter(url=>url.includes('/sprites/')).every(url=>url.includes('fighter-pack-watercolor-v1'))).toBe(true);
  await page.getByRole('button',{name:'⏸ Pause',exact:true}).click();
  await page.getByRole('button',{name:/^Pigment Cascade /}).click();
  for(let i=0;i<30;i++)await page.getByRole('button',{name:'⏭ Step',exact:true}).click();
  await page.screenshot({path:'generated/david-watercolor/paint-cascade-testbed.png'});
  expect(errors).toEqual([]);
});
