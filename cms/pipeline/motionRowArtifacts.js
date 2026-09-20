import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {loadReviewContext,motionFingerprint} from './reviewFingerprint.js';

const locks=new Map();
export const REQUIRED_MOTION_STATES=['idle','walk_forward','walk_back','jump','landing','crouch','block','hurt','getup'];
export function requiredMotionRows(draft){return [...new Set([...REQUIRED_MOTION_STATES,...(draft.actors??[]).flatMap(a=>a.idleAnimation?[a.idleAnimation]:[]),...(draft.moves??[]).flatMap(m=>[m.animation,...(m.requiredAnimation?[m.requiredAnimation]:[])])])];}

/** Retiming changes visual playback only. Collision/event ticks remain authored. */
export function retimeMotion(move, count, contact=Math.floor(count*.45), recoveryFrame) {
  contact=Math.max(1,Math.min(count-2,contact));
  const total=move.phases.reduce((n,p)=>n+p.frames,0);
  const startup=move.phases[0]?.frames??1;
  const active=move.phases[1]?.frames??1;
  const activeEnd=Math.max(contact+1,Math.min(count-1,recoveryFrame??contact+Math.max(1,Math.round(count*.15))));
  const timeline=[];
  for(let tick=0;tick<total;tick++){
    let frame=tick<startup?Math.floor(tick/startup*contact):tick<startup+active?contact+Math.floor((tick-startup)/active*(activeEnd-contact)):activeEnd+Math.floor((tick-startup-active)/Math.max(1,total-startup-active)*(count-activeEnd));
    frame=Math.min(count-1,frame);
    if(timeline.at(-1)?.frame===frame)timeline.at(-1).duration++;else timeline.push({frame,duration:1});
  }
  return timeline;
}

/** Serialized merges prevent parallel rows losing one another's metadata. */
export async function installMotionRow({characterId,directory,storage,repository,contactFrame,recoveryFrame}){
  const prior=locks.get(characterId)??Promise.resolve();
  const pending=prior.catch(()=>{}).then(()=>install({characterId,directory,storage,repository,contactFrame,recoveryFrame}));
  locks.set(characterId,pending);try{return await pending;}finally{if(locks.get(characterId)===pending)locks.delete(characterId);}
}
async function install({characterId,directory,storage,repository,contactFrame,recoveryFrame}){
  const report=JSON.parse(await readFile(path.join(directory,'motion.json'),'utf8'));
  if(storage.lineage)await storage.lineage.event(characterId,{type:'motion-candidate',stage:'install-motion',artifact:await storage.lineage.artifact(await readFile(path.join(directory,'motion.json')),{contentType:'application/json'}),sourceSha256:report.sourceSha256,provenance:report.provenance??null});
  const action=report.action;
  if(!/^[a-z][a-z0-9_-]*$/.test(action)||report.uniqueFrames<8||report.clippedFrames.length)throw new Error('Motion row failed its geometry/diversity gate');
  const draft=await repository.getDraft(characterId);
  const pack=draft.assets?.rootKey??`characters/${characterId}/assets/fighter-pack`;
  const frameData=await storage.getJson(`${pack}/frameData.json`);
  const manifest=await storage.getJson(`${pack}/manifest.json`);
  const frames=[];
  for(const [i,frame] of report.frames.entries()){
    const file=`sprites/${action}/${action}_${String(i+1).padStart(3,'0')}.png`;
    await storage.putBytes(`${pack}/${file}`,await readFile(path.join(directory,frame.file)),{contentType:'image/png'});
    frames.push({...frame,file});
  }
  await storage.putBytes(`${pack}/sheets/${action}.png`,await readFile(path.join(directory,'sheet.png')),{contentType:'image/png'});
  await storage.putBytes(`${pack}/motion/${action}/preview.png`,await readFile(path.join(directory,'preview.png')),{contentType:'image/png'});
  await storage.putBytes(`${pack}/motion/${action}/contact.png`,await readFile(path.join(directory,'contact.png')),{contentType:'image/png'});
  frameData.frames[action]=frames;
  manifest.sprites??={};manifest.sheets??={};manifest.frameCounts??={};
  manifest.sprites[action]=frames.map(f=>f.file);manifest.sheets[action]=`sheets/${action}.png`;manifest.frameCounts[action]=frames.length;
  manifest.artSource='video-motion-with-reviewed-rows';
  await storage.putJson(`${pack}/frameData.json`,frameData);await storage.putJson(`${pack}/manifest.json`,manifest);
  draft.sprite??={};draft.sprite.frameCounts={...draft.sprite.frameCounts,[action]:frames.length};
  draft.sprite.frames=frameData.frames;
  for(const actor of draft.actors??[])if(actor.sprite?.basePath===draft.sprite.basePath && actor.sprite.frames?.[action]){
    actor.sprite.frames[action]=frames;
    actor.sprite.frameCounts[action]=frames.length;
  }
  draft.sprite.rowPlayback={...draft.sprite.rowPlayback,[action]:{ticksPerFrame:action.startsWith('walk')?2:3,loop:report.loop}};
  for(const move of draft.moves??[])if(move.animation===action)move.visualTimeline=retimeMotion(move,frames.length,contactFrame??report.suggestedContactFrame,recoveryFrame);
  draft.motionRows={...draft.motionRows,[action]:{...report,frames:undefined,status:'needs-visual-review',contactFrame:contactFrame??report.suggestedContactFrame,...(recoveryFrame!==undefined?{recoveryFrame}:{})}};
  await repository.saveDraft(characterId,draft,{provider:'video-motion-compiler'});
  return {action,frameCount:frames.length,status:'needs-visual-review'};
}

