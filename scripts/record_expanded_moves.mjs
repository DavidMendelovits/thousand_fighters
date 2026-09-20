// Records visible testbed controls driving real engine playback, not a match.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const ab=async(...args)=>{const r=await exec('agent-browser',['--session','david-motion',...args],{timeout:60000,maxBuffer:1e6});console.log(r.stdout.trim());};
await ab('open','http://127.0.0.1:5173/testbed.html?id=david');
await ab('wait','--text','player hp');
await ab('set','viewport','1280','800');
await ab('record','start',process.argv[2]??'generated/david-watercolor/expanded-moves-demo.webm');
await ab('wait','--fn',"Number(document.querySelector('#hud .v')?.textContent)>1");
const {config}=await (await fetch('http://127.0.0.1:8787/api/characters/david/runtime-config')).json();
const titles=config.moves.filter(m=>m.requiredAnimation).map(m=>`Trigger ${m.id}`);
try{
 await ab('eval',`(async()=>{
  document.querySelector('[data-mode="play"]').click();
  const titles=${JSON.stringify(titles)};
  const buttons=[...document.querySelectorAll('#moves button.move')].filter(b=>titles.includes(b.title));
  const observed=[];
  for(const button of buttons){
   button.click();
   const start=Number(document.querySelector('#hud .v').textContent);
   await new Promise((resolve,reject)=>{const began=performance.now();function next(){if(Number(document.querySelector('#hud .v').textContent)>=start+80)return resolve();if(performance.now()-began>6000)return reject(new Error('Engine playback stalled'));requestAnimationFrame(next);}next();});
   observed.push(button.textContent);
  }
  return observed;
 })()`);
}finally{await ab('record','stop');}
