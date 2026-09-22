import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {historyFixture} from './helpers/historyFixture.js';
const origin=process.env.STUDIO_BASE_URL??'http://127.0.0.1:5173';
test('grab release protection survives launch and knockdown until the victim can act',async({page})=>{
  await page.goto(`${origin}/?p1=latch&p2=brine&cpu=off&training=1`);await page.waitForFunction(()=>window.__stamptownDebug?.training);
  const frames=await page.evaluate(()=>{const d=window.__stamptownDebug;d.training.reset(300,353);d.startMove(2,'clinch');return Array.from({length:140},()=>{d.training.step(1);return d.snapshot().fighters[0];});});
  expect(frames.some(f=>f.state==='grabbed')).toBe(true);
  const released=frames.filter(f=>['juggle','knockdown','getup'].includes(f.state));expect(released.length).toBeGreaterThan(0);expect(released.every(f=>f.immunity===24)).toBe(true);
  const free=frames.find(f=>f.state==='idle'&&f.immunity>0);expect(free).toBeTruthy();
});
test('move inspector rejects a truncated active event then persists an unchanged valid move through UI',async({page},info)=>{
  const fixture=await historyFixture();
  try{
  // Authoring regression uses the real archived move in disposable storage.
  // The assertion must never rewrite Latch's preserved everyday CMS draft.
  const source=JSON.parse(await readFile('cms-data/characters/latch/draft/content.json','utf8'));
  const frameData=JSON.parse(await readFile('public/fighters/latch/frameData.json','utf8'));
  const frames=frameData.frames.special_2;
  for(const frame of frames)await fixture.runtime.storage.putBytes(`${fixture.pack}/${frame.file}`,await readFile(`public/fighters/latch/${frame.file}`),{contentType:'image/png'});
  const draft=await fixture.runtime.repository.getDraft(fixture.characterId);
  const spriteFrames={...draft.sprite.frames,special_2:frames};
  await fixture.runtime.storage.putJson(`${fixture.pack}/frameData.json`,{frames:spriteFrames});
  await fixture.runtime.repository.saveDraft(fixture.characterId,{...draft,moves:[source.moves.find(move=>move.id==='spare_key')],projectiles:source.projectiles,sprite:{...draft.sprite,frames:spriteFrames}});
  await page.goto(`${fixture.url}/roster/${fixture.characterId}?standalone=1`);
  await page.locator('[data-preview-row]').selectOption('special_2');
  const editor=page.locator('[data-move-inspector="spare_key"]');
  await page.locator('[data-move-card="special_2"] [data-move-tab="data"]').click();
  await editor.locator('summary').click();
  await editor.locator('[data-tune="phase-1"]').fill('1');
  await editor.getByRole('button',{name:'Save move & effect'}).click();
  await expect(editor.locator('[role="status"]')).toContainText('cut off');
  await editor.locator('[data-tune="phase-1"]').fill('2');
  await editor.getByRole('button',{name:'Save move & effect'}).click();
  await expect(editor.locator('[role="status"]')).toContainText('Saved to draft');
  await expect(editor.locator('[data-tune="stun"]')).toHaveValue('6');
  await expect(editor.locator('[data-fx="enabled"]')).toBeChecked();
  await editor.getByRole('button',{name:'Preview effect bounds'}).click();
  await editor.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('move-editor.png')});
  const saved=await fixture.runtime.repository.getDraft(fixture.characterId);
  expect(saved.moves.find(move=>move.id==='spare_key').phases[1].frames).toBe(2);
  }finally{await fixture.close();}
});
test('published separate effect, clinch and forced-control telemetry run in the actual engine',async({page},info)=>{
  await page.goto(`${origin}/?p1=latch&p2=brine&cpu=off&training=1`);
  await page.waitForFunction(()=>window.__stamptownDebug?.control);
  const result=await page.evaluate(()=>{const d=window.__stamptownDebug;d.training.reset(300,353);d.startMove(1,'lock_clinch');const states=[];for(let i=0;i<55;i++){d.training.step(1);states.push(d.snapshot());}return {states,control:d.control()};});
  expect(result.states.some(s=>s.fighters[1].state==='grabbed')).toBe(true);
  expect(result.control.players[1].ticks.grab).toBeGreaterThan(0);
  expect(result.states.at(-1).fighters[1].state).not.toBe('grabbed');
  const frames=await page.evaluate(()=>{const d=window.__stamptownDebug;d.training.reset(300,560);d.startMove(1,'spare_key');return Array.from({length:40},()=>{d.training.step(1);return d.snapshot();});});
  expect(frames.some(s=>s.impacts.some(i=>i.id==='spare_key_authored_fx'))).toBe(true);
  expect(frames.at(-1).impacts.some(i=>i.id==='spare_key_authored_fx')).toBe(false);
  await page.evaluate(()=>window.__stamptownDebug.training.step(30));
  expect(await page.evaluate(()=>window.__stamptownDebug.snapshot().impacts)).toHaveLength(0);
  await page.locator('.control-telemetry summary').click();
  const before=await page.evaluate(()=>window.__stamptownDebug.control().totalTicks);
  await page.waitForTimeout(150);
  expect(await page.evaluate(()=>window.__stamptownDebug.control().totalTicks)).toBe(before);
  for(const p of await page.evaluate(()=>window.__stamptownDebug.control().players))expect(Object.values(p.ticks).reduce((a,b)=>a+b,0)).toBe(before);
  await page.screenshot({path:info.outputPath('control-meter.png')});
  await page.locator('.control-telemetry button').click();expect(await page.evaluate(()=>window.__stamptownDebug.control().totalTicks)).toBe(0);
});
