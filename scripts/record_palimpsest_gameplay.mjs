/** Actual live canvas capture, driven only by browser keyboard input. */
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const take=process.argv[2]??'take1';if(!/^[a-z0-9-]+$/.test(take))throw new Error('Invalid take');
const opponent=process.argv[3]??'brine';if(!/^[a-z][a-z0-9_]+$/.test(opponent))throw new Error('Invalid opponent');
const output=`generated/palimpsest/gameplay-${take}`;await mkdir(output,{recursive:true});
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(`http://127.0.0.1:5173/?p1=palimpsest&p2=${opponent}&cpu=off`);
 await page.waitForFunction(()=>window.__stamptownDebug?.summons);
 await page.evaluate(()=>{
  const stream=document.querySelector('canvas').captureStream(60),chunks=[],events=[];
  const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:6000000});
  const start=performance.now();let previous='';
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  window.__paintCapture={recorder,chunks,events,start,stream};recorder.start(500);
  function sample(){if(recorder.state!=='recording')return;const d=window.__stamptownDebug,s=d.snapshot(),summons=d.summons();const key=JSON.stringify([s.fighters.map(f=>[f.state,f.move,f.health]),summons.map(s=>s?.actor)]);if(key!==previous){events.push({seconds:(performance.now()-start)/1000,...s,summons});previous=key;}requestAnimationFrame(sample);}sample();
 });
 const beats=[];
 const mark=async label=>{beats.push({seconds:await page.evaluate(()=>(performance.now()-window.__paintCapture.start)/1000),label});console.log(label);};
 const frames=async n=>{const target=await page.evaluate(n=>window.__stamptownDebug.frame()+n,n);await page.waitForFunction(t=>window.__stamptownDebug.frame()>=t,target,{timeout:15000});};
 const hold=async(keys,n)=>{await Promise.all(keys.map(k=>page.keyboard.down(k)));await frames(n);await Promise.all(keys.map(k=>page.keyboard.up(k)));};
 const press=async(keys,n=35)=>{await hold(keys,2);await frames(n);};
 const approach=async gap=>{await page.keyboard.down('d');await page.waitForFunction(g=>{const f=window.__stamptownDebug.snapshot().fighters;return f[1].x-f[0].x<g;},gap,{timeout:10000});await page.keyboard.up('d');await frames(8);};
 await mark(`Palimpsest versus ${opponent}: live gameplay, browser keyboard inputs`);await frames(40);
 await mark('Paint flows forward; no human gait');await approach(160);
 await mark('Borrowed Hands: Down + H transfers control for four seconds');await press(['s','h'],36);
 if(!(await page.evaluate(()=>window.__stamptownDebug.summons()[0])))throw new Error('Summon did not activate');
 await mark('Directional input moves only the floating hands');await hold(['d'],9);await frames(6);
 await mark('F: remote needle thrust');await press(['f'],31);
 await hold(['d'],9);
 await mark('G: hands capture and throw');await press(['g'],45);
 await mark('Hands move vertically; H recalls them');await hold(['w'],14);await press(['h'],20);
 await mark('Body control restored: approach and ribbon attacks');await approach(60);
 await press(['f'],10);await press(['g'],30);await press(['h'],52);
 await mark('Long paint tether: F + G');await approach(115);await press(['f','g'],85);
 await mark('Opponent retaliates with a live heavy attack');await press(['l'],110);
 await mark('Crouch melts to a pool, jump stretches into a teardrop');await hold(['s'],28);await press(['w'],60);
 await mark('Diamond guard: hold back');await hold(['a'],40);await frames(8);
 await mark('Branching ochre strike: Down + F');await press(['s','f'],55);
 await mark('Second summon expires naturally');await press(['s','h'],35);await hold(['d'],15);await press(['f'],35);await frames(200);
 await mark('CPU opponent enabled for the final exchange');await press(['F2'],4);
 for(let i=0;i<5;i++){await hold(['d'],18);await press(i%2?['g']:['h'],45);}
 await frames(25);
 const result=await page.evaluate(async()=>{const c=window.__paintCapture;await new Promise(r=>{c.recorder.onstop=r;c.recorder.stop();});c.stream.getTracks().forEach(t=>t.stop());return {bytes:Array.from(new Uint8Array(await new Blob(c.chunks,{type:'video/webm'}).arrayBuffer())),events:c.events,duration:(performance.now()-c.start)/1000};});
 await writeFile(`${output}/capture.webm`,Buffer.from(result.bytes),{flag:'wx'});
 await writeFile(`${output}/telemetry.json`,JSON.stringify({control:'Real browser keyboard inputs. Choreographed two-player opening, then CPU. No forced moves, hits, positions or health edits.',beats,errors,events:result.events,duration:result.duration},null,2));
 await page.screenshot({path:`${output}/last-frame.png`});
 const moves=new Set(result.events.flatMap(e=>e.fighters.map(f=>f.move)).filter(Boolean));
 for(const move of ['summon','needle_thrust','hands_pinch','hands_recall','bind'])if(!moves.has(move))throw new Error(`Missing gameplay move ${move}`);
 if(errors.length)throw new Error(errors.join('\n'));
 console.log(JSON.stringify({output,duration:result.duration,moves:[...moves]}));
}finally{await browser.close();}
