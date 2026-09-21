// Reparent the existing editors rather than rebuilding them on tab changes:
// unsaved move text and the embedded Gym remain alive in one draft workspace.
const saved = new Map();

export function mountWorkbenchLayout({host,characterId,groups,preview}){
  // v2 makes focus and all-moves truly exclusive workspaces instead of a card
  // filter sitting beneath an always-on preview.
  const storageKey=`tf-studio-view:v2:${characterId}`;
  if(!saved.has(characterId)){
    try{
      const value=JSON.parse(sessionStorage.getItem(storageKey));
      if(value&&typeof value==='object')saved.set(characterId,value);
    }catch{/* Storage may be disabled. Editing still works. */}
  }
  const preference=saved.get(characterId)??{
    section:'motion',view:'focus',row:groups.find(group=>group.id==='idle')?.id??groups[0]?.id,
  };
  saved.set(characterId,preference);
  const persist=()=>{try{sessionStorage.setItem(storageKey,JSON.stringify(preference));}catch{/* In-memory preferences remain available. */}};

  const nav=document.createElement('nav');
  const roster=document.querySelector('.roster-panel');
  if(roster&&!roster.querySelector('[data-roster-toggle]')){
    const toggle=document.createElement('button');
    toggle.type='button';toggle.dataset.rosterToggle='';toggle.textContent='Show roster';toggle.setAttribute('aria-expanded','false');
    roster.querySelector('.panel-heading').append(toggle);
    toggle.addEventListener('click',()=>{
      const collapsed=roster.classList.toggle('roster-collapsed');
      toggle.textContent=collapsed?'Show roster':'Hide roster';toggle.setAttribute('aria-expanded',String(!collapsed));
    });
    if(matchMedia('(max-width:700px)').matches)roster.classList.add('roster-collapsed');
  }

  nav.className='workbench-sections';nav.setAttribute('aria-label','Character workspace');
  const labels={motion:'Motion & moves',combos:'Combos & effects',anchors:'Anchors & bounds',identity:'Identity & forms',build:'Build & publish',history:'History'};
  nav.innerHTML=Object.entries(labels).map(([id,label])=>`<button type="button" data-studio-section="${id}" aria-pressed="false">${label}</button>`).join('');
  host.querySelector('.character-summary').after(nav);

  const previewHost=host.querySelector('#workbench-preview');
  const sections={};
  const selectors={motion:'.move-board',combos:'.kit-board',identity:'.reference-review, .combat-rules-editor, #character-components',build:'#character-build-plans, #character-build-jobs, #publish-readiness, .qa-section',history:'#character-history'};
  for(const [id,selector] of Object.entries(selectors)){
    const section=document.createElement('div');section.dataset.studioPanel=id;section.className='studio-section-content';
    for(const node of host.querySelectorAll(selector))section.append(node);
    host.append(section);sections[id]=section;
  }
  const description=host.querySelector('.character-summary p');
  const movement=host.querySelector('.summary-side');
  if(description)sections.identity.prepend(description);
  if(movement)sections.identity.prepend(movement);

  const board=host.querySelector('.move-board');
  const comboControls=document.createElement('section');comboControls.className='combo-preview-controls';
  const comboList=host.querySelector('[data-kit="combos"] > .kit-list');
  if(comboList){comboControls.append(comboList);previewHost.querySelector('header').after(comboControls);}

  const toolbar=document.createElement('section');
  toolbar.className='animation-browser';toolbar.setAttribute('aria-label','Motion workspace view');
  toolbar.innerHTML=`
    <div class="animation-browser-copy">
      <span class="eyebrow">Motion workspace</span>
      <strong data-animation-view-title>Focus on one move</strong>
      <p data-animation-view-description>Review one animation beside its generation, move data and source controls.</p>
    </div>
    <div class="animation-browser-choice">
      <div role="group" aria-label="Motion workspace view">
        <button type="button" data-animation-view="focus">Focus one move</button>
        <button type="button" data-animation-view="all">All moves</button>
      </div>
      <span data-animation-count></span>
    </div>`;
  nav.after(toolbar);toolbar.after(previewHost);
  const selector=previewHost.querySelector('[data-preview-row]');

  function row(id,load=true){
    if(!groups.some(group=>group.id===id))id=groups[0]?.id;
    preference.row=id;if(selector)selector.value=id??'';
    for(const card of board.querySelectorAll('[data-move-card]')){
      card.hidden=preference.view==='focus'&&card.dataset.moveCard!==id;
      card.classList.toggle('selected-move',card.dataset.moveCard===id);
    }
    board.dataset.animationView=preference.view;
    if(load)preview.selectRow(id);
    persist();
  }

  function syncPreviewVisibility(){
    const motion=preference.section==='motion';
    const visible=(motion&&preference.view==='focus')||preference.section==='combos'||preference.section==='anchors';
    previewHost.hidden=!visible;toolbar.hidden=!motion;
    if(!visible)preview.suspend();
  }

  function view(value){
    preference.view=value==='all'?'all':'focus';
    toolbar.querySelectorAll('[data-animation-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.animationView===preference.view)));
    toolbar.querySelector('[data-animation-view-title]').textContent=preference.view==='focus'?'Focus on one move':'Browse the complete motion library';
    toolbar.querySelector('[data-animation-view-description]').textContent=preference.view==='focus'
      ?'Review one animation beside its generation, move data and source controls.'
      :'Scan every animation, compare sheets and jump into any move for detailed review.';
    toolbar.querySelector('[data-animation-count]').textContent=preference.view==='focus'?'1 selected move':`${groups.length} move sheets`;
    row(preference.row,false);syncPreviewVisibility();
    if(preference.section==='motion'&&preference.view==='focus')preview.open('motion');
    persist();
  }

  function choose(id,{open=true}={}){
    if(!labels[id])id='motion';preference.section=id;
    nav.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.studioSection===id)));
    for(const [name,section] of Object.entries(sections))section.hidden=name!==id;
    comboControls.hidden=id!=='combos';syncPreviewVisibility();
    if(open&&id==='anchors')preview.open('gym');
    if(open&&id==='motion'&&preference.view==='focus')preview.open('motion');
    if(open&&id==='combos')preview.open('testbed');
    if(id==='history')host.querySelector('#character-history').open=true;
    persist();
  }

  nav.addEventListener('click',event=>{const button=event.target.closest('[data-studio-section]');if(button)choose(button.dataset.studioSection);});
  toolbar.addEventListener('click',event=>{const button=event.target.closest('[data-animation-view]');if(button)view(button.dataset.animationView);});
  host.addEventListener('preview-row-change',event=>{row(event.detail.row,false);if(preference.section==='combos')choose('motion',{open:false});});
  previewHost.querySelector('[data-preview-motion]')?.addEventListener('click',()=>choose('motion',{open:false}));
  board.addEventListener('click',event=>{
    const button=event.target.closest('[data-inspect-row]');if(!button)return;
    row(button.dataset.inspectRow);view('focus');previewHost.scrollIntoView({block:'start',behavior:'smooth'});
  });

  row(preference.row);view(preference.view);choose(preference.section);
  return {choose,selectRow(id){choose('motion',{open:false});row(id);view('focus');previewHost.scrollIntoView({block:'start'});}};
}
