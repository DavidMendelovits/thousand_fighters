const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function renderReference(reference, fallbackAsset, brief) {
  const url = reference?.url ?? fallbackAsset?.apiUrl;
  const status = reference?.status ?? 'unreviewed';
  return `<section class="concept-section reference-review" data-reference-status="${esc(status)}">
    <header class="concept-section-header"><div><span class="eyebrow">Identity source · no automatic cropping</span><h3>Reference art</h3></div><button type="button" data-gen-concept>${url ? 'Generate replacement' : 'Generate reference'}</button></header>
    ${url ? `<figure class="reference-stage"><img src="${esc(url)}" alt="Complete character reference, uncropped"><figcaption>Full source image · proportions preserved · <a href="${esc(url)}" target="_blank" rel="noreferrer">Open original ↗</a></figcaption></figure>
    <p class="reference-verdict"><strong>${esc(status.toUpperCase())}</strong> · ${status === 'approved' ? 'This exact image was reviewed.' : status === 'rejected' ? 'Do not use this image for new motion.' : 'Check silhouette, material, direction, margins and consistency before using this for motion.'}</p>
    ${reference ? `<label class="art-brief-label">Reference review notes<textarea data-reference-notes rows="2" placeholder="What matches, or what needs to change?">${esc(reference.notes)}</textarea></label><div class="button-row"><button type="button" data-reference-review="approved">Approve this reference</button><button type="button" data-reference-review="rejected">Reject this reference</button></div>` : ''}` : '<p class="empty-inline">No reference yet. Create and review an isolated identity image before generating motion.</p>'}
    <details class="reference-prompt"><summary>Edit visual identity brief</summary><label class="art-brief-label">Appearance and material only<textarea data-art-brief rows="5">${esc(brief)}</textarea></label><p class="move-note">Move lists and input instructions belong in character definitions, not the identity image.</p><button type="button" data-save-art-brief>Save visual brief</button></details>
  </section>`;
}

export function renderPreview(detail) {
  const rows = detail?.rows ?? [];
  return `<section class="workbench-preview" id="workbench-preview"><header class="concept-section-header"><div><span class="eyebrow">Current draft</span><h3>Animation preview</h3></div></header>
    ${rows.length ? `<div class="preview-toolbar"><label>Animation<select data-preview-row aria-label="Preview animation">${rows.map(row => `<option value="${esc(row.row)}" ${row.row === 'idle' ? 'selected' : ''}>${esc(row.row.replaceAll('_',' '))} · ${row.frameCount} poses · ${esc(row.review)}</option>`).join('')}</select></label><button type="button" data-preview-motion>Review motion</button><button type="button" data-preview-testbed ${detail?.frameCount?'':'disabled'}>Play current draft</button><button type="button" data-preview-close hidden>Hide preview</button></div>` : `<p class="preview-empty">${detail?.frameCount ? 'No complete motion clip. Re-extract a row or open Playtest.' : 'No animations yet. Generate a reference and motion rows to build this fighter.'}</p>${detail?.frameCount ? '<button type="button" data-preview-testbed>Play current draft</button>' : ''}`}
    ${rows.length?'<div class="preview-timing"><label>Timing<select data-preview-timing aria-label="Preview timing"><option value="game">Game timing</option><option value="source">All extracted poses</option></select></label><label data-preview-move-label hidden>Move variant<select data-preview-move aria-label="Preview move variant"></select></label><span>Use Playtest to check contact, hitstop and grabs.</span></div>':''}
    <p data-preview-status role="status" aria-live="polite"></p><p data-preview-save-status role="status"></p>
    <iframe data-workbench-preview data-preview-kind="motion" title="Current character motion preview" hidden allow="autoplay"></iframe>
    <iframe data-preview-kind="testbed" title="Current character playable testbed" hidden allow="autoplay"></iframe>
    <iframe data-preview-kind="gym" title="Current character anchors and bounds editor" hidden allow="autoplay"></iframe>
  </section>`;
}

