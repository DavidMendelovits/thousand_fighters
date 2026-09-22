import {randomUUID} from 'node:crypto';
import {digest,segment,safeProvenance} from '../storage/LineageStore.js';
import {stableJson} from '../pipeline/reviewFingerprint.js';
import {EventEmitter} from 'node:events';
import {BuildWorkerOwner} from './BuildWorkerOwner.js';
import {GenerationAttemptLedger} from '../pipeline/GenerationAttemptLedger.js';
import {recoverGenerationAttempt} from '../pipeline/recoverGenerationAttempt.js';
import {withBuildObserver} from './buildExecutionContext.js';

const ACTIVE=new Set(['queued','running','preparing','submitting','provider-active','extracting']);
const UNRESOLVED=new Set(['needs-recovery','submission-uncertain']);
const TOOLS=new Set(['generate_character_concept','generate_sprite_sheet']);
const failure=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const cleanText=value=>String(value??'').replace(/(?:Bearer|Key)\s+\S+/gi,'[AUTH]').replace(/https?:\/\/\S+/g,'[URL]').replace(/data:\S+/g,'[MEDIA]').slice(0,700);

/** Single-process executor with durable stages and a host-level owner lock.
 * queued -> preparing -> submitting -> provider-active -> extracting -> completed
 *                          |                                  |
 *                          +-> submission-uncertain            +-> needs-recovery
 * Unknown acceptance NEVER transitions automatically back to submission.
 */
