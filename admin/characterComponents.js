import {ResourceScope} from './WorkbenchSession.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const field=(name,label,value='',type='text',extra='')=>`<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra} required></label>`;
const buttons=()=>`<label>Button<select name="button"><option value="hp">Heavy / special</option><option value="lp">Light</option><option value="lk">Medium</option><option value="grab">Grab</option></select></label><label>Direction<select name="direction"><option value="down">Down</option><option value="neutral">Neutral</option><option value="forward">Forward</option><option value="back">Back</option><option value="up">Up</option></select></label>`;

export function mountCharacterComponents({host,draft,invoke,onSaved,onOpen,onRow,scope=new ResourceScope()}) {
  const summons=(draft.actors??[]).filter(a=>a.summon),forms=draft.formDrafts??[];
  host.innerHTML=`
    <header class="component-heading"><div><span class="eyebrow">Character system</span><h3>Summons, forms & animation plan</h3><p>Design here, generate deliberately, review before publishing. These editors do not spend credits.</p></div></header>
    <p class="component-status" role="status" aria-live="polite"></p>
    ${draft.parentId?`<p class="component-notice">Hidden transformation of <strong>${esc(draft.parentId)}</strong>. Its moves and art are independent. <button type="button" data-open-component="${esc(draft.parentId)}">Return to parent</button></p>`:''}
    <div class="component-columns">
      <details class="component-editor"><summary>Summons <span>${summons.length}</span></summary>
        <ul class="component-list">${summons.map(a=>`<li><span><strong>${esc(a.id)}</strong><small>${esc(a.description??'Controlled entity')}</small></span><button type="button" data-edit-summon="${esc(a.id)}">Edit</button></li>`).join('')||'<li>No summons yet.</li>'}</ul>
        <form data-component-form="summon"><h4>Create or edit a summon</h4><div class="component-fields">
          ${field('actorId','Actor id','', 'text','pattern="[a-z][a-z0-9_]{1,63}" placeholder="floating_hands"')}
          <label class="component-wide">Appearance & movement<textarea name="description" required rows="2" placeholder="Describe the isolated entity and how it moves"></textarea></label>
          ${field('seconds','Lifetime (seconds)',4,'number','min="0.02" max="10" step="0.01"')}
          ${field('speed','Movement speed',4,'number','min="0.1" max="12" step="0.1"')}
          ${field('offsetX','Spawn X',80,'number','min="-300" max="300"')}${field('offsetY','Spawn Y',-35,'number','min="-300" max="300"')}${buttons()}
        </div><p class="move-note">The body stays vulnerable. A summon command and a neutral-heavy recall are added; use Tune on their move cards for timing.</p><div class="component-actions"><button type="submit">Save summon</button><button type="button" data-reset-component="summon">New summon</button></div></form>
        ${summons.length?`<form data-component-form="summon-move"><h4>Add a controlled strike or grab</h4><div class="component-fields"><label>Summon<select name="actorId">${summons.map(a=>`<option>${esc(a.id)}</option>`).join('')}</select></label><label>Starting move<select name="sourceMoveId">${(draft.moves??[]).map(m=>`<option value="${esc(m.id)}">${esc(m.displayName??m.id)}</option>`).join('')}</select></label>${field('moveId','New move / row id','','text','pattern="[a-z][a-z0-9_]{1,63}"')}${field('displayName','Move name')}${buttons()}</div><p class="move-note">Copies contact and timing into a new animation row, never source art, body movement or effects. Choose a strike or grab without projectile/transform events. Tune the contact and grip before generation.</p><button type="submit">Add summon move</button></form>`:''}
      </details>
      <details class="component-editor"><summary>Transformations <span>${forms.length+(draft.forms??[]).filter(f=>!forms.some(s=>s.id===f.id)).length}</span></summary>
        <ul class="component-list">${forms.map(f=>{const installed=draft.forms?.find(x=>x.id===f.id);return `<li><span><strong>${esc(f.name)}</strong><small>${f.durationTicks===null?'Until KO':`${f.durationTicks/60}s`} · ${f.cost} meter · ${installed?'Snapshot installed':'Not installed'}</small></span><div class="component-actions"><button type="button" data-open-component="${esc(f.characterId)}">Open workspace</button><button type="button" data-edit-form="${esc(f.id)}">Rules</button><button type="button" data-install-form="${esc(f.id)}">Install reviewed snapshot</button></div></li>`;}).join('')||'<li>No authoring forms yet.</li>'}
        ${(draft.forms??[]).filter(f=>!forms.some(s=>s.id===f.id)).map(f=>`<li><span><strong>${esc(f.name)}</strong><small>Existing runtime form. Preserved; advanced JSON editor remains available.</small></span></li>`).join('')}</ul>
        ${draft.parentId?'<p>Nested transformations are not supported.</p>':`<form data-component-form="form"><h4>Create or edit a hidden form</h4><div class="component-fields">${field('formId','Unique form id','','text','pattern="[a-z][a-z0-9_]{1,63}" placeholder="paint_storm"')}${field('name','Form name')}<label class="component-wide">New form art brief<textarea name="description" rows="2" required placeholder="Describe its independent silhouette, material and movement"></textarea></label><label>Expiry<select name="expiry"><option value="timed">Timed</option><option value="ko">Until knockout</option></select></label>${field('seconds','Duration (seconds)',12,'number','min="0.02" max="600" step="0.01"')}${field('cost','Meter cost',50,'number','min="0" max="100"')}</div><p class="move-note">Creates an independent draft with starter mechanics and no inherited artwork. Finish its animation plan, install a reviewed snapshot here, then publish the parent. Runtime transformation uses the existing Form control.</p><div class="component-actions"><button type="submit">Save form</button><button type="button" data-reset-component="form">New form</button></div></form>`}
      </details>
    </div>
    <details class="animation-plan-panel"><summary>Animation job plan <span data-plan-count></span></summary><div class="component-actions"><label>Show<select data-plan-filter><option value="all">All rows</option><option value="todo">Needs work</option><option value="approved">Approved</option></select></label><button type="button" data-refresh-plan>Refresh plan</button></div><div data-animation-plan aria-live="polite">Loading animation requirements…</div></details>`;
  const status=host.querySelector('.component-status');
  const controlled=host.querySelector('[data-component-form="summon-move"]');
  if(controlled){controlled.elements.button.value='lp';controlled.elements.direction.value='neutral';}
  const updateExpiry=()=>{const form=host.querySelector('[data-component-form="form"]');if(form)form.elements.seconds.disabled=form.elements.expiry.value==='ko';};
  scope.listen(host,'change',event=>{if(event.target.name==='expiry')updateExpiry();});
  let plan=null,busy=false;
  const tell=message=>{status.textContent=message;if(message!=='Saving…')status.scrollIntoView({block:'nearest'});};
  async function mutate(name,input){
    if(busy)return;
    busy=true;host.querySelectorAll('button').forEach(b=>b.disabled=true);tell('Saving…');
    try{await invoke(name,{characterId:draft.id,...input});if(!scope.disposed)await onSaved();}
    catch(error){tell(error.message);}
    finally{busy=false;host.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  const set=(form,values)=>{for(const [key,value] of Object.entries(values))if(form.elements.namedItem(key))form.elements.namedItem(key).value=value;updateExpiry();form.closest('details').open=true;form.scrollIntoView({block:'nearest'});};
  scope.listen(host,'submit',event=>{
    const form=event.target.closest('[data-component-form]');if(!form)return;event.preventDefault();
    const data=Object.fromEntries(new FormData(form));
    if(form.dataset.componentForm==='summon')void mutate('define_summon',{...data,durationTicks:Math.round(Number(data.seconds)*60),speed:Number(data.speed),offsetX:Number(data.offsetX),offsetY:Number(data.offsetY)});
    if(form.dataset.componentForm==='summon-move')void mutate('add_summon_move',data);
    if(form.dataset.componentForm==='form')void mutate('define_form',{formId:data.formId,name:data.name,description:data.description,cost:Number(data.cost),durationTicks:data.expiry==='ko'?null:Math.round(Number(data.seconds)*60)});
  });
  scope.listen(host,'click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.openComponent)void onOpen(button.dataset.openComponent);
    if(button.dataset.installForm)void mutate('install_reviewed_form',{formId:button.dataset.installForm});
    if(button.dataset.resetComponent){const form=host.querySelector(`[data-component-form="${button.dataset.resetComponent}"]`);form.reset();updateExpiry();form.querySelector('input').readOnly=false;const description=form.elements.namedItem('description');if(description)description.required=true;}
    if(button.dataset.editSummon){
      const actor=summons.find(a=>a.id===button.dataset.editSummon),move=draft.moves?.find(m=>m.phases.some(p=>p.events?.some(e=>e.event.type==='summon_control'&&e.event.actor===actor.id))),spec=move?.phases.flatMap(p=>p.events??[]).find(e=>e.event.type==='summon_control'&&e.event.actor===actor.id)?.event;
      const form=host.querySelector('[data-component-form="summon"]');set(form,{actorId:actor.id,description:actor.description??actor.id,seconds:(spec?.duration??240)/60,speed:spec?.speed??4,offsetX:spec?.offsetX??80,offsetY:spec?.offsetY??-35,button:move?.trigger.sequence?.[0]??'hp',direction:move?.trigger.directions?.[0]??'neutral'});form.elements.actorId.readOnly=true;
    }
    if(button.dataset.editForm){const rule=forms.find(f=>f.id===button.dataset.editForm),form=host.querySelector('[data-component-form="form"]');set(form,{formId:rule.id,name:rule.name,cost:rule.cost,expiry:rule.durationTicks===null?'ko':'timed',seconds:(rule.durationTicks??720)/60,description:''});form.elements.formId.readOnly=true;form.elements.description.required=false;form.elements.description.placeholder='Edit the art brief in the form workspace.';}
    if(button.hasAttribute('data-refresh-plan'))void refresh();
    if(button.dataset.planRow){const job=plan.scopes.flatMap(s=>s.jobs).find(j=>j.id===button.dataset.planRow);if(job.characterId===draft.id)onRow(job.row);else void onOpen(job.characterId);}
  });
  scope.listen(host.querySelector('[data-plan-filter]'),'change',renderPlan);
  function renderPlan(){
    const target=host.querySelector('[data-animation-plan]'),filter=host.querySelector('[data-plan-filter]').value;
    const jobs=plan.scopes.flatMap(scope=>scope.jobs),remaining=jobs.filter(job=>!['approved','reference-ready'].includes(job.status)).length;
    host.querySelector('[data-plan-count]').textContent=`· ${remaining} of ${jobs.length} rows need work`;
    target.innerHTML=plan.scopes.map(scope=>`<section class="plan-scope"><h4>${esc(scope.displayName??scope.characterId)} ${scope.formId?'<span class="eyebrow">Hidden form</span>':''}</h4>${scope.error?`<p>${esc(scope.error)}</p>`:''}${scope.installedVersionId?`<p class="move-note">Installed snapshot ${esc(scope.installedVersionId)}${scope.hasUninstalledEdits?' · Newer draft edits are not installed.':''}</p>`:''}<div class="plan-rows">${scope.jobs.filter(j=>filter==='all'||(filter==='approved'?j.status==='approved':!['approved','reference-ready'].includes(j.status))).map(j=>`<div class="plan-row"><span><strong>${esc(j.row)}</strong><small>${esc(j.actorId??'Body')} · ${esc(j.nextAction)}</small></span><span class="plan-state" data-state="${esc(j.status)}">${esc(j.status.replaceAll('-',' '))}</span><button type="button" data-plan-row="${esc(j.id)}">${j.characterId===draft.id?'Open row':'Open form'}</button></div>`).join('')||'<p>No rows match this filter.</p>'}</div></section>`).join('');
  }
  async function refresh(){try{plan=await invoke('get_animation_plan',{characterId:draft.id});if(!scope.disposed&&host.isConnected)renderPlan();}catch(error){host.querySelector('[data-animation-plan]').textContent=`Could not load plan: ${error.message}`;}}
  void refresh();
}