export function mountPreview({ host, detail, gameBase }) {
  const status = host.querySelector('[data-preview-status]');
  const close = host.querySelector('[data-preview-close]');
  const moveSelect=host.querySelector('[data-preview-move]');
  let lastRow, activeKind, pendingCombo, dirty=false, disposed=false;
  const timers=new Map();
  const origin=new URL(gameBase).origin;
  const frames=[...host.querySelectorAll('[data-preview-kind]')];
  function open(kind, options={}) {
    const frame=frames.find(f=>f.dataset.previewKind===kind);
    if(!frame)return;
    activeKind=kind;
    host.dataset.mode=kind;
    frames.forEach(f=>{f.hidden=f!==frame;f.contentWindow?.postMessage({type:'studio-preview-visibility',visible:f===frame},origin);});
    if (close) close.hidden=false;
    const row = host.querySelector('[data-preview-row]')?.value;
    const entry = detail.rows?.find(item => item.row === row);
    if (kind === 'motion' && (!entry?.clipUrl || entry.available !== entry.frameCount)) {
      frame.hidden=true; status.textContent=`${row?.replaceAll('_',' ')??'This animation'} has no complete motion clip yet. Generate or recover its frames below.`;return;
    }
    const url = new URL(kind === 'motion' ? '/animation-lab' : kind==='gym'?'/gym':'/testbed', gameBase);
    url.searchParams.set('embed','1');
    if (kind === 'motion') {
      if(lastRow!==row){
        moveSelect.innerHTML=(entry.moves??[]).map(move=>`<option value="${esc(move.id)}">${esc(move.name)}</option>`).join('');
        host.querySelector('[data-preview-move-label]').hidden=(entry.moves?.length??0)<2;lastRow=row;
      }
      const clip=new URL(entry.clipUrl,gameBase);
      clip.searchParams.set('timing',host.querySelector('[data-preview-timing]').value);
      if(moveSelect.value)clip.searchParams.set('move',moveSelect.value);
      url.searchParams.set('embed', '1'); url.searchParams.set('clip', clip.pathname+clip.search);
    }
    else {url.searchParams.set('id', detail.id);if(kind==='gym'&&row)url.searchParams.set('row',row);}
    if(kind==='testbed')pendingCombo=options.combo??null;
    // Preserve the live Gym document across row/tab switches: it may have unsaved anchors.
    if(kind==='gym'&&frame.hasAttribute('src')) {
      frame.contentWindow?.postMessage({type:'studio-select-row',row},origin);
      status.textContent='Anchor edits are unsaved until you click Save.';return;
    }
    if(frame.getAttribute('src')===url.href) {
      status.textContent=kind==='motion'?`Reviewing ${row.replaceAll('_',' ')} · current draft.`:'Live engine preview · current draft.';
      if(pendingCombo)frame.contentWindow?.postMessage({type:'studio-preview-combo',moves:pendingCombo},origin);
      return;
    }
    status.textContent=`Loading ${kind==='gym'?'anchor editor':kind==='motion'?'motion':'game engine'}…`;
    clearTimeout(timers.get(kind));
    timers.set(kind,setTimeout(()=>{if(!disposed&&activeKind===kind)status.textContent='Preview is taking longer than expected. Check the embedded error message or try reopening the preview.';},20000));
    frame.src=url.href;
  }
  host.querySelector('[data-preview-motion]')?.addEventListener('click', () => open('motion'));
  host.querySelector('[data-preview-row]')?.addEventListener('change', () => {
    host.dispatchEvent(new CustomEvent('preview-row-change',{bubbles:true,detail:{row:host.querySelector('[data-preview-row]').value}}));open(activeKind==='gym'?'gym':'motion');
  });
  for(const selector of ['[data-preview-timing]','[data-preview-move]'])host.querySelector(selector)?.addEventListener('change',()=>open('motion'));
  host.querySelector('[data-preview-testbed]')?.addEventListener('click', () => open('testbed'));
  close?.addEventListener('click', () => {frames.forEach(f=>{f.hidden=true;f.contentWindow?.postMessage({type:'studio-preview-visibility',visible:false},origin);});close.hidden=true;status.textContent='Preview hidden. Anchor edits are kept until you save or leave this character.';});
  function message(event) {
    if(event.origin!==origin)return;
    const frame=frames.find(f=>f.contentWindow===event.source);if(!frame)return;
    const kind=frame.dataset.previewKind;
    if(event.data?.type==='studio-preview-ready') {
      clearTimeout(timers.get(kind));
      if(activeKind===kind)status.textContent=kind==='gym'?'Drag anchors and collision bounds. Save writes to this same draft.':'Ready · current draft · real game timing.';
      if(kind==='testbed'&&pendingCombo)frame.contentWindow.postMessage({type:'studio-preview-combo',moves:pendingCombo},origin);
      if(host.hidden||frame.hidden)frame.contentWindow.postMessage({type:'studio-preview-visibility',visible:false},origin);
    }
    if(event.data?.type==='studio-gym-dirty')dirty=event.data.dirty===true;
    if(event.data?.type==='studio-gym-saved') {
      host.querySelector('[data-preview-save-status]').textContent='Anchors / bounds saved to draft. Reopen motion or playtest to load the saved revision.';
      for(const other of frames.filter(f=>f!==frame))other.removeAttribute('src');
    }
  }
  window.addEventListener('message',message);
  return {open, suspend(){frames.forEach(frame=>frame.contentWindow?.postMessage({type:'studio-preview-visibility',visible:false},origin));},selectRow(row){const select=host.querySelector('[data-preview-row]');if(select&&[...select.options].some(o=>o.value===row))select.value=row;else if(select){select.add(new Option(row.replaceAll('_',' '),row));select.value=row;}open('motion');},
    canLeave(){return !dirty||confirm('There are unsaved anchor or bounds edits. Discard them and reload the editor?');},
    dispose(){disposed=true;timers.forEach(clearTimeout);window.removeEventListener('message',message);}};
}
