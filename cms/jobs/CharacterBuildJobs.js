import {randomUUID} from 'node:crypto';
import {digest,segment,safeProvenance} from '../storage/LineageStore.js';
import {stableJson} from '../pipeline/reviewFingerprint.js';

const ACTIVE=new Set(['queued','running','extracting']);
const TOOLS=new Set(['generate_character_concept','generate_sprite_sheet']);
const failure=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const cleanText=value=>String(value??'').replace(/(?:Bearer|Key)\s+\S+/gi,'[AUTH]').replace(/https?:\/\/\S+/g,'[URL]').replace(/data:\S+/g,'[MEDIA]').slice(0,700);

/** Single-process executor, storage-backed admission/results, no restart replay.
 * The immutable claim prevents an accepted job from executing twice. This is
 * deliberately not a distributed queue/lease or a replacement for attempt logs.
 */
export class CharacterBuildJobs {
  constructor({storage,repository,invoke,sessionId=randomUUID()}) {
    Object.assign(this,{storage,repository,invoke,sessionId});
    this.pending=[];this.running=false;this.admission=Promise.resolve();this.live=new Map();
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
    return record;
  }
  async raw(characterId,id){
    const root=this.root(characterId,id);
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
      progress:this.live.get(request.id)?.progress??null,
      canResolve:['needs-recovery','failed','blocked'].includes(disconnected?'needs-recovery':state.status),
      canResume:['needs-recovery','failed'].includes(disconnected?'needs-recovery':state.status)&&request.tool==='generate_sprite_sheet'&&Boolean(state.generationResult?.asset?.key&&state.sourceArtifact),
      inputSummary:{generator:request.input.generator??'configured image API',spriteProfile:request.input.spriteProfile??null},
    };
  }
  async get(characterId,id){
    const job=this.view(await this.raw(characterId,id));
    if(job.canResolve){
      // A process may die before the job callback sees any attempt. The ledger
      // is authoritative for accepted IDs, independently of job completion.
      const keys=(await this.storage.list('generation-attempts')).filter(key=>key.endsWith('/intent.json'));
      const observations=new Map((job.attempts??[]).map(attempt=>[attempt.attemptId,attempt]));
      for(const key of keys){
        const intent=await this.storage.getJson(key);
        if(intent.characterId!==characterId||intent.buildJobId!==id)continue;
        const eventKeys=await this.storage.list(key.replace('/intent.json','/events'));
        const events=await Promise.all(eventKeys.sort().map(eventKey=>this.storage.getJson(eventKey)));
        const accepted=events.findLast(event=>event.providerTaskId);
        observations.set(intent.attemptId,{...intent,...observations.get(intent.attemptId),providerTaskId:accepted?.providerTaskId??null});
      }
      job.attempts=[...observations.values()];
    }
    return job;
  }
  async list(characterId){
    segment(characterId);
    const keys=(await this.storage.list(`build-jobs/${characterId}`)).filter(k=>k.endsWith('/request.json'));
    const jobs=await Promise.all(keys.map(k=>this.get(characterId,k.split('/').at(-2))));
    return jobs.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
  async submit(characterId,{idempotencyKey,tool,input}={}){
    const execute=()=>this.admit(characterId,{idempotencyKey,tool,input});
    const admitted=this.admission.catch(()=>{}).then(execute);this.admission=admitted;
    return admitted;
  }
  async admit(characterId,{idempotencyKey:id,tool,input}){
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
    const jobs=await this.list(characterId);
    const unfinished=jobs.find(j=>ACTIVE.has(j.status)||j.status==='needs-recovery');
    if(unfinished){
      const prior=await this.raw(characterId,unfinished.id);
      if(prior.request.inputHash===inputHash)return {job:unfinished,reused:true};
      throw failure(`Finish or resolve build ${unfinished.id} before starting another build for this fighter.`,409);
    }
    if(this.pending.length>=20)throw failure('Build lane is full. Try after current jobs finish.',429);
    const draft=await this.repository.getDraft(characterId);
    const referenceDigests=Object.fromEntries(await Promise.all((input.referenceAssetKeys??[]).map(async key=>[key,digest(await this.storage.getBytes(key))])));
    const request={schemaVersion:1,id,characterId,tool,input,inputHash,referenceDigests,sessionId:this.sessionId,createdAt:new Date().toISOString(),draftUpdatedAt:draft.updatedAt};
    // Persistence must succeed before any executor/provider is invoked.
    await this.storage.lineage.immutable(`${root}/request.json`,Buffer.from(JSON.stringify(request)),{contentType:'application/json'});
    const state=await this.write(request,{status:'queued',phase:'Waiting for build lane',attempts:[]});
    this.pending.push({request,state});
    queueMicrotask(()=>void this.drain());
    return {job:this.view({request,state}),reused:false};
  }
  async drain(){
    if(this.running)return;this.running=true;
    try{while(this.pending.length)await this.execute(this.pending.shift());}
    finally{this.running=false;}
  }
  async execute({request,state}){
    const started=Date.now(),attempts=[];
    const live={progress:null};this.live.set(request.id,live);
    const context={buildJobId:request.id,
      onProgress:event=>{live.progress={type:cleanText(event.type),stage:cleanText(event.stage),message:cleanText(event.message??event.data)};},
      onGenerationAttempt:event=>attempts.push(safeProvenance(event)),
    };
    try{
      await this.storage.lineage.immutable(`${this.root(request.characterId,request.id)}/claim.json`,Buffer.from(JSON.stringify({sessionId:this.sessionId,at:new Date().toISOString()})),{contentType:'application/json'});
      await this.repository.withMutation(request.characterId,async()=>{
        const draft=await this.repository.getDraft(request.characterId);
        if(draft.updatedAt!==request.draftUpdatedAt){
          state=await this.write(request,{...state,status:'blocked',phase:'Draft changed before execution; no provider call',completedAt:new Date().toISOString()});return;
        }
        for(const [key,expected] of Object.entries(request.referenceDigests??{})){
          if(!await this.storage.exists(key)||digest(await this.storage.getBytes(key))!==expected){
            state=await this.write(request,{...state,status:'blocked',phase:'Pinned reference changed before execution; no provider call',completedAt:new Date().toISOString()});return;
          }
        }
        state=await this.write(request,{...state,status:'running',phase:'Generating and saving candidate',startedAt:new Date().toISOString()});
        const generationStart=Date.now();
        const result=await this.invoke(request.tool,{...request.input,context});
        const generationMs=Date.now()-generationStart;
        // Keep the returned source even if extraction subsequently fails.
        const sourceArtifact=result.asset?.key&&await this.storage.exists(result.asset.key)?await this.storage.lineage.artifact(await this.storage.getBytes(result.asset.key),{contentType:(await this.storage.getMetadata(result.asset.key))?.contentType}):null;
        state=await this.write(request,{...state,generationResult:safeProvenance(result),sourceArtifact,attempts,generationMs});
        let extraction=null;
        if(request.tool==='generate_sprite_sheet'&&!result.framesReady){
          state=await this.write(request,{...state,status:'extracting',phase:'Extracting saved source · no generation'});
          const extractionStart=Date.now();
          extraction=await this.invoke('extract_row_frames',{characterId:request.characterId,sourceAssetKey:result.asset.key,moveId:request.input.moveId??'base',spriteProfile:request.input.spriteProfile,context});
          state.extractionMs=Date.now()-extractionStart;
        }
        state=await this.write(request,{...state,status:'completed',phase:request.tool==='generate_sprite_sheet'?'Frames saved · visual review required':'Identity candidate saved · review required',
          result:safeProvenance({...result,...(request.tool==='generate_sprite_sheet'?{framesReady:true,extraction,warnings:[...(result.warnings??[]),...(extraction?.warnings??[])]}: {})}),attempts,executionMs:Date.now()-started,completedAt:new Date().toISOString()});
      });
    }catch(error){
      // No automatic replay, even for a network error: it may already be billed.
      try{state=await this.write(request,{...state,status:'needs-recovery',phase:state.status==='extracting'?'Saved source needs extraction recovery':'Build stopped; inspect history before another attempt',
        error:cleanText(error.message),attempts,providerTaskId:error.taskId??null,completedAt:new Date().toISOString()});}
      catch{ /* An old running/admission record stays visibly unresolved. */ }
    }finally{this.live.delete(request.id);}
  }
  async resolve(characterId,id,{confirmed,note}={}){
    if(confirmed!==true||typeof note!=='string'||note.trim().length<10||note.length>1000)throw failure('Confirm the previous worker is stopped and record what you checked (10–1000 characters).');
    const entry=await this.raw(characterId,id),job=this.view(entry);
    if(this.live.has(id)||!job.canResolve)throw failure('This job cannot be resolved while it is executing or already complete.',409);
    const state=await this.write(entry.request,{...entry.state,status:'resolved',phase:'Resolved by operator · no retry submitted',resolution:cleanText(note),completedAt:entry.state.completedAt??new Date().toISOString()});
    return this.view({...entry,state});
  }
  async resume(characterId,id,{confirmed}={}){
    if(confirmed!==true)throw failure('Confirm the previous worker has stopped before recovering saved output.');
    // Serialize against resolution and other recovery requests in this process.
    const run=()=>this.repository.withMutation(characterId,async()=>{
      const entry=await this.raw(characterId,id),job=this.view(entry);
      if(this.live.has(id)||!job.canResume)throw failure('No saved source is available for extraction recovery. Inspect provider history; no generation was submitted.',409);
      const {request}=entry;let state=entry.state;
      const source=state.generationResult.asset.key;
      if(!await this.storage.exists(source))throw failure('Saved source is missing. Recover its archived version from History first.',409);
      if(digest(await this.storage.getBytes(source))!==state.sourceArtifact.sha256)throw failure('Saved source changed since this job. Restore its pinned archived version from History before extracting.',409);
      this.live.set(id,{progress:null});
      try{
        state=await this.write(request,{...state,status:'extracting',phase:'Recovering saved source · no provider submission'});
        const extraction=await this.invoke('extract_row_frames',{characterId,sourceAssetKey:source,moveId:request.input.moveId??'base',spriteProfile:request.input.spriteProfile,context:{buildJobId:id}});
        state=await this.write(request,{...state,status:'completed',phase:'Recovered frames saved · visual review required',result:{...state.generationResult,framesReady:true,extraction},error:null,completedAt:new Date().toISOString()});
      }catch(error){
        state=await this.write(request,{...state,status:'needs-recovery',phase:'Saved source recovery stopped · no generation',error:cleanText(error.message)});
      }finally{this.live.delete(id);}
      return this.view({request,state});
    });
    const result=this.admission.catch(()=>{}).then(run);this.admission=result;return result;
  }
}
