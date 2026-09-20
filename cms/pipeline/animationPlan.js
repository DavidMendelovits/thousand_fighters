import {requiredMotionRows} from './motionRowArtifacts.js';
import {loadReviewContext,motionFingerprint,motionReviewStatus} from './reviewFingerprint.js';

/** Pure planning: no writes, submissions or optimistic approval from filenames. */
export function planAnimations(draft,frameData={}) {
  const rows=['base',...requiredMotionRows(draft)];
  const jobs=[...new Set(rows)].filter(Boolean).map(row=>{
    const actor=draft.actors?.find(a=>a.idleAnimation===row)||draft.actors?.find(a=>draft.moves?.some(m=>m.animation===row&&m.controlledActor===a.id));
    const reference=actor?.idleAnimation??'base';
    const frames=frameData.frames?.[row]??draft.sprite?.frames?.[row]??[];
    const report=draft.motionRows?.[row];
    const isReference=row==='base'||row===actor?.idleAnimation;
    const approved=report?.status==='approved'&&report.uniqueFrames>=8&&!report.clippedFrames?.length&&frames.length>=8;
    const referencePresent=(frameData.frames?.[reference]??draft.sprite?.frames?.[reference]??[]).length>0 || Boolean(actor?.sprite?.frames?.base?.length);
    const status=approved?'approved':report?.clippedFrames?.length||report?.status==='changes-requested'?'rejected':report?.status==='needs-visual-review'?'needs-review':row==='base'&&frames.length?'reference-ready':frames.length?'extracted':!isReference&&!referencePresent?'blocked':'missing';
    return {id:`${draft.id}:${actor?.id??'body'}:${row}`,characterId:draft.id,actorId:actor?.id??null,row,kind:isReference?'reference':'motion',status,frameCount:frames.length,
      dependencies:row===reference?[]:[reference],
      nextAction:approved?'Keep approved motion':status==='reference-ready'?'Reference ready':status==='needs-review'?'Inspect and approve':status==='blocked'?`Create ${reference} first`:frames.length?'Generate/review video motion':isReference?'Create isolated reference':'Generate video motion',
      defaultGenerator:isReference&&!frames.length?'image':draft.videoGenerator??'video'};
  });
  return {characterId:draft.id,jobs,counts:Object.fromEntries(['missing','blocked','extracted','needs-review','approved','reference-ready','rejected'].map(status=>[status,jobs.filter(j=>j.status===status).length]))};
}

export async function getAnimationPlan(repository,characterId) {
  const parent=await repository.getDraft(characterId);
  async function one(draft){
    const key=`${draft.assets?.rootKey??`characters/${draft.id}/assets/fighter-pack`}/frameData.json`;
    const frames=await repository.storage.exists(key)?await repository.storage.getJson(key):{};
    const plan=planAnimations(draft,frames);
    // The pure plan reads metadata only. Before showing a green approval in
    // the workbench, verify that it still describes the current asset bytes.
    const reviewed=plan.jobs.filter(job=>job.status==='approved'||draft.motionRows?.[job.row]?.review?.decision==='changes-requested');
    if(reviewed.length){
      const context=await loadReviewContext(repository,draft.id,draft);
      for(const job of reviewed){
        const current=await motionFingerprint(context,job.row);
        const status=motionReviewStatus(draft.motionRows[job.row],current.fingerprint,current.missing);
        if(status!=='approved'){job.status=status==='missing-assets'?'missing':['rejected','changes-requested'].includes(status)?'rejected':'needs-review';job.nextAction=status==='missing-assets'?'Re-extract missing assets':status==='changes-requested'?'Revise from review notes':'Inspect the current version again';}
      }
      for(const key of Object.keys(plan.counts))plan.counts[key]=plan.jobs.filter(job=>job.status===key).length;
    }
    return {...plan,displayName:draft.displayName};
  }
  const scopes=[await one(parent)];
  for(const form of parent.formDrafts??[]){
    try{
      const child=await repository.getDraft(form.characterId);
      const installed=parent.forms?.find(f=>f.id===form.id);
      scopes.push({...await one(child),formId:form.id,installedVersionId:installed?.source?.versionId??null,
        hasUninstalledEdits: Boolean(installed&&installed.source?.updatedAt!==child.updatedAt)});
    }catch(error){scopes.push({characterId:form.characterId,formId:form.id,displayName:form.name,error:error.message,jobs:[],counts:{}});}
  }
  return {characterId,scopes,paidRequests:0};
}
