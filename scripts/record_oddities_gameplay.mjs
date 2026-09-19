/** Actual live canvas capture. Keyboard inputs only after match load; no
 * teleporting, forced hits, health edits, frame synthesis or debug startMove.
 * Both sides are choreographed initially, then P2 switches to normal CPU AI.
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const probe=process.argv.includes('--probe');
const take=process.argv.find(a=>a.startsWith('--take='))?.split('=')[1] ?? (probe?'probe':'take1');
if(!/^[a-z0-9-]+$/.test(take))throw new Error('Invalid take id');
const output=resolve('artifacts/roster-oddities',take);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto('http://127.0.0.1:5173/?p1=brine&p2=meridian&cpu=off');
  await page.waitForFunction(()=>Boolean(window.__stamptownDebug?.snapshot));
  await page.evaluate(()=>{
    const canvas=document.querySelector('canvas');
    const stream=canvas.captureStream(60);
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:6000000});
    const chunks=[], events=[];let previous='';
    const start=performance.now();
    const sample=()=>{
      if(recorder.state!=='recording')return;
      const state=window.__stamptownDebug.snapshot();
      const key=state.fighters.map(f=>[f.state,f.move,f.health].join(':')).join('|');
      if(key!==previous){events.push({seconds:(performance.now()-start)/1000,...state});previous=key;}
      requestAnimationFrame(sample);
    };
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    window.__capture={recorder,chunks,events,start,stream};recorder.start(1000);sample();
  });
  const beats=[];
  const mark=async label=>{const seconds=await page.evaluate(()=>(performance.now()-window.__capture.start)/1000);beats.push({seconds,label});console.log(`${seconds.toFixed(2)}s ${label}`);};
  const frames=async count=>{const target=await page.evaluate(n=>window.__stamptownDebug.frame()+n,count);await page.waitForFunction(t=>window.__stamptownDebug.frame()>=t,target,{timeout:20000});};
  const press=async(keys,wait)=>{for(const k of keys)await page.keyboard.down(k);await frames(2);for(const k of [...keys].reverse())await page.keyboard.up(k);await frames(wait);};
  const walk=async(count)=>{await page.keyboard.down('d');await frames(count);await page.keyboard.up('d');};
  await mark('Live engine / Brine vs Madame Meridian');await frames(60);
  if(process.argv.includes('--movement')){
    await mark('Dash into jump: new jump cancel after the four-tick commitment');
    await page.keyboard.down('d');await page.keyboard.down('Shift');await frames(5);
    await page.keyboard.up('Shift');await page.keyboard.up('d');
    await press(['w'],65);
    const states=await page.evaluate(()=>window.__capture.events.map(e=>e.fighters[0].state));
    if(!states.includes('dash')||!states.includes('airborne'))throw new Error('Dash/jump demonstration did not execute');
    await page.keyboard.down('d');
    await page.waitForFunction(()=>{const f=window.__stamptownDebug.snapshot().fighters;return Math.abs(f[0].x-f[1].x)<230;},null,{timeout:10000});
    await page.keyboard.up('d');
  }else await walk(58);
  await frames(12);
  await mark('Brine: video-derived tentacle capture, pull and release');await press(['h'],140);
  if(!probe){
    await mark('Meridian: ground-summoned binding cage');await press(['ArrowDown','l'],120);
    await mark('Meridian: sky-summoned needle');await press(['ArrowUp','l'],130);
    await mark('Meridian: rear-summoned stun needle');await press(['ArrowRight','l'],105);
    await mark('Brine: ink projectile stuns');await press(['s','h'],85);
    await page.keyboard.down('d');
    await page.waitForFunction(()=>{const f=window.__stamptownDebug.snapshot().fighters;return Math.abs(f[0].x-f[1].x)<58;},null,{timeout:10000});
    await page.keyboard.up('d');await frames(8);
    await mark('Close-range exchanges: punch and low kick');await press(['f'],28);await press(['g'],38);
    await page.keyboard.down('d');
    await page.waitForFunction(()=>{const f=window.__stamptownDebug.snapshot().fighters;return Math.abs(f[0].x-f[1].x)<58;},null,{timeout:10000});
    await page.keyboard.up('d');await frames(8);
    await mark('Close grab: catch, hold, throw');await press(['f','g'],130);
    await mark('Meridian: forward projectile knockback');await press(['l'],100);
    await mark('Brine blocks the next projectile');await page.keyboard.down('a');await press(['l'],90);await page.keyboard.up('a');await frames(10);
    await mark('Jump / airborne movement');await press(['w'],48);
    await mark('CPU enabled: live exchange');await press(['F2'],2);
    if(!await page.evaluate(()=>window.__stamptownDebug.snapshot().cpu))throw new Error('CPU toggle did not take effect');
    for(let i=0;i<5;i++){
      const s=await page.evaluate(()=>window.__stamptownDebug.snapshot());
      if(s.fighters.some(f=>f.health<=0))break;
      await walk(28);await press(i%2?['s','h']:['h'],82);
      if(i===2)await press(['w'],35);
    }
    await frames(40);
  }
  const result=await page.evaluate(async()=>{
    const c=window.__capture;
    await new Promise(resolve=>{c.recorder.onstop=resolve;c.recorder.stop();});
    c.stream.getTracks().forEach(t=>t.stop());
    const blob=new Blob(c.chunks,{type:'video/webm'});
    const bytes=Array.from(new Uint8Array(await blob.arrayBuffer()));
    return {bytes,events:c.events,duration:(performance.now()-c.start)/1000};
  });
  await writeFile(resolve(output,'capture.webm'),Buffer.from(result.bytes),{flag:'wx'});
  await writeFile(resolve(output,'telemetry.json'),JSON.stringify({format:'Live Phaser canvas, silent',control:'Real browser keyboard input; choreographed two-player sequence followed by CPU opponent. No forced outcomes.',duration:result.duration,beats,events:result.events,errors},null,2));
  await page.screenshot({path:resolve(output,'last-frame.png')});
  if(errors.length)throw new Error(errors.join('\n'));
  console.log(JSON.stringify({output,duration:result.duration,events:result.events.length,bytes:result.bytes.length}));
}finally{await browser.close();}
