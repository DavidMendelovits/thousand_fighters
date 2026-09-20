// Live engine capture with keyboard input only. No forced hits or teleports.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const out='generated/david';
await mkdir(out,{recursive:true});
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1280,height:720}});
try {
  await page.goto('http://127.0.0.1:5173/fight.html?p1=david&p2=brine&cpu=off');
  await page.waitForFunction(()=>window.__stamptownDebug?.snapshot);
  await page.evaluate(()=>{
    const stream=document.querySelector('canvas').captureStream(60),chunks=[],events=[];
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9'});
    recorder.ondataavailable=e=>chunks.push(e.data);
    recorder.start(); window.capture={recorder,stream,chunks,events};
    const sample=()=>{if(recorder.state!=='recording')return;events.push(window.__stamptownDebug.snapshot());requestAnimationFrame(sample);};sample();
  });
  const frames=async n=>{const target=await page.evaluate(n=>window.__stamptownDebug.frame()+n,n);await page.waitForFunction(t=>window.__stamptownDebug.frame()>=t,target);};
  const press=async(keys,n=70)=>{for(const k of keys)await page.keyboard.down(k);await frames(3);for(const k of keys)await page.keyboard.up(k);await frames(n);};
  await frames(40);
  await page.keyboard.down('d'); await frames(55); await page.keyboard.up('d'); await frames(10);
  await press(['a','h'],90); // Cable toss, wrap, pull and release.
  await press(['h'],70); // Cascade.
  await press(['s','h'],80); // Ink becomes a fist.
  await press(['d','h'],80); // Sound-wave pushback.
  await press(['F2'],1); // CPU takes over Brine.
  for(let i=0;i<4;i++) {
    await page.keyboard.down('d'); await frames(18); await page.keyboard.up('d');
    await press(i%2?['s','h']:['h'],55); await press(['f'],12); await press(['g'],25);
  }
  const result=await page.evaluate(async()=>{
    const c=window.capture;
    await new Promise(r=>{c.recorder.onstop=r;c.recorder.stop();}); c.stream.getTracks().forEach(t=>t.stop());
    return {bytes:Array.from(new Uint8Array(await new Blob(c.chunks).arrayBuffer())),events:c.events};
  });
  await writeFile(`${out}/gameplay.webm`,Buffer.from(result.bytes));
  await writeFile(`${out}/gameplay-telemetry.json`,JSON.stringify({control:'Keyboard inputs only; scripted opening then real CPU opponent. No forced outcomes.',events:result.events}));
  const states=result.events.flatMap(e=>e.fighters.map(f=>f.state));
  if(!states.includes('grabbed'))throw new Error('Demo did not capture a successful grab');
  console.log(`Saved live gameplay: ${out}/gameplay.webm`);
} finally {await browser.close();}
