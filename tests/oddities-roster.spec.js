import {test,expect} from '@playwright/test';
const origin='http://127.0.0.1:5173';
async function arena(page,p1='brine',p2='meridian'){
  await page.goto(`${origin}/?p1=${p1}&p2=${p2}&cpu=off&training=1`);
  await page.waitForFunction(()=>Boolean(window.__stamptownDebug?.training));
}
async function execute(page,player,move,ticks,x1=240,x2=430){return page.evaluate(({player,move,ticks,x1,x2})=>{const d=window.__stamptownDebug;d.training.reset(x1,x2);d.startMove(player,move);d.training.step(ticks);return d.snapshot();},{player,move,ticks,x1,x2});}
test('roster selection, moves, video provenance and mobile layout',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${origin}/roster.html`);await expect(page.locator('.card')).toHaveCount(10);
  await page.getByRole('button',{name:'02 / OPPONENT'}).click();
  await page.getByRole('button',{name:'Select Taffy Riot for player 2'}).click();
  await expect(page.locator('#versus')).toContainText('Brine  /  Taffy Riot');
  await expect(page.locator('#dossier')).toContainText('VIDEO-DERIVED');
  await expect(page.locator('#fight')).toHaveAttribute('href',/p1=brine&p2=taffy/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('roster.png'),fullPage:true});expect(errors).toEqual([]);
});
test('tentacle actually captures, pulls, releases and deals damage only once',async({page},info)=>{
  await arena(page);let s=await execute(page,1,'tidal_reach',30);
  expect(s.fighters[0].animation).toBe('video_signature');expect(s.fighters[1].state).toBe('grabbed');expect(s.fighters[1].health).toBe(830);expect(s.fighters[1].x).toBeLessThan(430);
  await page.screenshot({path:info.outputPath('tentacle-capture.png')});
  s=await page.evaluate(()=>{const d=window.__stamptownDebug;d.training.step(45);return d.snapshot();});
  expect(s.fighters[1].state).not.toBe('grabbed');expect(s.fighters[1].health).toBe(830);expect(s.fighters[1].x).toBeGreaterThan(s.fighters[0].x+80);
});
test('floor cage persists after caster recovers, then releases',async({page})=>{
  await arena(page);const s=await execute(page,2,'ground_stitch',64);
  expect(s.fighters[0].state).toBe('grabbed');expect(s.fighters[1].state).toBe('idle');expect(s.fighters[0].health).toBe(1080-Math.round(65*1.1));
  const later=await page.evaluate(()=>{const d=window.__stamptownDebug;d.training.step(60);return d.snapshot();});expect(later.fighters[0].state).not.toBe('grabbed');
});
test('sky and rear summons land; ink applies stun; close throw launches',async({page})=>{
  await arena(page);let s=await execute(page,2,'sky_needle',78);expect(s.fighters[0].health).toBeLessThan(1080);
  s=await execute(page,2,'backstitch',60);expect(s.fighters[0].state).toBe('stunned');
  s=await execute(page,1,'ink_bell',49,240,410);expect(s.fighters[1].state).toBe('stunned');expect(s.fighters[1].vx).toBe(0);
  s=await execute(page,1,'clinch',18,300,365);expect(s.fighters[1].state).toBe('grabbed');
  s=await page.evaluate(()=>{const d=window.__stamptownDebug;d.training.step(25);return d.snapshot();});expect(s.fighters[1].state).toBe('juggle');expect(s.fighters[1].y).toBeLessThan(390);
});
test('all ten fighters load their video signature and packaged frames in the engine',async({page,request})=>{
  const roster=await (await request.get(`${origin}/oddities-roster.json`)).json();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400 && r.url().includes('/fighters/'))errors.push(`${r.status()} ${r.url()}`);});
  for(let i=0;i<roster.length;i+=2){
    const pair=roster.slice(i,i+2);await arena(page,pair[0].id,pair[1].id);
    for(let p=0;p<2;p++){
      const move=pair[p].moves.find(m=>m.animation==='video_signature');expect(move).toBeTruthy();
      const state=await execute(page,p+1,move.id,20,220,580);
      expect(state.fighters[p].animation).toBe('video_signature');
    }
  }
  expect(errors).toEqual([]);
});
test('F2 enables a CPU that actually issues attacks',async({page})=>{
  await page.goto(`${origin}/?p1=brine&p2=meridian&cpu=off`);
  await page.waitForFunction(()=>Boolean(window.__stamptownDebug?.snapshot));
  expect(await page.evaluate(()=>window.__stamptownDebug.snapshot().cpu)).toBe(false);
  await page.keyboard.down('F2');
  await page.waitForFunction(()=>window.__stamptownDebug.snapshot().cpu);
  await page.keyboard.up('F2');
  await page.waitForFunction(()=>window.__stamptownDebug.snapshot().fighters[1].state==='attack');
});
