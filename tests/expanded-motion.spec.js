import {test,expect} from '@playwright/test';
test('all twenty expanded moves load unique rows and play through their active phases',async({page})=>{
 test.setTimeout(120000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5173/testbed.html?id=david');
 await page.waitForFunction(()=>Number(document.querySelector('#hud .v')?.textContent)>1);
 const {config}=await (await page.request.get('http://127.0.0.1:8787/api/characters/david/runtime-config')).json();
 const moves=config.moves.filter(m=>m.requiredAnimation);
 expect(moves).toHaveLength(20);
 await page.getByRole('button',{name:'⏸ Pause',exact:true}).click();
 for(const move of moves){
  expect(move.artStatus).toBe('ready');expect(move.animation).toBe(move.requiredAnimation);
  expect(config.sprite.frames[move.animation].length).toBeGreaterThanOrEqual(8);
  await page.getByRole('button',{name:new RegExp(`^${move.displayName} `)}).click();
  for(let i=0;i<move.phases[0].frames+2;i++)await page.getByRole('button',{name:'⏭ Step',exact:true}).click();
  await expect(page.locator('#hud')).toContainText(move.id);
  await expect(page.locator('#hud-hitboxes')).not.toContainText('engine error');
 }
 expect(errors).toEqual([]);
 await expect(page.locator('#moves')).not.toContainText('Temporary art');
});
