import {ResourceScope} from './WorkbenchSession.js';
if (!document.querySelector('link[data-benchmark-styles]')) {
  const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./benchmarks.css',import.meta.url).href;link.dataset.benchmarkStyles='';document.head.append(link);
}

const escape = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const duration = value => value == null ? 'Unknown' : `${(value/1000).toFixed(2)}s`;
const money = value => value == null ? 'Unknown' : `$${value.toFixed(4)}`;
async function json(url,body) {
  const response = await fetch(url,body ? {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)} : undefined);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
  return value;
}

export function mountBenchmarks({host,characterId}) {
  const scope=new ResourceScope();
  host.className = 'pipeline-benchmarks';
  host.innerHTML = `<header><span class="eyebrow">Measured generation</span><h2>Benchmarks & model trials</h2><p>Compare observed attempts, not promises. Missing prices stay unknown; fixtures never become provider evidence.</p></header>
    <form data-benchmark-filters><div class="benchmark-filters">${['characterId','provider','model','kind','moveId','style','resolution','measurementKind'].map(key => `<label>${escape({characterId:'Character',moveId:'Action',measurementKind:'Measurement source'}[key]??key)}<select name="${key}"><option value="">All</option></select></label>`).join('')}</div><button type="submit">Refresh measurements</button></form>
    <p data-benchmark-status role="status">Loading measurements…</p><div data-benchmark-report></div>
    <details class="benchmark-trial"><summary>Plan a controlled model trial</summary><p>Save identical reference bytes, prompts and settings without spending credits. Supported FAL/Pruna video candidates can then run one action at a time with separate confirmation. Provider-native resolution allows unequal output sizes; results are not ranked automatically.</p>
      <form data-trial-form><div class="benchmark-filters"><label>Trial name<input name="name" required maxlength="120" placeholder="Paint deformation comparison"></label><label>Character ID<input name="characterId" value="${escape(characterId??'')}" required></label><label>Reserved estimate budget (USD)<input name="budgetUsd" type="number" min="0.01" max="1000" step="0.01" required></label><label>Resolution<input name="resolution" value="provider-native" required></label><label>Duration (seconds)<input name="durationSeconds" type="number" min="1" max="30" value="6" required></label><label>Art style<input name="artStyle" value="paint" required></label></div>
      <label>Reference asset keys, one per line<textarea name="references" rows="2" required placeholder="characters/your-character/assets/source/concept.png"></textarea></label>
      <label>Provider/model candidates (JSON)<textarea name="candidates" rows="3" required>[{"provider":"fal","model":"fal-ai/kling-video/v3/standard/image-to-video"},{"provider":"pruna","model":"p-video-2-pro"}]</textarea></label>
      <label>Representative actions (JSON)<textarea name="actions" rows="3" required placeholder='[{"moveId":"walk","prompt":"Exact shared motion prompt"}]'></textarea></label>
      <button type="submit">Save trial without generating</button><p data-trial-status role="status"></p></form></details>
    <section><h3>Saved trial definitions</h3><div data-trial-list>Loading…</div></section>`;
  const filterForm = host.querySelector('[data-benchmark-filters]');
  const status = host.querySelector('[data-benchmark-status]');
  let disposed = false, initialized = false, inFlight = false, trialsSignature='';
  async function refresh() {
    if (inFlight) return;
    inFlight = true; status.textContent = 'Loading measurements…';
    try {
      const params = new URLSearchParams(new FormData(filterForm));
      if (!initialized && characterId) params.set('characterId',characterId);
      const report = await json(`/api/benchmarks?${params}`);
      if (disposed) return;
      for (const [key,values] of Object.entries(report.facets)) {
        const select = filterForm.elements.namedItem(key), selected = params.get(key)??'';
        if (!select) continue;
        select.innerHTML = `<option value="">All</option>${[...new Set([...values,...(selected?[selected]:[])])].map(value => `<option value="${escape(value)}" ${value===selected?'selected':''}>${escape(value)}</option>`).join('')}`;
      }
      initialized = true;
      const {summary,groups,reviews,jobs} = report;
      host.querySelector('[data-benchmark-report]').innerHTML = `<div class="benchmark-stats"><p><strong>${summary.attempts}</strong> unique attempts</p><p><strong>${summary.failed}</strong> failed · ${summary.unresolved} unresolved</p><p><strong>${money(summary.cost.knownSubtotalUsd)}</strong> known estimated subtotal · ${summary.cost.unknownAttempts} unknown prices</p><p><strong>${summary.retries}</strong> marked retries · ${summary.retryMetadataMissing} missing retry metadata</p></div>
        <p><a href="/api/benchmarks?${escape(params.toString())}" target="_blank" rel="noopener">Open filtered report and attempt inventory (JSON) ↗</a></p>
        <p>Matched job timings: extraction p50 ${duration(jobs.extraction.p50Ms)} / p95 ${duration(jobs.extraction.p95Ms)} (${jobs.extraction.samples} samples); execution p50 ${duration(jobs.execution.p50Ms)} (${jobs.execution.samples} samples).</p>
        <div class="benchmark-table-wrap"><table><caption>Observed cohorts — no automatic winner</caption><thead><tr><th>Source / provider / model</th><th>Action / settings</th><th>Attempts / failed</th><th>p50 / p95</th><th>Estimated cost</th></tr></thead><tbody>${groups.length ? groups.map(group => `<tr><td>${escape(group.measurementKind)}<br>${escape(group.provider)} / ${escape(group.model??'unknown model')}</td><td>${escape(group.moveId??group.kind??'unknown')}<br>${escape(group.style??'unknown style')} · ${escape(group.resolution??'unknown resolution')}</td><td>${group.attempts} / ${group.failed}<br>${group.unresolved} unresolved</td><td>${duration(group.duration.p50Ms)} / ${duration(group.duration.p95Ms)}<br>${group.duration.samples} timed samples</td><td>${money(group.cost.knownSubtotalUsd)} known<br>${group.cost.unknownAttempts} unknown prices</td></tr>`).join('') : '<tr><td colspan="5">No recorded attempts match these filters.</td></tr>'}</tbody></table></div>
        <details><summary>Recorded provider stages</summary>${groups.map(group => `<p>${escape(group.measurementKind)} · ${escape(group.provider)} / ${escape(group.model??'unknown')} · ${escape(group.moveId??'unknown action')}</p><ul>${Object.entries(group.stages).map(([name,stats]) => `<li>${escape(name)}: p50 ${duration(stats.p50Ms)} / p95 ${duration(stats.p95Ms)} · ${stats.samples} samples</li>`).join('')||'<li>No stage timings recorded.</li>'}</ul>`).join('')}</details>
        <p>Verified current reviews with matching source hashes: ${reviews.acceptedRows} accepted, ${reviews.rejectedRows} rejected, ${reviews.pendingRows} pending. Mean accepted-output attempt cost: ${money(reviews.meanAcceptedOutputAttemptCostUsd)} (${reviews.acceptedOutputsWithCompleteCost} priced outputs). This excludes unlinked retries and is not total creation cost. Full cost per accepted row or character: unavailable until rejected and failed attempts are completely linked.</p>
        <p>Recorded cohort estimate per current accepted row: ${money(report.cohort?.recordedEstimatePerCurrentAcceptedRowUsd)}. Includes all selected failed and discarded attempts, but is only available when every selected attempt has a price. This descriptive ratio is not complete lifetime creation cost.</p>
        <details><summary>Measurement limits</summary><ul>${report.limitations.map(value => `<li>${escape(value)}</li>`).join('')}</ul></details>${report.warnings.map(value => `<p class="benchmark-warning">${escape(value)}</p>`).join('')}`;
      status.textContent = `Updated ${new Date(report.generatedAt).toLocaleTimeString()}. ${report.warnings.length ? 'Some data is incomplete.' : ''}`;
    } catch(error) { if(!disposed) status.textContent = `Measurements unavailable: ${error.message}`; }
    finally { inFlight = false; }
  }
  async function refreshTrials() {
    try {
      const response = await json('/api/benchmark-trials'), trials = response.trials ?? response;
      if (disposed) return;
      const signature=JSON.stringify(trials);
      if(signature===trialsSignature||[...host.querySelectorAll('video')].some(video=>!video.paused))return;
      trialsSignature=signature;
      const opened=new Set([...host.querySelectorAll('[data-trial-id][open]')].map(element=>element.dataset.trialId));
      host.querySelector('[data-trial-list]').innerHTML = trials.length ? trials.map(trial => `<details class="benchmark-saved-trial" data-trial-id="${escape(trial.id)}" ${opened.has(trial.id)?'open':''}><summary>${escape(trial.name)} · ${trial.runs?.length?`${trial.runs.length} reserved attempts`:'saved, not submitted'}</summary><p>${escape(trial.characterId)} · ${trial.actions.length} actions · ${trial.candidates.length} candidates · budget ${money(trial.budgetUsd)}</p><p>${escape(trial.executionBlockedReason??'One request per candidate/action slot. Equal-share estimate reservations never release automatically. Provider prices are unknown; this is not an invoice cap.')}</p><p>Comparison fingerprint: <code>${escape(trial.comparisonHash)}</code></p>${!trial.executionBlockedReason?trial.candidates.map((candidate,c)=>trial.actions.map((action,a)=>{
        const run=trial.runs?.find(value=>value.candidateIndex===c&&value.actionIndex===a);
        return `<div class="benchmark-trial-slot"><p>${escape(candidate.provider)} / ${escape(candidate.model)} · ${escape(action.moveId)} · ${escape(run?.status??'not submitted')}</p>${run?.error?`<p>${escape(run.error)}</p>`:''}${run?.outputArtifact?`<video controls preload="none" src="/api/assets/${escape(run.outputArtifact.key)}" style="width:100%;max-height:300px"></video><p>Unreviewed source video — not an installed character animation.</p>`:''}${!run||run.status==='needs-recovery'?`<button type="button" data-trial-run="${escape(trial.id)}" data-candidate="${c}" data-action="${a}" data-resume="${Boolean(run)}">${run?'Resume saved request':'Run this candidate/action'}</button>`:''}</div>`;
      }).join('')).join(''):''}<pre>${escape(JSON.stringify({references:trial.references,actions:trial.actions,candidates:trial.candidates,settings:trial.settings},null,2))}</pre><p data-trial-run-status role="status"></p></details>`).join('') : '<p>No saved model trials yet.</p>';
    } catch(error) { if(!disposed) host.querySelector('[data-trial-list]').textContent = error.message; }
  }
  scope.listen(filterForm,'submit',event => {event.preventDefault();void refresh();});
  scope.listen(host.querySelector('[data-trial-form]'),'submit',async event => {
    event.preventDefault(); const form = event.currentTarget,button = form.querySelector('button'),message = form.querySelector('[data-trial-status]');
    button.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(form));
      await json('/api/benchmark-trials',{name:values.name,characterId:values.characterId,budgetUsd:Number(values.budgetUsd),referenceKeys:values.references.split('\n').map(value => value.trim()).filter(Boolean),candidates:JSON.parse(values.candidates),actions:JSON.parse(values.actions),settings:{resolution:values.resolution,durationSeconds:Number(values.durationSeconds),artStyle:values.artStyle}});
      message.textContent = 'Trial saved. No provider requests were made.';await refreshTrials();
    } catch(error) { message.textContent = error.message; }
    finally {button.disabled=false;}
  });
  scope.listen(host,'click',async event=>{
    const button=event.target.closest('[data-trial-run]');if(!button)return;
    const resume=button.dataset.resume==='true';
    if(!confirm(resume?'Resume only the saved provider request? No replacement will be submitted.':'Submit this one paid candidate/action? Price is unknown. Its equal-share reservation is an estimate, not an invoice cap.'))return;
    const message=button.closest('[data-trial-id]').querySelector('[data-trial-run-status]');button.disabled=true;
    try{await json(`/api/benchmark-trials/${button.dataset.trialRun}/${resume?'resume':'run'}`,{candidateIndex:Number(button.dataset.candidate),actionIndex:Number(button.dataset.action),confirmed:true,acceptUnknownCost:true});await refreshTrials();}
    catch(error){message.textContent=error.message;button.disabled=false;}
  });
  const trialTimer=setInterval(()=>{if(!host.isConnected||disposed){clearInterval(trialTimer);return;}void refreshTrials();},3000);
  void refresh();void refreshTrials();
  return () => {disposed=true;clearInterval(trialTimer);scope.dispose();};
}
