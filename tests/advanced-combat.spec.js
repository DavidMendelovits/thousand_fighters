import {test,expect} from '@playwright/test';
const origin='http://127.0.0.1:5173';
async function arena(page,p1='brine',p2='meridian'){
  await page.goto(`${origin}/?p1=${p1}&p2=${p2}&cpu=off&training=1`);await page.waitForFunction(()=>window.__stamptownDebug?.training);
  await page.evaluate(()=>window.__stamptownDebug.training.reset(300,360));
}
const snapshot=page=>page.evaluate(()=>window.__stamptownDebug.snapshot());
test('keyboard hit confirms branch punch into kick into projectile as a true three-hit combo',async({page})=>{
  await arena(page);
  const step=async(n=1)=>page.evaluate(n=>window.__stamptownDebug.training.step(n),n);
  const press=async key=>{await page.keyboard.down(key);await step();await page.keyboard.up(key);};
  const untilHit=async hits=>{for(let i=0;i<55;i++){if((await snapshot(page)).fighters[1].combo.hits>=hits)return;await step();}throw new Error(`Missing combo hit ${hits}: ${JSON.stringify(await snapshot(page))}`);};
  await press('f');await untilHit(1);await press('g');await untilHit(2);
  await page.keyboard.down('s');await press('h');await step(8);await page.keyboard.up('s');await untilHit(3);
  const s=await snapshot(page);expect(s.fighters[1].combo.active).toBe(true);expect(s.fighters[1].combo.hits).toBe(3);
});
test('timed form keeps its own textures through attacks, hurt, idle and exact expiry',async({page},info)=>{
  await arena(page);await page.keyboard.down('q');await page.evaluate(()=>window.__stamptownDebug.training.step(1));await page.keyboard.up('q');
  let s=await snapshot(page);expect(s.fighters[0].id).toBe('brine_abyssal');expect(s.fighters[0].texture).toMatch(/^brine_abyssal:/);expect(s.fighters[0].hurtbox.width).toBeCloseTo(44*1.3);
  const hp=s.fighters[0].health;
  s=await page.evaluate(()=>{const d=window.__stamptownDebug;d.startMove(1,'form_breaker');d.training.step(65);return d.snapshot();});expect(s.fighters[0].texture).toMatch(/^brine_abyssal:/);expect(s.fighters[0].moveIds).not.toContain('clinch');
  const hurtFrames=await page.evaluate(()=>{const d=window.__stamptownDebug;d.startMove(2,'thread_needle');return Array.from({length:55},()=>{d.training.step(1);return d.snapshot().fighters[0];});});
  expect(hurtFrames.every(f=>f.texture.startsWith('brine_abyssal:'))).toBe(true);expect(hurtFrames.some(f=>['hitstun','juggle'].includes(f.state))).toBe(true);
  s=await snapshot(page);expect(s.fighters[0].form).toBe('brine_abyssal');expect(s.fighters[0].texture).toMatch(/^brine_abyssal:/);expect(s.fighters[0].health).toBeLessThan(hp);
  await page.screenshot({path:info.outputPath('persistent-form.png')});
  await page.evaluate(()=>{const d=window.__stamptownDebug;const remaining=d.snapshot().fighters[0].formTicks;d.training.step(Math.min(600,remaining-1));});
  s=await snapshot(page);if(s.fighters[0].formTicks>1)await page.evaluate(()=>{const d=window.__stamptownDebug;d.training.step(d.snapshot().fighters[0].formTicks-1);});
  expect((await snapshot(page)).fighters[0].form).toBe('brine_abyssal');await page.evaluate(()=>window.__stamptownDebug.training.step(1));
  s=await snapshot(page);expect(s.fighters[0].id).toBe('brine');expect(s.fighters[0].texture).toMatch(/^brine:/);expect(s.fighters[0].health).toBeLessThanOrEqual(hp);
});
test('until-KO form persists past 20 seconds and reverts only on knockout',async({page})=>{
  await arena(page,'taffy');await page.evaluate(()=>{const d=window.__stamptownDebug;d.training.form(1,'taffy_sugarstorm');d.training.step(600);d.training.step(600);d.training.step(60);});
  let s=await snapshot(page);expect(s.fighters[0].id).toBe('taffy_sugarstorm');expect(s.fighters[0].formTicks).toBeNull();expect(s.fighters[0].texture).toMatch(/^taffy_sugarstorm:/);
  await page.evaluate(()=>window.__stamptownDebug.training.damage(1,9999));s=await snapshot(page);expect(s.fighters[0].id).toBe('taffy');expect(s.fighters[0].state).toBe('dead');expect(s.fighters[0].health).toBe(0);
});
test('power-up refreshes instead of stacking and expiry restores stats and size',async({page})=>{
  await arena(page);const result=await page.evaluate(()=>{const d=window.__stamptownDebug,p={id:'test',name:'Test',cost:0,durationTicks:20,modifiers:{attack:1.5,size:1.4,projectileDefense:2}};d.training.power(1,p);d.training.power(1,p);const before=d.snapshot();d.training.step(20);return {before,after:d.snapshot()};});
  expect(result.before.fighters[0].stats.attack).toBe(1.5);expect(result.before.fighters[0].powers).toHaveLength(1);expect(result.before.fighters[0].hurtbox.width).toBeCloseTo(44*1.4);expect(result.after.fighters[0].stats.size).toBe(1);expect(result.after.fighters[0].powers).toHaveLength(0);
});
test('real keyboard dash and diagonal air dodge land in a momentum-carrying wavedash',async({page})=>{
  await page.goto(`${origin}/?p1=brine&p2=meridian&cpu=off`);await page.waitForFunction(()=>window.__stamptownDebug?.snapshot);
  await page.keyboard.down('d');await page.keyboard.down('Shift');await page.waitForFunction(()=>window.__stamptownDebug.snapshot().fighters[0].state==='dash');await page.keyboard.up('Shift');await page.keyboard.up('d');
  await page.waitForFunction(()=>window.__stamptownDebug.snapshot().fighters[0].state==='idle');
  await page.keyboard.down('w');await page.waitForFunction(()=>window.__stamptownDebug.snapshot().fighters[0].y<380);await page.keyboard.up('w');
  await page.keyboard.down('s');await page.keyboard.down('d');await page.keyboard.down('Shift');
  await page.waitForFunction(()=>window.__stamptownDebug.snapshot().fighters[0].state==='wavedash');
  const s=await snapshot(page);expect(s.fighters[0].vx).toBeGreaterThan(2.8);expect(s.fighters[0].y).toBe(390);
  await page.keyboard.up('Shift');await page.keyboard.up('s');await page.keyboard.up('d');
});
test('projectile contact produces its own authored impact, and cleanup is bounded',async({page})=>{
  await arena(page);const states=await page.evaluate(()=>{const d=window.__stamptownDebug;d.training.reset(300,420);d.startMove(1,'ink_bell');const states=[];for(let i=0;i<65;i++){d.training.step(1);states.push(d.snapshot());}return states;});
  expect(states.some(s=>s.impacts.some(i=>i.id==='ink_bell_impact'&&i.kind==='ink'))).toBe(true);
  expect(states.at(-1).impacts).toHaveLength(0);
});