export class CharacterBuildJobs {
  constructor({storage,repository,invoke,sessionId=randomUUID(),lockPath,recoverAttempt=recoverGenerationAttempt}) {
    Object.assign(this,{storage,repository,invoke,sessionId});
    this.pending=[];this.running=false;this.admission=Promise.resolve();this.live=new Map();
    this.owner=new BuildWorkerOwner(storage,lockPath);this.events=new EventEmitter();this.events.setMaxListeners(100);
    this.recoverAttempt=recoverAttempt;this.stopping=false;this.started=null;
  }
  async start(){
    if(this.started)return this.started;
    this.started=(async()=>{await this.owner.acquire();await this.reconcile();})();
    try{await this.started;}catch(error){this.started=null;await this.owner.release();throw error;}
  }
  async stop(){
    this.stopping=true;await this.admission.catch(()=>{});
    while(this.running||this.live.size)await new Promise(resolve=>setTimeout(resolve,20));
    this.events.emit('shutdown');await this.owner.release();
  }
  async reconcile(){
    // One startup scan repairs materialized heads after a torn write. Normal
    // list/get traffic only reads heads; immutable journals remain authoritative.
    const keys=(await this.storage.list('build-jobs')).filter(key=>key.endsWith('/request.json'));
    if(!await this.storage.exists('build-job-index-version.json')){
      // One-time legacy backfill; never put this scan on list/get request paths.
      for(const key of (await this.storage.list('generation-attempts')).filter(k=>k.endsWith('/intent.json'))){
        const intent=await this.storage.getJson(key);
        if(!intent.characterId||!intent.buildJobId)continue;
        const index=`build-attempts/${segment(intent.characterId)}/${segment(intent.buildJobId)}/${segment(intent.attemptId)}.json`;
        if(!await this.storage.exists(index))await this.storage.lineage.immutable(index,Buffer.from(JSON.stringify({attemptId:intent.attemptId})),{contentType:'application/json'});
      }
      await this.storage.putJson('build-job-index-version.json',{version:1});
    }
    for(const key of keys){
      const request=await this.storage.getJson(key),root=this.root(request.characterId,request.id);
      const events=await this.storage.list(`${root}/events`);
      let state=events.length?await this.storage.getJson(events.sort().at(-1)):{revision:-1,status:'queued',phase:'Recovered admission',attempts:[]};
      await this.index(request,state);
      if(!ACTIVE.has(state.status))continue;
      let draft;
      try{draft=await this.repository.getDraft(request.characterId);}catch(error){
        await this.write(request,{...state,status:'blocked',phase:'Character draft unavailable · recovery paused',error:cleanText(error.message)});continue;
      }
      if(draft.workbench?.archived){
        await this.write(request,{...state,status:'blocked',phase:'Character is archived · generation and recovery paused'});continue;
      }
      if(state.status==='queued'||state.status==='preparing'){
        // Only new stage records are safe before invoke. Legacy claims may
        // already have crossed a provider boundary.
        if(!await this.storage.exists(`${root}/claim.json`)||(state.status==='preparing'&&request.schemaVersion>=2)){
          this.pending.push({request,state,recoveryPreparation:state.status==='preparing'});continue;
        }
      }
      const attempts=await this.attempts(request,state);
      const canRecover=Boolean(state.sourceArtifact&&state.generationResult?.asset?.key)||attempts.some(a=>a.providerTaskId||a.outputArtifact);
      state=await this.write(request,{...state,attempts,status:canRecover?'needs-recovery':'submission-uncertain',phase:canRecover?'Recovering accepted work · no new generation':'Submission outcome unknown · inspect provider account'});
      if(canRecover)this.pending.push({request,state,recovery:true});
    }
    queueMicrotask(()=>void this.drain());
  }
  async index(request,state){
    await this.storage.putJson(`build-job-heads/${request.characterId}/${request.id}.json`,{request,state});
  }
  root(characterId,id){
    segment(characterId);
    if(!/^[a-f0-9-]{36}$/.test(id)||!/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/.test(id))throw failure('Invalid build job id.');
    return `build-jobs/${characterId}/${id}`;
  }
  async write(request,state){
    const root=this.root(request.characterId,request.id);
    const record={...state,revision:(state.revision??-1)+1,updatedAt:new Date().toISOString()};
    await this.storage.lineage.immutable(`${root}/events/${String(record.revision).padStart(6,'0')}.json`,Buffer.from(JSON.stringify(record)),{contentType:'application/json'});
    await this.index(request,record);
    this.events.emit(request.id,{request,state:record});
    return record;
  }
  async raw(characterId,id){
    const root=this.root(characterId,id);
    const head=`build-job-heads/${characterId}/${id}.json`;
    if(await this.storage.exists(head))return this.storage.getJson(head);
    if(!await this.storage.exists(`${root}/request.json`))throw failure('Build job not found.',404);
    const request=await this.storage.getJson(`${root}/request.json`);
    const keys=await this.storage.list(`${root}/events`);
    const state=keys.length?await this.storage.getJson(keys.sort().at(-1)):{status:'needs-recovery',phase:'Admission incomplete',revision:-1};
    return {request,state};
  }
  view({request,state}){
    const disconnected=ACTIVE.has(state.status)&&!this.live.has(request.id)&&!this.pending.some(job=>job.request.id===request.id);
    return {...state,id:request.id,characterId:request.characterId,tool:request.tool,row:request.input.moveId??null,
      createdAt:request.createdAt,status:disconnected?'needs-recovery':state.status,
      phase:disconnected?'Previous executor not attached; no automatic retry':state.phase,
      error:disconnected?'A previous worker may have submitted paid work. Check history/provider results before resolving this job.':state.error,
      durationMs:state.completedAt?Date.parse(state.completedAt)-Date.parse(request.createdAt):Date.now()-Date.parse(request.createdAt),
      progress:this.live.get(request.id)?.progress??state.progress??null,
      canResolve:['needs-recovery','submission-uncertain','failed','blocked'].includes(disconnected?'needs-recovery':state.status),
      canResume:['needs-recovery','failed'].includes(disconnected?'needs-recovery':state.status)&&(Boolean(state.generationResult?.asset?.key&&state.sourceArtifact)||(state.attempts??[]).some(a=>a.providerTaskId||a.outputArtifact)),
      inputSummary:{generator:request.input.generator??'configured image API',spriteProfile:request.input.spriteProfile??null},
    };
  }
  async get(characterId,id){
    const entry=await this.raw(characterId,id),job=this.view(entry);
    if(job.canResolve){
      // A process may die before the job callback sees any attempt. The ledger
      // is authoritative for accepted IDs, independently of job completion.
      job.attempts=await this.attempts(entry.request,entry.state);
      job.canResume=job.canResume||job.attempts.some(a=>a.providerTaskId||a.outputArtifact);
    }
    return job;
  }
  async attempts(request,state){
    const keys=await this.storage.list(`build-attempts/${request.characterId}/${request.id}`);
    const observations=new Map((state.attempts??[]).map(a=>[a.attemptId,a]));
    const ledger=new GenerationAttemptLedger(this.storage.lineage);
    for(const key of keys){
      const {attemptId}=await this.storage.getJson(key),{intent,events}=await ledger.read(attemptId);
      const accepted=events.findLast(event=>event.providerTaskId),output=events.findLast(event=>event.outputArtifact);
      observations.set(attemptId,{...intent,...events.at(-1),providerTaskId:accepted?.providerTaskId??null,outputArtifact:output?.outputArtifact??null});
    }
    return [...observations.values()];
  }
  async list(characterId){
    segment(characterId);
    const keys=(await this.storage.list(`build-job-heads/${characterId}`)).filter(k=>k.endsWith('.json'));
    const jobs=await Promise.all(keys.map(async k=>this.view(await this.storage.getJson(k))));
    return jobs.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
  async submit(characterId,{idempotencyKey,tool,input}={}){
    const execute=()=>this.admit(characterId,{idempotencyKey,tool,input});
    const admitted=this.admission.catch(()=>{}).then(execute);this.admission=admitted;
    return admitted;
  }
  async admit(characterId,{idempotencyKey:id,tool,input}){
    if(this.stopping)throw failure('Build worker is draining. Try again after restart.',503);
    const root=this.root(characterId,id);
    if(!TOOLS.has(tool))throw failure('This build lane supports identity images and animation rows only.');
    const allowed=new Set(['characterId','prompt','moveId','spriteProfile','generator','referenceAssetKeys']);
    if(!input||Array.isArray(input)||Object.keys(input).some(k=>!allowed.has(k))||input.characterId!==characterId)throw failure('Invalid build inputs. Use stored references, not credentials or inline uploads.');
    if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>16000)throw failure('A prompt of 1–16000 characters is required.');
    if(input.moveId!==undefined&&!/^[a-z][a-z0-9_-]*$/.test(input.moveId))throw failure('Invalid animation row.');
    if(input.generator!==undefined&&!['image','video','pruna-video'].includes(input.generator))throw failure('Invalid generator.');
    if(input.spriteProfile!==undefined&&!['standard','wide'].includes(input.spriteProfile))throw failure('Invalid sprite profile.');
    if(input.referenceAssetKeys!==undefined){
      if(!Array.isArray(input.referenceAssetKeys)||input.referenceAssetKeys.length<1||input.referenceAssetKeys.length>4||input.referenceAssetKeys.some(key=>typeof key!=='string'||!key.startsWith(`characters/${characterId}/assets/`)||key.split('/').some(part=>!part||part==='.'||part==='..')||key.includes('\\')))throw failure('Reference assets must be owned by this character.');
      for(const key of input.referenceAssetKeys)if(!await this.storage.exists(key))throw failure('Pinned reference asset is missing.');
    }
    const inputHash=digest(Buffer.from(stableJson({tool,input})));
    if(await this.storage.exists(`${root}/request.json`)){
      const prior=await this.raw(characterId,id);
      if(prior.request.inputHash!==inputHash)throw failure('This submission key already belongs to different inputs.',409);
      return {job:this.view(prior),reused:true};
    }
    await this.start();
    const jobs=await this.list(characterId);
    const unfinished=jobs.find(j=>ACTIVE.has(j.status)||UNRESOLVED.has(j.status));
    if(unfinished){
      const prior=await this.raw(characterId,unfinished.id);
      if(prior.request.inputHash===inputHash)return {job:unfinished,reused:true};
      throw failure(`Finish or resolve build ${unfinished.id} before starting another build for this fighter.`,409);
    }
    if(this.pending.length>=20)throw failure('Build lane is full. Try after current jobs finish.',429);
    const draft=await this.repository.getDraft(characterId);
    const referenceDigests=Object.fromEntries(await Promise.all((input.referenceAssetKeys??[]).map(async key=>[key,digest(await this.storage.getBytes(key))])));
    const request={schemaVersion:2,id,characterId,tool,input,inputHash,referenceDigests,sessionId:this.sessionId,createdAt:new Date().toISOString(),draftUpdatedAt:draft.updatedAt};
    // Persistence must succeed before any executor/provider is invoked.
    await this.storage.lineage.immutable(`${root}/request.json`,Buffer.from(JSON.stringify(request)),{contentType:'application/json'});
    const state=await this.write(request,{status:'queued',phase:'Waiting for build lane',attempts:[]});
    this.pending.push({request,state});
    queueMicrotask(()=>void this.drain());
    return {job:this.view({request,state}),reused:false};
  }
  async drain(){
    if(this.running)return;this.running=true;
    try{while(this.pending.length&&!this.stopping){
      const job=this.pending.shift();
      try{if(job.recovery)await this.resume(job.request.characterId,job.request.id,{confirmed:true});else await this.execute(job);}
      catch(error){
        this.lastError=cleanText(error.message);
        try{const current=await this.raw(job.request.characterId,job.request.id);await this.write(current.request,{...current.state,status:'needs-recovery',phase:'Worker recovery stopped · no replacement submitted',error:this.lastError});}catch{/* Disconnected active heads remain visibly unresolved. */}
      }
    }}
    finally{this.running=false;}
  }
  async execute({request,state,recoveryPreparation=false}){
    const started=Date.now(),attempts=[];
    const live={progress:null};this.live.set(request.id,live);
    let writes=Promise.resolve(),lastProgress=0;
    const persist=patch=>{const next=writes.then(async()=>{state=await this.write(request,{...state,...patch});});writes=next;return next;};
    const observe=event=>{
      const index=attempts.findIndex(a=>a.attemptId===event.attemptId);
      if(index<0)attempts.push(safeProvenance(event));else attempts[index]={...attempts[index],...safeProvenance(event)};
      return persist({attempts:[...attempts],...(event.providerTaskId?{status:'provider-active',phase:'Provider accepted · waiting for result',providerTaskId:event.providerTaskId}:{})});
    };
    const context={buildJobId:request.id,
      onProgress:event=>{live.progress={type:cleanText(event.type),stage:cleanText(event.stage),message:cleanText(event.message??event.data)};
        if(Date.now()-lastProgress>500){lastProgress=Date.now();void persist({progress:live.progress}).catch(()=>{});}},
      onGenerationAttempt:event=>{const index=attempts.findIndex(a=>a.attemptId===event.attemptId);if(index<0)attempts.push(safeProvenance(event));else attempts[index]={...attempts[index],...safeProvenance(event)};},
    };
    try{
      if(recoveryPreparation){
        if((await this.raw(request.characterId,request.id)).state.status!=='preparing')throw failure('Preparation stage changed; recovery stopped.',409);
      }else await this.storage.lineage.immutable(`${this.root(request.characterId,request.id)}/claim.json`,Buffer.from(JSON.stringify({sessionId:this.sessionId,at:new Date().toISOString()})),{contentType:'application/json'});
      state=await this.write(request,{...state,status:'preparing',phase:'Checking pinned draft and references'});
      await this.repository.withMutation(request.characterId,async()=>{
        const draft=await this.repository.getDraft(request.characterId);
        if(draft.workbench?.archived){
          state=await this.write(request,{...state,status:'blocked',phase:'Character is archived · no provider call'});return;
        }
        if(draft.updatedAt!==request.draftUpdatedAt){
          state=await this.write(request,{...state,status:'blocked',phase:'Draft changed before execution; no provider call',completedAt:new Date().toISOString()});return;
        }
        for(const [key,expected] of Object.entries(request.referenceDigests??{})){
          if(!await this.storage.exists(key)||digest(await this.storage.getBytes(key))!==expected){
            state=await this.write(request,{...state,status:'blocked',phase:'Pinned reference changed before execution; no provider call',completedAt:new Date().toISOString()});return;
          }
        }
        state=await this.write(request,{...state,status:'submitting',phase:'Generating and saving candidate',startedAt:new Date().toISOString()});
        const generationStart=Date.now();
        const result=await withBuildObserver(observe,()=>this.invoke(request.tool,{...request.input,context}));
        await writes;
        const generationMs=Date.now()-generationStart;
        // Keep the returned source even if extraction subsequently fails.
        const sourceArtifact=result.asset?.key&&await this.storage.exists(result.asset.key)?await this.storage.lineage.artifact(await this.storage.getBytes(result.asset.key),{contentType:(await this.storage.getMetadata(result.asset.key))?.contentType}):null;
        state=await this.write(request,{...state,generationResult:safeProvenance(result),sourceArtifact,attempts,generationMs});
        let extraction=null;
        if(request.tool==='generate_sprite_sheet'&&!result.framesReady){
          state=await this.write(request,{...state,status:'extracting',phase:'Extracting saved source · no generation'});
          const extractionStart=Date.now();
          extraction=await this.invoke('extract_row_frames',{characterId:request.characterId,sourceAssetKey:result.asset.key,moveId:request.input.moveId??'base',spriteProfile:request.input.spriteProfile,context});
          await writes;
          state.extractionMs=Date.now()-extractionStart;
        }
        state=await this.write(request,{...state,status:'completed',phase:request.tool==='generate_sprite_sheet'?'Frames saved · visual review required':'Identity candidate saved · review required',
          result:safeProvenance({...result,...(request.tool==='generate_sprite_sheet'?{framesReady:true,extraction,warnings:[...(result.warnings??[]),...(extraction?.warnings??[])]}: {})}),attempts,executionMs:Date.now()-started,completedAt:new Date().toISOString()});
      });
    }catch(error){
      // No automatic replay, even for a network error: it may already be billed.
      try{await writes.catch(()=>{});const observed=await this.attempts(request,{attempts});const uncertain=['submitting','provider-active'].includes(state.status)&&!observed.some(a=>a.providerTaskId||a.outputArtifact);
        state=await this.write(request,{...state,status:uncertain?'submission-uncertain':'needs-recovery',phase:state.status==='extracting'?'Saved source needs extraction recovery':uncertain?'Submission outcome unknown · no automatic retry':'Build stopped; inspect history before another attempt',
        error:cleanText(error.message),attempts:observed,providerTaskId:error.taskId??null,completedAt:new Date().toISOString()});}
      catch{ /* An old running/admission record stays visibly unresolved. */ }
    }finally{this.live.delete(request.id);}
  }
  async resolve(characterId,id,{confirmed,note}={}){
    if(confirmed!==true||typeof note!=='string'||note.trim().length<10||note.length>1000)throw failure('Confirm the previous worker is stopped and record what you checked (10–1000 characters).');
    const run=async()=>{
      await this.owner.acquire();
      const entry=await this.raw(characterId,id),job=this.view(entry);
      if(this.live.has(id)||this.pending.some(j=>j.request.id===id)||!job.canResolve)throw failure('This job cannot be resolved while it is executing or already complete.',409);
      const state=await this.write(entry.request,{...entry.state,status:'resolved',phase:'Resolved by operator · no retry submitted',resolution:cleanText(note),completedAt:entry.state.completedAt??new Date().toISOString()});
      return this.view({...entry,state});
    };
    const result=this.admission.catch(()=>{}).then(run);this.admission=result;return result;
  }
  async attachTask(characterId,id,{confirmed,attemptId,providerTaskId}={}){
    if(confirmed!==true||typeof providerTaskId!=='string'||!/^[-a-zA-Z0-9_:]{1,200}$/.test(providerTaskId))throw failure('Confirm the provider task ID checked in your provider account.');
    const run=async()=>{
      await this.owner.acquire();
      const entry=await this.raw(characterId,id);
      if(this.live.has(id)||this.pending.some(j=>j.request.id===id)||!UNRESOLVED.has(entry.state.status))throw failure('Only stopped unresolved jobs can attach a task.',409);
      const ledger=new GenerationAttemptLedger(this.storage.lineage),{intent,events}=await ledger.read(segment(attemptId));
      if(intent.characterId!==characterId||intent.buildJobId!==id)throw failure('Attempt does not belong to this job.',404);
      const prior=events.findLast(e=>e.providerTaskId)?.providerTaskId;
      if(prior&&prior!==providerTaskId)throw failure('Attempt already has a different accepted task ID.',409);
      await ledger.event({...intent,status:'accepted',providerTaskId,operatorConfirmed:true});
      const attempts=await this.attempts(entry.request,entry.state);
      const state=await this.write(entry.request,{...entry.state,attempts,status:'needs-recovery',phase:'Provider task attached · resume without generation',error:null});
      return this.view({...entry,state});
    };
    const result=this.admission.catch(()=>{}).then(run);this.admission=result;return result;
  }
  async resume(characterId,id,{confirmed}={}){
    if(confirmed!==true)throw failure('Confirm the previous worker has stopped before recovering saved output.');
    // Serialize against resolution and other recovery requests in this process.
    const run=()=>this.repository.withMutation(characterId,async()=>{
      await this.owner.acquire();
      const entry=await this.raw(characterId,id);entry.state.attempts=await this.attempts(entry.request,entry.state);const job=this.view(entry);
      if(this.live.has(id)||!job.canResume)throw failure('No saved source is available for extraction recovery. Inspect provider history; no generation was submitted.',409);
      const {request}=entry;let state=entry.state;
      this.live.set(id,{progress:null});
      try{
        if(!state.generationResult?.asset?.key){
          state=await this.write(request,{...state,status:'provider-active',phase:'Recovering accepted provider task · no submission'});
          if(['video','pruna-video'].includes(request.input.generator)){
            // The adapter's recovery-only path refuses to create a new task or
            // reinterpret a changed reference as permission to submit.
            const result=await this.invoke(request.tool,{...request.input,context:{buildJobId:id,recoveryOnly:true}});
            state=await this.write(request,{...state,status:'completed',phase:'Recovered motion saved · visual review required',result:safeProvenance(result),error:null,completedAt:new Date().toISOString()});
            return this.view({request,state});
          }
          const attempts=state.attempts.filter(a=>a.providerTaskId||a.outputArtifact);
          if(attempts.length!==1)throw failure('Multiple frame attempts require manual assembly from History. No generation submitted.',409);
          const recovered=await this.recoverAttempt({storage:this.storage,characterId,attemptId:attempts[0].attemptId,confirmed:true});
          const artifact=recovered.outputArtifact;
          if(!artifact.contentType?.startsWith('image/'))throw failure('Recovered video requires its motion checkpoint. No generation submitted.',409);
          const ext=artifact.contentType==='image/webp'?'webp':artifact.contentType==='image/jpeg'?'jpg':artifact.contentType==='image/svg+xml'?'svg':'png';
          const asset=await this.repository.writeAsset(characterId,`recovered/${id}.${ext}`,await this.storage.lineage.readArtifact(artifact),{contentType:artifact.contentType});
          state=await this.write(request,{...state,generationResult:{asset,provider:attempts[0].provider,model:attempts[0].model},sourceArtifact:artifact});
        }
        const source=state.generationResult.asset.key;
        if(!await this.storage.exists(source))throw failure('Saved source is missing. Recover its archived version from History first.',409);
        if(digest(await this.storage.getBytes(source))!==state.sourceArtifact.sha256)throw failure('Saved source changed since this job. Restore its pinned archived version from History before extracting.',409);
        state=await this.write(request,{...state,status:'extracting',phase:'Recovering saved source · no provider submission'});
        const extraction=request.tool==='generate_sprite_sheet'?await this.invoke('extract_row_frames',{characterId,sourceAssetKey:source,moveId:request.input.moveId??'base',spriteProfile:request.input.spriteProfile,context:{buildJobId:id}}):null;
        state=await this.write(request,{...state,status:'completed',phase:'Recovered candidate saved · visual review required',result:{...state.generationResult,...(extraction?{framesReady:true,extraction}:{})},error:null,completedAt:new Date().toISOString()});
      }catch(error){
        state=await this.write(request,{...state,status:'needs-recovery',phase:'Saved source recovery stopped · no generation',error:cleanText(error.message)});
      }finally{this.live.delete(id);}
      return this.view({request,state});
    });
    const result=this.admission.catch(()=>{}).then(run);this.admission=result;return result;
  }
  async stream(characterId,id,{after=-1,onJob,onClose}){
    if(!Number.isSafeInteger(after)||after< -1)throw failure('Invalid event cursor.');
    await this.raw(characterId,id);
    let closed=false,replaying=true,cursor=after;const buffered=[];
    const deliver=entry=>{if(closed||entry.request.characterId!==characterId||entry.state.revision<=cursor)return;cursor=entry.state.revision;onJob({job:this.view(entry)});};
    const listener=entry=>{if(replaying)buffered.push(entry);else deliver(entry);};
    const close=()=>{if(closed)return;closed=true;this.events.off(id,listener);this.events.off('shutdown',shutdown);};
    const shutdown=()=>{close();onClose?.();};
    this.events.on(id,listener);this.events.on('shutdown',shutdown);
    try{
      const {request}=await this.raw(characterId,id);
      const keys=(await this.storage.list(`${this.root(characterId,id)}/events`)).sort().filter(key=>Number(key.split('/').at(-1).replace('.json',''))>after);
      // All messages are complete snapshots, so a bounded replay may coalesce
      // old revisions without losing final state or recovery information.
      for(const key of keys.slice(-100))deliver({request,state:await this.storage.getJson(key)});
      replaying=false;buffered.sort((a,b)=>a.state.revision-b.state.revision).forEach(deliver);
      return close;
    }catch(error){close();throw error;}
  }
}