export async function approveMotionRow({repository,characterId,action,notes,expectedFingerprint}){
  if(!notes?.trim())throw new Error('Visual review notes are required');
  const draft=await repository.getDraft(characterId),row=draft.motionRows?.[action];
  if(!row||row.uniqueFrames<8||row.clippedFrames?.length)throw new Error('No valid compiled motion candidate');
  const context=await loadReviewContext(repository,characterId,draft);
  const {fingerprint,missing}=await motionFingerprint(context,action);
  if(!fingerprint||missing.length||(context.frameData.frames[action]?.length??0)<8)throw new Error('Motion assets are missing or incomplete. Re-extract before reviewing.');
  if(context.frameData.frames[action].some(frame=>frame.sourceClipped))throw new Error('Source clipping must be corrected before approval.');
  if(!expectedFingerprint||expectedFingerprint!==fingerprint)throw Object.assign(new Error('Motion changed or review version is missing. Refresh the release check, inspect the current row, then approve.'),{statusCode:409});
  if(context.conceptHash&&draft.referenceReview?.sha256===context.conceptHash&&draft.referenceReview.status==='rejected')throw new Error('The current identity reference is rejected. Replace it before approving motion.');
  row.status='approved';row.review={notes:notes.trim().slice(0,4000),at:new Date().toISOString(),fingerprint,schemaVersion:1};
  await repository.saveDraft(characterId,draft,{provider:'motion-review'});return row;
}
export function assertMotionCoverage(draft){
  for(const form of draft.formDrafts??[])if(!draft.forms?.some(f=>f.id===form.id&&f.source?.versionId))throw new Error(`Form ${form.id} has not been installed from reviewed motion. Open its workspace, finish review, then install it.`);
  if(!draft.requireMotionCoverage)return;
  const missing=requiredMotionRows(draft).filter(row=>draft.motionRows?.[row]?.status!=='approved'||draft.motionRows[row].uniqueFrames<8||draft.motionRows[row].clippedFrames?.length);
  if(missing.length)throw new Error(`Incomplete motion pack: ${missing.join(', ')}. Generate and visually approve these rows before publishing.`);
  const proxies=(draft.moves??[]).filter(m=>m.artStatus==='proxy'||(m.requiredAnimation&&m.requiredAnimation!==m.animation));
  if(proxies.length)throw new Error(`Proxy move artwork must be replaced before publishing: ${proxies.map(m=>m.id).join(', ')}`);
}
