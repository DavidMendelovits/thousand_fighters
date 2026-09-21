const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
import {sha256,submissionNonce} from './submissionKey.js';
const active=new Set(['queued','running','extracting']);
const endpoint=characterId=>`/api/characters/${encodeURIComponent(characterId)}/build-jobs`;
const elapsed=ms=>Number.isFinite(ms)?`${(ms/1000).toFixed(1)}s`:'—';
async function json(url,body){
  const response=await fetch(url,{signal:AbortSignal.timeout(20000),...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>({error:`Server returned an unreadable response (HTTP ${response.status}).`}));
  if(!response.ok)throw new Error(data.error??`HTTP ${response.status}`);
  return data;
}

// Store the submission nonce before the POST. A lost response can then be
// recovered without silently purchasing another generation. No SSE fallback.
export async function runBuildJob({tool,input,onProgress}){
  onProgress?.({type:'status',message:'Starting: securing a recoverable submission…'});
  const canonical=JSON.stringify({tool,input:Object.fromEntries(Object.entries(input).sort(([a],[b])=>a.localeCompare(b)))});
  const hash=sha256(canonical);
  const key=`tf-build:${input.characterId}:${hash}`;
  let id=localStorage.getItem(key);
  if(!id){id=submissionNonce();localStorage.setItem(key,id);}
  onProgress?.({type:'status',message:'Submitting job… Your submission key is saved; please do not submit a duplicate.'});
  let job;
  try{({job}=await json(endpoint(input.characterId),{idempotencyKey:id,tool,input}));}
  catch(error){throw new Error(`${error.message} Check Build activity before submitting again; your submission key has been kept.`);}
  window.dispatchEvent(new CustomEvent('build-job-submitted',{detail:{characterId:input.characterId}}));
  let prior='';
  while(true){
    const progress=JSON.stringify([job.status,job.phase,job.progress]);
    if(progress!==prior){onProgress?.({type:'status',message:job.progress?.message||job.phase});prior=progress;}
    if(job.status==='completed'){localStorage.removeItem(key);return job.result;}
    if(!active.has(job.status)){
      if(job.status==='resolved'||job.status==='blocked')localStorage.removeItem(key);
      throw new Error(`${job.phase}. ${job.error??'See Build activity for details.'}`);
    }
    await new Promise(resolve=>setTimeout(resolve,1200));
    try{({job}=await json(`${endpoint(input.characterId)}/${job.id}`));}
    catch{throw new Error('Connection lost. The submitted build may still be running. Reopen Build activity; do not start a replacement blindly.');}
  }
}

function renderJob(job){
  const source=job.generationResult?.asset?.apiUrl;
  const attempts=job.attempts??[];
  const knownCosts=attempts.map(a=>a.estimatedCostUsd).filter(Number.isFinite);
  const cost=knownCosts.length===attempts.length&&attempts.length?` · estimated $${knownCosts.reduce((a,b)=>a+b,0).toFixed(4)}`:'';
  return `<article class="build-job" data-build-id="${escape(job.id)}" data-build-status="${escape(job.status)}">
    <div class="build-job-title"><strong>${escape(job.row??'Identity image')}</strong><span class="build-status">${escape(job.status.replaceAll('-',' '))}</span></div>
    <p>${escape(job.phase)}</p>
    <p class="build-metrics"><time data-build-duration="${escape(job.id)}">${elapsed(job.durationMs)}</time> elapsed${Number.isFinite(job.generationMs)?` · generation & save ${elapsed(job.generationMs)}`:''}${Number.isFinite(job.extractionMs)?` · extraction ${elapsed(job.extractionMs)}`:''} · ${escape(job.inputSummary.generator)}${cost}</p>
    ${job.error?`<p class="build-error">${escape(job.error)}</p>`:''}
    ${job.canResolve?attempts.filter(a=>a.attemptId&&a.providerTaskId).map(a=>['bfl-klein','minimax-h3'].includes(a.provider)||(a.provider==='fal'&&a.kind==='image')?`<p><button type="button" data-attempt-recover="${escape(a.attemptId)}">Recover ${escape(a.provider)} result</button> Task ${escape(a.providerTaskId)} · archives a candidate; does not install or approve it.</p>`:`<p>${escape(a.provider)} task ${escape(a.providerTaskId)}: use Open asset history, select its video checkpoint, then Resume. No new submission.</p>`).join(''):''}
    <div class="build-job-actions">${job.status==='completed'?'<button type="button" data-build-reload>Reload saved draft</button>':''}${job.canResume?`<button type="button" data-build-resume="${escape(job.id)}">Recover saved frames</button>`:''}<button type="button" data-build-history>Open asset history</button>${typeof source==='string'&&source.startsWith('/api/assets/')?`<a href="${escape(source)}" target="_blank" rel="noopener">Saved source ↗</a>`:''}</div>
    ${job.canResolve?`<details class="build-recovery"><summary>Resolve interrupted build</summary><p>Check asset history and the provider task first. If a video or image was saved, recover it from History instead of paying to regenerate. This action only unlocks the build lane; it does not retry or recover assets.</p><label><input type="checkbox" data-build-confirm> I confirmed the previous worker has stopped and checked its output.</label><label>What did you check?<textarea data-build-note rows="2" minlength="10" maxlength="1000" placeholder="Record the saved output or failed task you checked"></textarea></label><button type="button" data-build-resolve="${escape(job.id)}">Resolve without retrying</button><p data-build-resolution-status role="status"></p></details>`:''}
    ${job.resolution?`<p>Resolution: ${escape(job.resolution)}</p>`:''}
    <details class="build-diagnostics"><summary>Job details</summary><p>${escape(job.id)} · ${escape(job.createdAt)}</p><p>${attempts.length} recorded attempt observation(s). Detailed attempt benchmarks and lineage remain in History; missing cost is unknown, not free.</p></details>
  </article>`;
}

export function mountBuildJobs({host,characterId,onReload,onHistory}){
  host.className='character-build-jobs';
  host.innerHTML='<div class="release-heading"><div><span class="eyebrow">Creation pipeline</span><h3>Build activity</h3><p>Submitted identity and row jobs stay here after a refresh. Frames are extracted on the server; every candidate still needs review.</p></div><button type="button" data-build-refresh>Refresh status</button></div><p class="build-scope">One build at a time. A stopped server requires recovery, never an automatic paid retry. Earlier generations remain in asset History.</p><p data-build-message role="status"></p><div data-build-list>Loading saved jobs…</div>';
  let timer,stopped=false,inFlight=false,signature='';
  const message=host.querySelector('[data-build-message]');
  const refresh=async()=>{
    if(!host.isConnected){dispose();return;}
    if(inFlight)return;inFlight=true;
    try{
      const {jobs}=await json(endpoint(characterId));
      if(!host.isConnected)return;
      const visible=[...jobs.filter(j=>active.has(j.status)||j.canResolve),...jobs.filter(j=>!active.has(j.status)&&!j.canResolve)].slice(0,8);
      const next=JSON.stringify(visible.map(({durationMs,progress,...job})=>job));
      if(next!==signature){host.querySelector('[data-build-list]').innerHTML=visible.length?visible.map(renderJob).join(''):'<p class="build-empty">No tracked builds yet. Use Generate in Identity & forms or Motion & moves.</p>';signature=next;}
      for(const job of visible){const time=host.querySelector(`[data-build-duration="${CSS.escape(job.id)}"]`);if(time)time.textContent=elapsed(job.durationMs);}
      message.textContent=jobs.length>8?`Showing 8 of ${jobs.length} jobs, with unresolved work first.`:'';
    }catch(error){if(host.isConnected)message.textContent=`Status unavailable: ${error.message}. This does not mean the build stopped.`;}
    finally{inFlight=false;clearTimeout(timer);if(!stopped)timer=setTimeout(refresh,2500);}
  };
  const submitted=event=>{if(event.detail.characterId===characterId)void refresh();};
  const dispose=()=>{stopped=true;clearTimeout(timer);window.removeEventListener('build-job-submitted',submitted);};
  host.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.matches('[data-build-refresh]'))return void refresh();
    if(button.matches('[data-build-history]'))return onHistory();
    if(button.matches('[data-attempt-recover]')){
      if(!confirm('Confirm the previous worker has stopped. Poll and archive the existing provider task? This does not submit a new generation or install the recovered candidate.'))return;
      button.disabled=true;
      try{const result=await json(`/api/characters/${encodeURIComponent(characterId)}/generation-attempts/${encodeURIComponent(button.dataset.attemptRecover)}/recover`,{confirmed:true});message.textContent=`Recovered candidate archived at ${result.outputArtifact?.key??'asset history'}. Installation and visual review are still required.`;}
      catch(error){message.textContent=error.message;}finally{button.disabled=false;}
      return;
    }
    if(button.matches('[data-build-resume]')){
      if(!confirm('Confirm the previous worker has stopped. Recover frames from the saved source? No new generation will be submitted.'))return;
      button.disabled=true;
      try{await json(`${endpoint(characterId)}/${button.dataset.buildResume}/resume`,{confirmed:true});await refresh();}
      catch(error){message.textContent=error.message;}finally{button.disabled=false;}
      return;
    }
    if(button.matches('[data-build-reload]')){
      if(confirm('Reload the saved draft? Unsaved edits in this workbench will be discarded.'))await onReload();
      return;
    }
    if(!button.matches('[data-build-resolve]'))return;
    const card=button.closest('[data-build-id]'),status=card.querySelector('[data-build-resolution-status]');button.disabled=true;
    try{
      await json(`${endpoint(characterId)}/${button.dataset.buildResolve}/resolve`,{confirmed:card.querySelector('[data-build-confirm]').checked,note:card.querySelector('[data-build-note]').value});
      await refresh();
    }catch(error){status.textContent=error.message;}
    finally{button.disabled=false;}
  });
  window.addEventListener('build-job-submitted',submitted);void refresh();
  return dispose;
}
