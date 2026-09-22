import {randomUUID} from 'node:crypto';
import {digest,segment} from '../storage/LineageStore.js';
import {getAnimationPlan} from '../pipeline/animationPlan.js';
import {loadReviewContext,motionFingerprint,motionReviewStatus,stableJson} from '../pipeline/reviewFingerprint.js';

const fail=(message,statusCode=409)=>Object.assign(new Error(message),{statusCode});
const hash=value=>digest(Buffer.from(stableJson(value)));
const uuid=value=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
// Generation and review change these output fields. Authored move inputs,
// hitboxes, stats, actor contracts and material direction remain pinned.
function rules(draft){
  const {updatedAt,createdAt,generation,history,lifecycle,referenceReview,motionRows,assets,sprite,workbench,...authored}=draft;
  return {...authored,moves:draft.moves?.map(({visualTimeline,...move})=>move),sprite:{relativeHeight:sprite?.relativeHeight,scaleAdjust:sprite?.scaleAdjust},
    actors:draft.actors?.map(({sprite,...actor})=>actor)};
}

/** Durable itinerary, not an autonomous worker. Every paid step is explicitly
 * admitted by advance(). Single CMS process; not a distributed budget service. */
export class CharacterBuildPlans {
  constructor({storage,repository,buildJobs}){Object.assign(this,{storage,repository,buildJobs});this.lock=Promise.resolve();}
  root(characterId,id){segment(characterId);if(!uuid(id))throw fail('Invalid build plan id.',400);return `build-plans/${characterId}/${id}`;}
  async save(plan){
    const next={...plan,revision:(plan.revision??-1)+1,updatedAt:new Date().toISOString()};
    await this.storage.lineage.immutable(`${this.root(plan.characterId,plan.id)}/events/${String(next.revision).padStart(6,'0')}.json`,Buffer.from(JSON.stringify(next)),{contentType:'application/json'});
    return next;
  }
  async get(characterId,id){const keys=await this.storage.list(`${this.root(characterId,id)}/events`);if(!keys.length)throw fail('Build plan not found.',404);return this.storage.getJson(keys.sort().at(-1));}
  async list(characterId){segment(characterId);const keys=await this.storage.list(`build-plans/${characterId}`);const ids=[...new Set(keys.map(k=>k.split('/')[2]))];return (await Promise.all(ids.map(id=>this.get(characterId,id)))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
  async snapshot(characterId){
    const context=await loadReviewContext(this.repository,characterId);
    const references={concept:context.conceptHash};
    const sourceKey=`characters/${characterId}/assets/source/${characterId}_base_sheet.png`;
    references.baseSource=await this.storage.exists(sourceKey)?digest(await this.storage.getBytes(sourceKey)):null;
    const rows=['base',...(context.draft.actors??[]).map(actor=>actor.idleAnimation).filter(Boolean)];
    for(const row of rows){const files=context.frameData.frames?.[row]??[];references[row]=await Promise.all(files.map(async f=>({file:f.file,hash:await context.hash(f.file)})));}
    return {rulesHash:hash(rules(context.draft)),references,context};
  }
  async create(characterId,input={}){
    const {budgetUsd,maxSubmissions=20,allowUnknownCosts=false,estimatedCostUsd=null,generator='video',prompt=''}=input;
    if(!Number.isFinite(budgetUsd)||budgetUsd<0||budgetUsd>10000||!Number.isInteger(maxSubmissions)||maxSubmissions<1||maxSubmissions>200)throw fail('Set an estimated-spend ceiling ($0–$10,000) and 1–200 submissions.',400);
    if(estimatedCostUsd!==null&&(!Number.isFinite(estimatedCostUsd)||estimatedCostUsd<0))throw fail('Unit estimate must be nonnegative or unknown.',400);
    if(typeof prompt!=='string'||prompt.length>12000||!['image','video','pruna-video'].includes(generator)||typeof allowUnknownCosts!=='boolean')throw fail('Invalid plan settings.',400);
    const animation=await getAnimationPlan(this.repository,characterId),steps=[],pins={},blockers=[];
    for(const scope of animation.scopes){
      if(scope.error){blockers.push(`Form ${scope.characterId}: ${scope.error}`);continue;}
      const snapshot=await this.snapshot(scope.characterId),draft=snapshot.context.draft;
      if(generator==='image'&&draft.actors?.length)throw fail('Characters with independent actors need a video motion provider. Identity references still use the image API.',400);
      pins[scope.characterId]={rulesHash:snapshot.rulesHash,references:snapshot.references};
      if(!snapshot.context.conceptHash)steps.push(this.step(scope.characterId,'identity','identity',prompt||draft.description||draft.displayName||draft.id,'image'));
      const motion=scope.jobs.filter(j=>j.kind==='motion');
      const samples=new Set([motion.find(j=>/walk_forward/.test(j.row))?.row,motion.find(j=>draft.moves?.some(m=>m.animation===j.row))?.row,...(draft.actors??[]).map(a=>motion.find(j=>j.actorId===a.id)?.row)].filter(Boolean));
      for(const job of [...scope.jobs].sort((a,b)=>(a.kind==='reference'?0:samples.has(a.row)?1:2)-(b.kind==='reference'?0:samples.has(b.row)?1:2))){
        const move=draft.moves?.find(m=>m.animation===job.row||m.requiredAnimation===job.row);
        const text=[prompt||draft.description||draft.displayName,`Create ${job.row} for ${draft.displayName??draft.id}.`,draft.artStyle?`Material/style: ${JSON.stringify(draft.artStyle)}`:'',move?`Authored move and inputs: ${JSON.stringify(move)}`:'',job.actorId?`Independent controlled actor: ${job.actorId}; not the fighter body.`:'', 'Preserve reference identity. Show readable anticipation, action and recovery. Full silhouette and effects stay in frame.'].filter(Boolean).join('\n');
        const step=this.step(scope.characterId,job.row,job.kind,text,job.kind==='reference'?'image':generator);
        step.dependencies=job.dependencies;step.actorId=job.actorId;step.representative=samples.has(job.row);step.initialStatus=job.status;
        // Existing extracted candidates are reviewed, not purchased again.
        step.status=job.status==='approved'?'kept':job.frameCount?'review':'pending';
        if(job.kind==='reference'&&job.frameCount){step.status='review';Object.assign(step,this.referenceCheckpoint(snapshot,job.row));}
        steps.push(step);
        if(job.kind==='reference'&&job.actorId){
          const idle=this.step(scope.characterId,job.row,'motion',`${text}\nAnimate this independently reviewed actor reference in a continuous idle loop.`,generator);
          Object.assign(idle,{actorId:job.actorId,representative:true,referenceStepId:step.id,dependencies:[step.id],status:job.status==='approved'?'kept':job.frameCount>=8?'review':'pending'});
          steps.push(idle);
        }
      }
      for(const step of steps.filter(s=>s.characterId===scope.characterId&&s.actorId&&s.kind==='motion')){
        const reference=steps.find(s=>s.characterId===scope.characterId&&s.actorId===step.actorId&&s.kind==='reference');
        if(reference){step.referenceStepId=reference.id;step.dependencies=[reference.id];}
      }
      // Effects are runtime-dependent independent assets, not body row videos.
      const effects=new Set();
      for(const projectile of draft.projectiles??[])effects.add(`projectile/impact ${projectile.id??'unnamed'}`);
      for(const effect of draft.effects??[])effects.add(`effect ${effect.id??'unnamed'}`);
      for(const move of draft.moves??[])for(const phase of move.phases??[])for(const item of phase.events??[]){const event=item.event??{};if(event.projectile)effects.add(`projectile/impact for ${move.id}`);if(event.effect)effects.add(`effect for ${move.id}`);}
      for(const effect of effects)blockers.push(`${scope.characterId}: ${effect} needs a separate effect-asset authoring/review contract; this row lane cannot certify it.`);
      if(scope.formId)blockers.push(`${scope.characterId}: reviewed form must be installed into its parent before publication.`);
      for(const form of draft.forms??[])if(!(draft.formDrafts??[]).some(f=>f.id===form.id))blockers.push(`${scope.characterId}: installed form ${form.id} has no linked editable form draft; inspect its independent moves and assets separately.`);
    }
    return this.save({schemaVersion:1,id:randomUUID(),characterId,createdAt:new Date().toISOString(),status:'ready',revision:-1,
      budget:{budgetUsd,maxSubmissions,allowUnknownCosts,estimatedCostUsd,reservedUsd:0,reservedSubmissions:0,unknownReservations:0,kind:'estimate-not-billing-cap'},pins,steps,blockers,
      notice:'No requests submitted. Estimates are not billing limits. Unknown prices require explicit opt-in; every request consumes the submission limit.'});
  }
  step(characterId,row,kind,prompt,generator){return {id:randomUUID(),jobId:randomUUID(),characterId,row,kind,prompt:prompt.slice(0,16000),generator,status:'pending'};}
  referenceCheckpoint(snapshot,row){return {reviewFingerprint:hash({concept:snapshot.references.concept,frames:snapshot.references[row]}),reviewAssets:(snapshot.references[row]??[]).map(f=>`/api/assets/${snapshot.context.root}/${f.file}`),conceptAsset:snapshot.context.conceptKey?`/api/assets/${snapshot.context.conceptKey}`:null};}
  async advance(characterId,id,input={}){
    if(input.confirmed!==true)throw fail('Confirm one generation step. This may incur provider charges.',400);
    const run=async()=>{const plan=await this.get(characterId,id);const scopes=Object.keys(plan.pins).sort();const locked=i=>i===scopes.length?this.run(characterId,id):this.repository.withMutation(scopes[i],()=>locked(i+1));return locked(0);};const result=this.lock.catch(()=>{}).then(run);this.lock=result;return result;
  }
  async review(characterId,id,{stepId,expectedFingerprint,notes,confirmed}={}){
    if(confirmed!==true||typeof notes!=='string'||notes.trim().length<10||notes.length>2000)throw fail('Inspect the identity reference and record review notes (10–2000 characters).',400);
    const run=async()=>{
      let plan=await this.get(characterId,id);const step=plan.steps.find(s=>s.id===stepId&&s.kind==='reference'&&s.status==='review');
      if(!step)throw fail('No reference checkpoint is waiting for this step.');
      return this.repository.withMutation(step.characterId,async()=>{
        const snapshot=await this.snapshot(step.characterId),frames=snapshot.references[step.row],fingerprint=hash({concept:snapshot.references.concept,frames});
        if(!frames?.length||frames.some(f=>!f.hash)||!expectedFingerprint||expectedFingerprint!==fingerprint||step.reviewFingerprint!==fingerprint)throw fail('Reference changed. Create or refresh the plan before reviewing.');
        if(step.actorId){
          const frozen=[];
          for(const [index,frame] of frames.entries()){
            const key=`characters/${step.characterId}/assets/build-plan-references/${plan.id}/${step.id}/${frame.hash}-${index}.png`;
            const bytes=await this.storage.getBytes(`${snapshot.context.root}/${frame.file}`);
            if(digest(bytes)!==frame.hash)throw fail('Reference changed during review.');
            if(!await this.storage.exists(key))await this.storage.lineage.immutable(key,bytes,{contentType:'image/png'});
            if(digest(await this.storage.getBytes(key))!==frame.hash)throw fail('Frozen reference integrity check failed.');
            frozen.push({key,sha256:frame.hash});
          }
          step.frozenReferences=frozen;step.reviewAssets=frozen.map(f=>`/api/assets/${f.key}`);
        }
        step.checkpointReview={fingerprint,notes:notes.trim(),at:new Date().toISOString()};step.status='kept';plan.message='Identity reference checkpoint reviewed. Continue explicitly when ready.';return this.save(plan);
      });
    };
    const result=this.lock.catch(()=>{}).then(run);this.lock=result;return result;
  }
  async run(characterId,id){
    let plan=await this.get(characterId,id);
    const snapshots={};
    for(const [scope,pin] of Object.entries(plan.pins)){
      const snapshot=await this.snapshot(scope);snapshots[scope]=snapshot;
      if(snapshot.rulesHash!==pin.rulesHash)throw fail(`Plan is stale: authored rules changed for ${scope}. Create a new plan.`);
    }
    for(const step of plan.steps)for(const reference of step.frozenReferences??[])if(!await this.storage.exists(reference.key)||digest(await this.storage.getBytes(reference.key))!==reference.sha256)throw fail('Frozen actor reference changed or is missing. No generation submitted.');
    // Reconcile only this plan's exact job; never replay an uncertain purchase.
    const running=plan.steps.find(step=>['reserved','submitted'].includes(step.status));
    if(running){
      let job;try{job=await this.buildJobs.get(running.characterId,running.jobId);}catch(error){if(error.statusCode!==404)throw error;}
      if(job){
        if(job.status!=='completed'){plan.status=['queued','running','preparing','submitting','provider-active','extracting'].includes(job.status)?'running':'needs-recovery';plan.message=`${running.row}: ${job.phase??job.status}. Reservation retained.`;return this.save(plan);}
        running.status='review';running.result=job.result;running.completedAt=job.completedAt;
        const snapshot=snapshots[running.characterId],pin=plan.pins[running.characterId];
        // Only the reference produced by this exact completed step can advance
        // its pin. All other reference changes remain stale-plan failures.
        if(running.kind==='identity')pin.references.concept=snapshot.references.concept;
        if(running.kind==='reference'||(running.kind==='motion'&&running.referenceStepId&&Object.hasOwn(pin.references,running.row))){pin.references[running.row]=snapshot.references[running.row];if(running.row==='base')pin.references.baseSource=snapshot.references.baseSource;}
        if(running.kind==='reference')Object.assign(running,this.referenceCheckpoint(snapshot,running.row));
        plan.status='review';plan.message=`Review ${running.row} in the workbench before continuing.`;
        plan=await this.save(plan);
      }else if(running.status==='submitted')throw fail('Submitted job is missing. Inspect storage; do not purchase again.');
    }
    for(const [scope,pin] of Object.entries(plan.pins))if(stableJson(snapshots[scope].references)!==stableJson(pin.references))throw fail(`Plan is stale: reference bytes changed for ${scope}. Create a new plan.`);
    for(const step of plan.steps){
      const context=snapshots[step.characterId].context;
      if(step.kind==='identity'&&context.conceptHash&&context.draft.referenceReview?.sha256===context.conceptHash&&context.draft.referenceReview.status==='approved')step.status='kept';
      if(step.kind==='reference'&&context.frameData.frames?.[step.row]?.length){
        // Actor identity stays frozen when its separate idle animation replaces
        // the mutable runtime row. Six reference poses are not motion approval.
        if(step.actorId&&step.frozenReferences?.length&&step.checkpointReview)step.status='kept';
        else {
          const fingerprint=hash({concept:snapshots[step.characterId].references.concept,frames:snapshots[step.characterId].references[step.row]});
          if(step.checkpointReview?.fingerprint===fingerprint)step.status='kept';
          else {step.status='review';step.reviewFingerprint=fingerprint;}
        }
      }
      if(step.kind==='motion'){
        const current=await motionFingerprint(context,step.row);
        if(motionReviewStatus(context.draft.motionRows?.[step.row],current.fingerprint,current.missing)==='approved')step.status='kept';
        else if(step.status==='kept'){plan.status='review';plan.message=`Previously approved ${step.row} changed; review or create a new plan.`;return this.save(plan);}
      }
    }
    const next=plan.steps.find(step=>step.status!=='kept');
    if(!next){plan.status=plan.blockers.length?'blocked':'complete';plan.message=plan.blockers.length?'Rows reviewed; remaining independent-asset or form-install work is listed below.':'All planned rows have current reviews. Run runtime QA and publication checks separately.';return this.save(plan);}
    if(next.status==='review'){plan.status='review';plan.message=`Review ${next.row} in the workbench. No new request submitted.`;return this.save(plan);}
    const context=snapshots[next.characterId].context;
    if(next.kind!=='identity'&&(!context.conceptHash||context.draft.referenceReview?.sha256!==context.conceptHash||context.draft.referenceReview.status!=='approved')){plan.status='review';plan.message='Approve the current identity reference before motion generation.';return this.save(plan);}
    if(next.status!=='reserved'){
      const budget=plan.budget,price=budget.estimatedCostUsd;
      if(budget.reservedSubmissions>=budget.maxSubmissions)throw fail('Submission budget exhausted. Create a new explicit plan.');
      if(price===null&&!budget.allowUnknownCosts)throw fail('Price is unknown. Create a plan explicitly allowing unknown prices or supply a unit estimate.');
      if(price!==null&&budget.reservedUsd+price>budget.budgetUsd+1e-9)throw fail('Estimated-spend ceiling would be exceeded. No generation submitted.');
      next.status='reserved';next.reservedAt=new Date().toISOString();budget.reservedSubmissions++;if(price===null)budget.unknownReservations++;else budget.reservedUsd+=price;
      plan=await this.save(plan); // fail closed before external admission
    }
    const referenceStep=next.referenceStepId?plan.steps.find(s=>s.id===next.referenceStepId):null;
    if(next.referenceStepId&&(!referenceStep?.checkpointReview||!referenceStep.frozenReferences?.length))throw fail('Approve the isolated actor identity reference before its motion.');
    const response=await this.buildJobs.submit(next.characterId,{idempotencyKey:next.jobId,tool:next.kind==='identity'?'generate_character_concept':'generate_sprite_sheet',input:{characterId:next.characterId,prompt:next.prompt,...(next.kind==='identity'?{}:{moveId:next.row,generator:next.generator}),...(referenceStep?{referenceAssetKeys:[referenceStep.frozenReferences[0].key]}:{})}});
    const saved=plan.steps.find(step=>step.id===next.id);saved.status='submitted';saved.jobId=response.job.id;plan.status='running';plan.message=`${next.row} submitted. The saved remainder waits for review and explicit continuation.`;
    return this.save(plan);
  }
}
