import {execFileSync} from 'node:child_process';
import {mkdtemp, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const root = path.dirname(new URL(import.meta.url).pathname);
const temp = await mkdtemp(path.join(os.tmpdir(), 'latch-demo-'));
// All segments are actual agent-browser captures at 1x. Only idle/provider
// waits and debugging are cut. The edit does not simulate application actions.
const edits = [
 ['01-create-generate',11,13,'01  New Fighter - created through the workbench'],
 ['01-create-generate',32,14,'02  Enter the concept and create the character draft'],
 ['01-create-generate',54,9,'03  Draft returned - four authored moves and a projectile'],
 ['01-create-generate',84,9,'04  Generate the base art in the interface'],
 ['01-create-generate',172,12,'05  Base generation completes - provider wait cut'],
 ['02-motion-authoring',42,10,'06  Select Video motion and generate the key jab'],
 ['02-motion-authoring',56,7,'07  Generate the kick from the same base reference'],
 ['02-motion-authoring',76,8,'08  Submit the two special-move videos'],
 ['02-motion-authoring',97,10,'09  Generate a separate key projectile sprite'],
 ['09-final-review-publish',33,13,'10  Re-extract and review the video-derived poses'],
 ['04-final-gameplay',42,9,'11  Review the source video in the workbench'],
 ['09-final-review-publish',82,6.2,'12  Inspect QA warnings and publish the fighter'],
 ['08-final-input-proof',2.2,4,'13  Keyboard test - jump and a damaging key projectile - CPU off'],
 ['07-live-fight',2,16,'14  Live CPU fight - Latch versus Brine - both take damage'],
];
let cursor=0;const map=[];
for (const [i,[file,start,duration,title]] of edits.entries()) {
 const output=path.join(temp,`${i}.mp4`);
 execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-ss',String(start),'-t',String(duration),'-i',path.join(root,`${file}.webm`),'-an','-vf',`fps=30,pad=iw:ih+72:0:0:black,drawtext=text='${title}':x=24:y=h-60:fontsize=24:fontcolor=white,drawtext=text='Actual agent-browser capture at 1x - waits and debugging cut - raw takes retained':x=24:y=h-28:fontsize=17:fontcolor=0xb9c0c8`,'-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p',output]);
 map.push({at:cursor,end:cursor+duration,rawFile:`${file}.webm`,rawStart:start,duration,title});cursor+=duration;
}
await writeFile(path.join(temp,'concat.txt'), edits.map((_,i)=>`file '${path.join(temp,`${i}.mp4`)}'`).join('\n'));
execFileSync('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','concat','-safe','0','-i',path.join(temp,'concat.txt'),'-c','copy','-movflags','+faststart',path.join(root,'latch-workbench-to-fight.mp4')]);
await writeFile(path.join(root,'edit-map.json'),JSON.stringify({duration:cursor,edits:map},null,2));
console.log(`Created ${cursor.toFixed(1)}s actual-workflow demo.`);
