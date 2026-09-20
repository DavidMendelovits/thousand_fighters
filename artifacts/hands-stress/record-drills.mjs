// Actual UI-driven recording. Requires dev/CMS servers and agent-browser.
// No gameplay state injection via eval: eval below operates only the range input.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const output=fileURLToPath(new URL('.',import.meta.url));
const session='hands-stress-final';
const ui=(...args)=>execFileSync('agent-browser',['--session',session,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
function waitFor(expression){
  for(let attempt=0;attempt<3;attempt++){
    try{return ui('wait','--fn',expression);}
    catch(error){if(attempt===2||!String(error.stderr).includes('Wait timed out'))throw error;console.log('Still loading the saved draft; waiting, no resubmission.');}
  }
}
const idleWithSummon='Array.from(document.querySelectorAll("#hud .k")).find(e=>e.textContent==="move").nextElementSibling.textContent==="—" && Array.from(document.querySelectorAll("#hud .k")).find(e=>e.textContent==="summon ticks").nextElementSibling.textContent!=="None"';
ui('open','http://127.0.0.1:5173/testbed.html?id=palimpsest');
ui('set','viewport','1440','1000');
ui('record','start',`${output}stress-drills.webm`);
try{
  waitFor('document.querySelector("#hud").textContent.includes("dummy state")');
  console.log('Draft ready; beginning drills.');
  ui('click','[data-dummy=reactive]');ui('click','[data-mode=slow]');
  ui('eval','const el=document.querySelector("#distance");el.value="148";el.dispatchEvent(new Event("input",{bubbles:true}));');
  for(const [layout,injection] of [['left-wall',null],['right-wall',null],['center-left','inject-hit'],['center-right','force-ko'],['center-right','expire-summon']]){
    ui('click','#reset-btn');ui('select','#scenario-layout',layout);
    ui('click','[title="Trigger summon"]');ui('wait','--fn',idleWithSummon);
    ui('click','[title="Trigger hands_pinch"]');ui('wait','--fn','document.querySelector("#hud").textContent.includes("grabbed")');
    ui('wait','650');
    ui('screenshot',`${output}${injection??layout}-held.png`);
    if(injection){
      // Pause while revealing the test control so the injection occurs mid-hold.
      ui('click','[data-mode=pause]');
      if(ui('eval','document.querySelector("#intervention-status").closest("details").open').trim()==='false')ui('click','summary');
      ui('click',`#${injection}`);ui('click','[data-mode=slow]');
    }
    ui('wait','--fn','!document.querySelector("#hud").textContent.includes("grabbed")');
    ui('wait','1200');
    console.log(`${layout} / ${injection??'natural release'}\n${ui('get','text','#hud')}`);
  }
  ui('click','#reset-btn');ui('wait','1000');
}finally{console.log(ui('record','stop'));}
