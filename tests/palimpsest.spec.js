import {test,expect} from '@playwright/test';
const snap=p=>p.evaluate(()=>({state:window.__stamptownDebug.snapshot(),summons:window.__stamptownDebug.summons()}));
const step=(p,n)=>p.evaluate(n=>window.__stamptownDebug.training.step(n),n);
async function press(p,keys,n=1){for(const k of keys)await p.keyboard.down(k);await step(p,n);for(const k of keys)await p.keyboard.up(k);}
async function open(p,x=250,y=550){await p.goto('http://127.0.0.1:5173/?p1=palimpsest&p2=brine&cpu=off&training=1');await p.waitForFunction(()=>window.__stamptownDebug?.training);await p.evaluate(([x,y])=>window.__stamptownDebug.training.reset(x,y),[x,y]);}
async function summon(p){await press(p,['s','h']);await step(p,36);expect((await snap(p)).summons[0]?.actor).toBe('hands');}
test('summon redirects movement and attacks; recall returns input without leakage',async({page})=>{
 await open(page);await summon(page);const before=await snap(page);
 await press(page,['d','w'],15);const moved=await snap(page);
 expect(moved.state.fighters[0].x).toBe(before.state.fighters[0].x);
 expect(moved.summons[0].x).toBeGreaterThan(before.summons[0].x);
 expect(moved.summons[0].y).toBeLessThan(before.summons[0].y);
 await press(page,['f']);expect((await snap(page)).state.fighters[0].move).toBe('needle_thrust');
 await step(page,30);await press(page,['h']);await step(page,8);expect((await snap(page)).summons[0]).toBeNull();
 await press(page,['d'],12);expect((await snap(page)).state.fighters[0].x).toBeGreaterThan(before.state.fighters[0].x);
});
test('timer expires exactly and KO/reset clear the actor',async({page})=>{
 await open(page);await summon(page);let s=await snap(page);const remaining=s.summons[0].remaining;
 await step(page,remaining-1);expect((await snap(page)).summons[0].remaining).toBe(1);
 await step(page,1);expect((await snap(page)).summons[0]).toBeNull();
 await page.evaluate(()=>window.__stamptownDebug.training.reset(250,550));await summon(page);
 await page.evaluate(()=>window.__stamptownDebug.training.reset(250,550));expect((await snap(page)).summons[0]).toBeNull();
 await page.evaluate(()=>window.__stamptownDebug.training.reset(250,550));await summon(page);
 await page.evaluate(()=>window.__stamptownDebug.training.damage(1,9999));expect((await snap(page)).summons[0]).toBeNull();
});
test('floating hand grab releases away from the hands after crossing behind the opponent',async({page})=>{
 await open(page,250,420);await summon(page);await press(page,['d'],29);
 expect((await snap(page)).summons[0].x).toBeGreaterThan(420);
 await press(page,['g']);let captured=false,released=false;
 for(let i=0;i<50;i++){await step(page,1);const f=(await snap(page)).state.fighters[1];if(f.state==='grabbed')captured=true;if(captured&&f.state==='juggle'){expect(f.vx).toBeLessThan(0);released=true;break;}}
 expect(captured).toBe(true);expect(released).toBe(true);
});
test('needle damages from the remote actor and incoming hits dismiss hands',async({page})=>{
 await open(page,250,420);await summon(page);
 await press(page,['d'],8);await press(page,['f']);await step(page,35);
 expect((await snap(page)).state.fighters[1].health).toBeLessThan(1080);
 await page.evaluate(()=>window.__stamptownDebug.training.reset(300,360));await summon(page);
 await press(page,['j']);await step(page,35);
 expect((await snap(page)).summons[0]).toBeNull();expect((await snap(page)).state.fighters[0].health).toBeLessThan(950);
});
test('grip lifts the actual opponent and keeps the visible hands on its torso',async({page})=>{
 await open(page,250,420);await summon(page);await press(page,['d'],16);await press(page,['g']);
 const held=[];
 for(let i=0;i<40;i++){
  await step(page,1);const s=await snap(page),f=s.state.fighters[1];
  if(f.state==='grabbed'){
   held.push(f);
   if(held.length===12)await page.screenshot({path:'generated/palimpsest/grip-review.png'});
  }
 }
 expect(held.length).toBeGreaterThan(15);
 expect(Math.max(...held.map(f=>f.y))-Math.min(...held.map(f=>f.y))).toBeGreaterThan(20);
 expect(Math.max(...held.map(f=>f.x))-Math.min(...held.map(f=>f.x))).toBeGreaterThan(15);
 expect((await snap(page)).state.fighters[1].state).not.toBe('grabbed');
});
test('KO of the summoner drops an attached opponent without leaving a stuck hold',async({page})=>{
 await open(page,250,420);await summon(page);await press(page,['d'],16);await press(page,['g']);
 for(let i=0;i<20&&(await snap(page)).state.fighters[1].state!=='grabbed';i++)await step(page,1);
 expect((await snap(page)).state.fighters[1].state).toBe('grabbed');
 await page.evaluate(()=>window.__stamptownDebug.training.damage(1,9999));await step(page,1);
 expect((await snap(page)).summons[0]).toBeNull();
 expect((await snap(page)).state.fighters[1].state).not.toBe('grabbed');
});
test('published star reach connects beyond the old coil-sized contact',async({page})=>{
 await open(page,250,450);
 await press(page,['h']);await step(page,35);
 expect((await snap(page)).state.fighters[1].health).toBeLessThan(1080);
 await page.evaluate(()=>window.__stamptownDebug.training.reset(250,530));
 await press(page,['h']);await step(page,35);
 expect((await snap(page)).state.fighters[1].health).toBe(1080);
});
