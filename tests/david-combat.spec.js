import { test, expect } from '@playwright/test';

async function arena(page, x2=360) {
  await page.goto('http://127.0.0.1:5173/fight.html?p1=david&p2=brine&cpu=off&training=1');
  await page.waitForFunction(()=>window.__stamptownDebug?.training);
  await page.evaluate(x=>window.__stamptownDebug.training.reset(300,x), x2);
}
const snap = page=>page.evaluate(()=>window.__stamptownDebug.snapshot());
const step = (page,n=1)=>page.evaluate(n=>window.__stamptownDebug.training.step(n),n);
async function press(page,key) { await page.keyboard.down(key); await step(page); await page.keyboard.up(key); }
async function hits(page,n) {
  for(let i=0;i<65;i++) { if((await snap(page)).fighters[1].combo.hits>=n)return; await step(page); }
  throw new Error(`Expected ${n} hits: ${JSON.stringify(await snap(page))}`);
}
test('David loads his own art and normal-to-cascade combo via keyboard',async({page})=>{
  await arena(page); expect((await snap(page)).fighters[0].texture).toMatch(/^david:/);
  await press(page,'f'); await hits(page,1); await press(page,'g'); await hits(page,2); await press(page,'h'); await hits(page,3);
  expect((await snap(page)).fighters[1].combo.active).toBe(true);
});
for(const ender of ['sound','ink']) test(`ball hit confirms into ${ender} through directional input`,async({page})=>{
  await arena(page,405); await press(page,'h'); await hits(page,1);
  await page.keyboard.down(ender==='sound'?'d':'s'); await press(page,'h'); await page.keyboard.up(ender==='sound'?'d':'s');
  await step(page,3); // Input buffered during the projectile's impact hitstop.
  expect((await snap(page)).fighters[0].move).toBe(ender==='sound'?'sound_wave':'ink_construct');
  await hits(page,2);
});
test('mic travels, wraps, pulls opponent toward David, and releases',async({page},info)=>{
  await arena(page,525);
  await page.keyboard.down('a'); await press(page,'h'); await page.keyboard.up('a');
  let held;
  for(let i=0;i<50;i++) { const s=await snap(page); if(s.fighters[1].state==='grabbed'){held=s;break;} await step(page); }
  expect(held?.fighters[1].heldBy).toBe('david');
  await step(page,10); const pulled=await snap(page);
  expect(pulled.fighters[1].x).toBeLessThan(held.fighters[1].x-30);
  await page.screenshot({path:info.outputPath('mic-wrap.png')});
  await step(page,45); expect((await snap(page)).fighters[1].heldBy).toBeUndefined();
});
test('ink morph and distinct impact, three balls and wave pushback are real projectiles',async({page})=>{
  await arena(page,650);
  const balls=await page.evaluate(()=>{const d=window.__stamptownDebug;d.startMove(1,'cascade');d.training.step(30);return d.snapshot().projectiles;});
  expect(balls).toHaveLength(3); expect(new Set(balls.map(b=>b.y)).size).toBe(3);
  await page.evaluate(()=>window.__stamptownDebug.training.reset(300,490));
  const states=await page.evaluate(()=>{const d=window.__stamptownDebug;d.startMove(1,'ink_construct');return Array.from({length:65},()=>{d.training.step(1);return d.snapshot();});});
  expect(states.some(s=>s.impacts.some(i=>i.id==='ink_construct_impact'&&i.kind==='ink'))).toBe(true);
  expect(states.some(s=>s.fighters[1].state==='juggle')).toBe(true);
  await page.evaluate(()=>window.__stamptownDebug.training.reset(300,410));
  await page.evaluate(()=>{const d=window.__stamptownDebug;d.startMove(1,'sound_wave');d.training.step(45);});
  expect((await snap(page)).fighters[1].x).toBeGreaterThan(440);
});
test('reel release links into juggling without an infinite grab lock',async({page})=>{
  await arena(page,490); await page.keyboard.down('a'); await press(page,'h'); await page.keyboard.up('a');
  let captured=false,released=false;
  for(let i=0;i<85;i++) {
    const s=await snap(page); if(s.fighters[1].state==='grabbed')captured=true;
    if(captured&&s.fighters[1].state!=='grabbed'){released=true;break;} await step(page);
  }
  expect(released).toBe(true); await press(page,'h'); await step(page,3);
  expect((await snap(page)).fighters[0].move).toBe('cascade'); await hits(page,2);
});
