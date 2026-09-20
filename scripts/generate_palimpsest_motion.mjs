import {access,readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {runVideoJob} from './generate_animation_video.mjs';
import {palimpsestMotion} from '../shared/palimpsestMotion.js';
const exec=promisify(execFile);
const selected=process.argv.slice(2);
const version=process.env.PAINT_MOTION_VERSION??'motion-v3';
if(!/^motion-v\d+$/.test(version))throw new Error('Invalid motion version');
const queue=Object.entries(palimpsestMotion).filter(([id])=>!selected.length||selected.includes(id));
const errors=[];
async function worker(){for(;;){const entry=queue.shift();if(!entry)return;
 const [action,motion]=entry,kind=action.startsWith('hands_')||action==='needle_thrust'?'hands':'body';
 const base=`generated/palimpsest/${kind}-v3`,output=`generated/palimpsest/${version}/${action}-source`,compiled=`generated/palimpsest/${version}/${action}`;
 try{
  try{await access(`${compiled}/motion.json`);console.log(`${action}: existing compiled candidate`);continue;}catch{}
  let resume=false;try{await access(`${output}/job.json`);resume=true;}catch{}
  const prompt=`Animate only this exact painted ${kind==='hands'?'pair of floating hands and needle':'nonhuman spiral paint creature'}. ${motion} Preserve the exact original painted identity, palette and brush contours. Thick liquid paint deforms continuously, not skeletal animation. Fixed side camera, entire subject always visible with generous margins. Background stays pure uniform white, identical to the reference. Finish in the exact original arrangement.`;
  const reference=process.env.PAINT_WIDE_REFERENCE==='1'?`${base}/video-wide.png`:`${base}/video-white.png`;
  await runVideoJob(resume?{resume:output}:{provider:'pruna',mode:'image-to-video',image:reference,'end-image':reference,prompt,duration:5,resolution:'768p',recipe:'quality',output},{characterId:'palimpsest',moveId:action});
  await exec('python3',['scripts/compile_character_motion.py',`${output}/source.mp4`,'--reference',`${base}/body.png`,'--output',compiled,'--action',action,'--frames','24','--style','watercolor','--component-mode','all','--root-mode','fixed','--expand-canvas','--background','paint-auto'],{maxBuffer:2e6});
  console.log(`${action}: compiled, awaiting visual review`);
 }catch(e){errors.push({action,error:e.message});console.error(`${action}: ${e.message}`);}
}}
await Promise.all([worker(),worker()]);
console.log(JSON.stringify({errors}));if(errors.length)process.exitCode=1;
