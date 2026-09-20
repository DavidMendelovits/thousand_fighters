import {readFile,writeFile,mkdir,copyFile,access} from 'node:fs/promises';
import path from 'node:path';
import {createPalimpsest} from '../src/characters/palimpsest';
import {palimpsestMotion} from '../shared/palimpsestMotion.js';
import {retimeMotion,assertMotionCoverage} from '../cms/pipeline/motionRowArtifacts.js';
import {createCmsStorage} from '../cms/storage/createCmsStorage.js';
import {CharacterContentRepository} from '../cms/repositories/CharacterContentRepository.js';
const plan=JSON.parse(await readFile(process.argv[2],'utf8'));
const storage=createCmsStorage(),repository=new CharacterContentRepository(storage);
const root='public/fighters/palimpsest',pack='characters/palimpsest/assets/fighter-pack-paint-v1';
try{await access(`${root}/config.json`);throw new Error('Already installed; use the CMS revision workflow.');}catch(e:any){if(e.code!=='ENOENT')throw e;}
const config=createPalimpsest(),frames:any={},motionRows:any={},frameCounts:any={};
const reports:any={};
for(const action of Object.keys(palimpsestMotion)){
 const selection=plan[action];if(!selection?.notes)throw new Error(`Review required: ${action}`);
 const dir=selection.directory??`generated/palimpsest/motion-v3/${action}`;
 const report=JSON.parse(await readFile(`${dir}/motion.json`,'utf8'));
 if(report.action!==action || report.uniqueFrames<8 || report.clippedFrames.length)throw new Error(`Failed row: ${action}`);
 reports[action]={dir,report,selection};
}
await storage.lineage.run({characterId:'palimpsest',stage:'reviewed-paint-pack-install',inputs:{plan}},async()=>{
 for(const file of ['scripts/compile_character_motion.py','scripts/compile_animation_clip.py','scripts/prepare_paint_reference.py','shared/palimpsestMotion.js','scripts/generate_palimpsest_reference.mjs'])await storage.lineage.event('palimpsest',{type:'pipeline-source',file,artifact:await storage.lineage.artifact(await readFile(file))});
 for(const kind of ['body','hands'])for(const version of [1,2,3]){
  const file=`generated/palimpsest/${kind}-v${version}/${version===3?'body':'reference'}.png`;
  await storage.lineage.event('palimpsest',{type:'reference-selection',file,selected:version===3,artifact:await storage.lineage.artifact(await readFile(file))});
 }
 for(const [action,{dir,report,selection}] of Object.entries(reports) as any){
  frames[action]=[];
  for(const [i,frame] of report.frames.entries()){
   const file=`sprites/${action}/${action}_${String(i+1).padStart(3,'0')}.png`;
   await mkdir(path.dirname(`${root}/${file}`),{recursive:true});await copyFile(`${dir}/${frame.file}`,`${root}/${file}`);
   await storage.putBytes(`${pack}/${file}`,await readFile(`${dir}/${frame.file}`),{contentType:'image/png'});
   frames[action].push({...frame,file});
  }
  frameCounts[action]=frames[action].length;
  await storage.lineage.event('palimpsest',{type:'motion-approved',action,notes:selection.notes,source:await storage.lineage.artifact(await readFile(report.source)),report:await storage.lineage.artifact(await readFile(`${dir}/motion.json`))});
  motionRows[action]={...report,status:'approved',review:{notes:selection.notes,at:new Date().toISOString()},frames:undefined};
  const m=config.moves.find(m=>m.animation===action);if(m)m.visualTimeline=retimeMotion(m,report.frameCount,selection.contact??report.suggestedContactFrame,selection.recovery);
 }
 // Base is an exact alias of reviewed idle, not a generated fallback.
 frames.base=frames.idle;frameCounts.base=frameCounts.idle;
 const sprite={basePath:'/fighters/palimpsest',scale:.5,frames,frameCounts,sheets:{},rowPlayback:Object.fromEntries(Object.keys(frames).map(row=>[row,{ticksPerFrame:3,loop:['idle','walk_forward','walk_back','hands_idle','base'].includes(row)}]))};
 Object.assign(sprite.rowPlayback.crouch,{durationTicks:8});
 Object.assign(sprite.rowPlayback.block,{durationTicks:8});
 config.sprite=sprite;
 config.actors=[{id:'lead',sprite,hurtboxes:config.hurtboxes,defaultVisible:true},{id:'hands',summon:true,defaultVisible:false,sprite:{...sprite,frames:{...frames,base:frames.hands_idle},frameCounts:{...frameCounts,base:frameCounts.hands_idle}},hurtboxes:{idle:{x:-30,y:-85,width:60,height:85}}}];
 const manifest={id:'palimpsest',artSource:'reviewed-video-motion',frameCounts,sprites:Object.fromEntries(Object.entries(frames).map(([k,v]:any)=>[k,v.map((f:any)=>f.file)])),sheets:{}};
 const draft:any={schemaVersion:1,id:config.id,displayName:config.displayName,description:config.concept!.biography,concept:config.concept,rosterGroup:config.rosterGroup,stats:{walkForwardSpeed:config.walkForwardSpeed,walkBackSpeed:config.walkBackSpeed,jumpVelocity:config.jumpVelocity,jumpForwardVelocity:config.jumpForwardVelocity,jumpBackVelocity:config.jumpBackVelocity,gravity:config.gravity,maxFallSpeed:config.maxFallSpeed,maxHealth:config.maxHealth},combatStats:config.stats,geometryMode:'authored-runtime',hurtboxes:config.hurtboxes,pushboxWidth:config.pushboxWidth,animations:config.animations,moves:config.moves,actors:config.actors,comboRoutes:config.comboRoutes,combos:[],sprite:{...sprite,scaleMode:'authored-reference'},assets:{rootKey:pack,frameDataKey:`${pack}/frameData.json`,manifestKey:`${pack}/manifest.json`},motionRows,requireMotionCoverage:true};
 draft.poseStyle=config.poseStyle;
 assertMotionCoverage(draft);
 for(const [file,data] of Object.entries({'config.json':config,'frameData.json':{frames},'manifest.json':manifest,'moveset.json':config.moves})){
  await writeFile(`${root}/${file}`,JSON.stringify(data,null,2)+'\n');await storage.putJson(`${pack}/${file}`,data);
 }
 await copyFile(`${root}/${frames.idle[0].file}`,`${root}/portrait.png`);
 await repository.saveDraft('palimpsest',draft,{provider:'reviewed-paint-motion'});
 const version=await repository.createVersion('palimpsest',draft,{label:'Reviewed paint creature and controllable needle hands'});
 const index=JSON.parse(await readFile('public/assets-index.json','utf8'));
 index.fighters.palimpsest={displayName:config.displayName,basePath:sprite.basePath,config:'config.json',frameCounts,artSource:manifest.artSource};index.fighterCount=Object.keys(index.fighters).length;
 await writeFile('public/assets-index.json',JSON.stringify(index,null,2)+'\n');
 console.log(JSON.stringify({character:'palimpsest',rows:Object.keys(palimpsestMotion).length,frames:Object.values(frameCounts).reduce((a:any,b:any)=>a+b,0),checkpoint:version.versionId}));
});
