// Actual draft engine preview via keyboard and visible workbench testbed controls.
// This is not a finished match: missing animation rows remain explicitly unapproved.
import {chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1280,height:800}});
try{
  await page.goto('http://127.0.0.1:5173/testbed.html?id=david');
  await page.waitForFunction(()=>Number(document.querySelector('#hud .v')?.textContent)>1);
  await page.evaluate(()=>{
    const stream=document.querySelector('canvas').captureStream(60),chunks=[];
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9'});
    recorder.ondataavailable=event=>chunks.push(event.data);recorder.start();window.previewCapture={stream,recorder,chunks};
  });
  const frames=async count=>{
    const target=await page.evaluate(n=>Number(document.querySelector('#hud .v').textContent)+n,count);
    await page.waitForFunction(n=>Number(document.querySelector('#hud .v').textContent)>=n,target);
  };
  await frames(30);
  await page.keyboard.down('d');await frames(36);await page.keyboard.up('d');await frames(20);
  for(const name of ['Pigment Jab punch','Ribbon Reel cable','Pigment Cascade juggle','Wet-on-Wet ink','Painted Resonance sound']){
    await page.getByRole('button',{name,exact:true}).click();await frames(100);
  }
  const bytes=await page.evaluate(async()=>{
    const {recorder,stream,chunks}=window.previewCapture;
    await new Promise(resolve=>{recorder.onstop=resolve;recorder.stop();});stream.getTracks().forEach(track=>track.stop());
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
  await writeFile('generated/david-watercolor/engine-preview.webm',Buffer.from(bytes));
  console.log('Saved actual draft testbed preview; not a complete animation pack.');
}finally{await browser.close();}
