import {access,readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {runVideoJob} from './generate_animation_video.mjs';
const exec=promisify(execFile);
export const motions={
 forward_jab:'One advancing straight palm strike toward screen right at chest height. Take a small forward step as the free arm extends fully, retract and settle.',
 down_jab:'Bend both knees into a deep crouch and make one short straight free-hand punch toward screen right at knee height. Retract the fist while low, then rise.',
 back_jab:'Lean the torso back and slide the rear foot slightly left while snapping the free hand out toward screen right at chest height. Withdraw the hand and settle.',
 forward_kick:'Lift the front knee and perform one long horizontal front kick toward screen right at waist height, leg fully extending, then bend the knee and plant the foot.',
 down_kick:'Sink into a deep crouch, supporting weight on the rear bent leg, and sweep the front leg low toward screen right at ankle height. Retract the sweeping foot then rise.',
 back_kick:'Lean the torso back and deliver one rising front kick toward screen right at head height. The kicking heel rises in an upward arc, then the leg folds and returns to the ground.',
 uppercut:'Dip into bent knees, pull the free fist down beside the hip, then drive that fist sharply upward toward screen right above shoulder height while straightening the legs. Retract to guard.',
 air_jab:'Jump vertically with both feet visibly leaving the ground, bend the knees in the air, and throw one forward free-hand jab toward screen right while airborne. Retract and land softly.',
 air_kick:'Jump vertically with both feet off the ground, extend one leg horizontally toward screen right in a flying side kick, fold the leg and land softly.',
 reverse_throw:'Reach the free hand toward screen right as if gripping an invisible wrist, pull that arm across the body toward screen left while pivoting the hips, finish with the free arm extended left as if tossing the invisible weight behind him. Then return to face right. Do not show another person.',
 jab_second:'Make one compact free-hand backhand strike toward screen right across chest height, turning the shoulders into it. This is a backhand follow-up, not a straight punch. Return to ready.',
 jab_third:'Wind the free hand beside the rear shoulder and make one strong open-palm heel strike toward screen right at chest height, hips rotating decisively. Retract and settle.',
 jab_kick_end:'Lift one knee high then thrust the sole forward toward screen right in a forceful waist-high push kick. Lean backward for balance, then retract the leg and plant it.',
 jab_low_end:'Drop low on one bent knee and deliver one quick low side kick toward screen right just above the ground. Pull the leg in and stand back up.',
 forward_second:'Step in slightly and make one compact free-arm elbow strike toward screen right at chest height, fist tucked close to the shoulder. Retract the elbow.',
 forward_finish:'Dip then deliver one powerful rising knee toward screen right, the thigh driving upward to chest height while the other foot stays planted. Lower the knee and settle.',
 back_finish:'Lean away from screen right and snap one waist-high side kick toward screen right while keeping the upper body withdrawn. Retract the leg and settle.',
 kick_second:'Perform one inward arcing roundhouse kick toward screen right at waist height, hip rotating and knee unfolding. Fold the knee and recover without a full body spin.',
 kick_finish:'After shifting weight onto the front foot, drive the free fist diagonally downward toward screen right at chest height in one forceful cross punch. Retract the hand.',
 low_follow:'From a shallow crouch, rise into one compact front knee strike toward screen right at waist height. Lower the knee, straighten and recover.'
};
const version=process.env.DAVID_MOTION_VERSION??'v1';
if(!/^v\d+$/.test(version))throw new Error('Invalid batch version');
const root=`generated/david-watercolor/expanded-moves-${version}`;
const reference='artifacts/workbench-video-jobs/4ca91e28-1fe0-4530-84b8-cd7c3c3e412f/reference.png';
const selected=process.argv.slice(2);
const tasks=Object.entries(motions).filter(([id])=>!selected.length||selected.includes(id));
let next=0;
async function worker(){
 while(next<tasks.length){const [action,motion]=tasks[next++];const output=`${root}/${action}-source`;
 try{
 let resume=false;try{await access(`${output}/job.json`);resume=true;}catch{}
 const overrides=process.env.DAVID_MOTION_PROMPTS?JSON.parse(await readFile(process.env.DAVID_MOTION_PROMPTS,'utf8')):{};
 const prompt=`Animate only this illustrated man, facing screen right. ${overrides[action]??motion} Match the exact reference face, colorful shirt, blue jeans, pale sneakers, body size and watercolor texture. Static side camera. Full body visible, centered with generous empty margins. Background stays exactly uniform solid magenta for every frame. Only the single man is visible. Nothing else appears. His other hand holds the microphone near his chest. Finish in the original stance.`;
 await runVideoJob(resume?{resume:output}:{provider:process.env.DAVID_MOTION_PROVIDER??'pruna',mode:'image-to-video',image:reference,'end-image':reference,prompt,duration:5,resolution:'480p',recipe:'quality',output},{characterId:'david',moveId:action});
 const directory=`${root}/${action}`;
 const compiled=await exec('python3',['scripts/compile_character_motion.py',`${output}/source.mp4`,'--reference','generated/david-watercolor/reference-v2/body-clean.png','--output',directory,'--action',action,'--frames','24','--style','watercolor','--component-mode','largest'],{maxBuffer:4e6});
 console.log(action,compiled.stdout);
 }catch(error){console.error(`FAILED ${action}: ${error.message}`);process.exitCode=1;}
 }
}
await Promise.all([worker(),worker()]);
