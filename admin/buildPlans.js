const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const referencePreview=step=>`<div class="build-plan-reference-images">${[step.conceptAsset,...(step.reviewAssets??[])].filter(Boolean).map((url,index)=>`<a href="${escape(url)}" target="_blank" rel="noopener"><img src="${escape(url)}" alt="${index===0?'Identity reference':'Actor or base reference frame'}" loading="lazy"></a>`).join('')}</div><small>Open these current images at full size. Check identity, facing and edge clipping. Approval is bound to their saved fingerprint; actor references are frozen separately from animation outputs.</small>`;
async function request(url,body){const response=await fetch(url,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:undefined);const data=await response.json();if(!response.ok)throw Error(data.error??`HTTP ${response.status}`);return data;}

/** Saved plans never auto-run on mount, refresh or navigation. */
export function mountBuildPlans({host,characterId,onReload}){
  if(!host)return ()=>{};
  if(!document.querySelector('link[data-build-plans-css]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/cms-admin/buildPlans.css';link.dataset.buildPlansCss='true';document.head.append(link);}
  let disposed=false,busy=false;
  const url=`/api/characters/${encodeURIComponent(characterId)}/build-plans`;
  host.innerHTML=`<section class="build-plans-panel"><h3>Build plan</h3><p>Save the required rows and a submission budget. Review identity and motion before buying more. Each continuation submits at most one generation.</p>
    <details><summary>New saved plan</summary><form data-plan-form>
      <label>Direction <textarea name="prompt" maxlength="12000" placeholder="Material, movement and readable combat intent"></textarea></label>
      <label>Motion provider <select name="generator"><option value="video">Configured FAL video</option><option value="pruna-video">Pruna video</option><option value="image">Configured image API</option></select></label>
      <label>Estimated-spend ceiling ($) <input name="budgetUsd" type="number" min="0" max="10000" step="0.01" value="5" required></label>
      <label>Maximum submissions <input name="maxSubmissions" type="number" min="1" max="200" value="4" required></label>
      <label>Estimated price per generation ($; blank = unknown) <input name="estimatedCostUsd" type="number" min="0" step="0.001"></label>
      <label><input name="allowUnknownCosts" type="checkbox"> Allow unknown prices within the submission limit</label>
      <p>Estimates are not provider billing caps. Unknown costs are never counted as free. This plan does not change provider account limits.</p>
      <button type="submit">Save plan · no generation</button></form></details>
    <p data-plan-message role="status"></p><div data-plan-list></div></section>`;
  const message=host.querySelector('[data-plan-message]');
  async function load(){
    const result=await request(url),plans=Array.isArray(result)?result:result.plans??[];
    if(disposed)return;
    host.querySelector('[data-plan-list]').innerHTML=plans.slice(0,8).map(plan=>`<article class="card"><h4>${escape(plan.status)} · ${escape(new Date(plan.createdAt).toLocaleString())}</h4>
      <p>${escape(plan.message??plan.notice)}</p><p>${plan.budget.reservedSubmissions}/${plan.budget.maxSubmissions} submissions reserved · $${Number(plan.budget.reservedUsd).toFixed(2)} estimated reserved / $${Number(plan.budget.budgetUsd).toFixed(2)} · ${plan.budget.unknownReservations} unknown-price reservations</p>
      <details><summary>${plan.steps.filter(s=>s.status==='kept').length}/${plan.steps.length} steps kept · inspect itinerary</summary><ol>${plan.steps.map(step=>`<li>${escape(step.characterId)} / ${escape(step.row)} · ${escape(step.kind)} — ${escape(step.status)}${step.representative?' · representative motion':''}${step.actorId?` · actor ${escape(step.actorId)}`:''}${step.kind==='reference'&&step.status==='review'&&step.reviewFingerprint?`${referencePreview(step)} <button type="button" data-review-plan="${escape(plan.id)}" data-review-step="${escape(step.id)}" data-fingerprint="${escape(step.reviewFingerprint)}">Approve inspected ${step.actorId?'actor':'base'} reference</button>`:''}</li>`).join('')}</ol>${plan.blockers.length?`<p>Remaining requirements</p><ul>${plan.blockers.map(b=>`<li>${escape(b)}</li>`).join('')}</ul>`:''}</details>
      <button type="button" data-advance="${escape(plan.id)}" ${plan.status==='complete'?'disabled':''}>Check reviews / continue one step</button> <button type="button" data-reload-draft>Reload saved draft</button></article>`).join('')||'<p>No saved plans yet.</p>';
  }
  async function action(work){if(busy)return;busy=true;message.textContent='Working…';try{await work();await load();message.textContent='Saved. Nothing runs automatically.';}catch(error){if(!disposed)message.textContent=error.message;}finally{busy=false;}}
  host.querySelector('form').addEventListener('submit',event=>{event.preventDefault();const data=new FormData(event.target);void action(()=>request(url,{prompt:data.get('prompt'),generator:data.get('generator'),budgetUsd:Number(data.get('budgetUsd')),maxSubmissions:Number(data.get('maxSubmissions')),estimatedCostUsd:data.get('estimatedCostUsd')===''?null:Number(data.get('estimatedCostUsd')),allowUnknownCosts:data.has('allowUnknownCosts')}));});
  host.addEventListener('click',event=>{const button=event.target.closest('[data-advance]');if(button){if(!confirm('Check current reviews and, if ready, submit ONE generation using this plan’s reserved budget? Provider charges may apply.'))return;void action(()=>request(`${url}/${button.dataset.advance}/advance`,{confirmed:true}));}const review=event.target.closest('[data-review-plan]');if(review){const notes=prompt('Inspect these reference frames first. Record identity, direction and clipping checks (at least 10 characters):');if(notes)void action(()=>request(`${url}/${review.dataset.reviewPlan}/review`,{stepId:review.dataset.reviewStep,expectedFingerprint:review.dataset.fingerprint,notes,confirmed:true}));}if(event.target.closest('[data-reload-draft]')&&confirm('Reload the saved draft? Unsaved edits in this workspace will be discarded.'))onReload?.();});
  void load().catch(error=>{if(!disposed)message.textContent=error.message;});
  return ()=>{disposed=true;};
}
