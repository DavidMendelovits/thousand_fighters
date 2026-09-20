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
  const rows = (detail?.rows ?? []).filter(row => row.clipUrl && row.available === row.frameCount);
  return `<section class="workbench-preview" id="workbench-preview"><header class="concept-section-header"><div><span class="eyebrow">Current draft · shared Animation Lab viewer</span><h3>Motion & playtest</h3></div></header>
    ${rows.length ? `<div class="preview-toolbar"><label>Animation<select data-preview-row aria-label="Preview animation">${rows.map(row => `<option value="${esc(row.row)}" ${row.row === 'idle' ? 'selected' : ''}>${esc(row.row.replaceAll('_',' '))} · ${row.frameCount} poses · ${esc(row.review)}</option>`).join('')}</select></label><button type="button" data-preview-motion>Review motion</button><button type="button" data-preview-testbed>Play current draft</button><button type="button" data-preview-close hidden>Close preview</button></div><p class="move-note">Frame stepping, timing, zoom, background and anchors use the Motion review viewer. Playtest uses this draft, not an older published copy.</p>` : `<p class="preview-empty">${detail?.frameCount ? 'Extracted sprites exist, but no complete sheet is available for the timeline. Re-extract a row or open Playtest.' : 'No extracted animations yet. This is an unfinished draft—not a playable fighter.'}</p>${detail?.frameCount ? '<button type="button" data-preview-testbed>Play current draft</button>' : ''}`}
    <iframe data-workbench-preview title="Current character motion preview" hidden allow="autoplay"></iframe><p data-preview-status role="status"></p>
  </section>`;
}

export function mountPreview({ host, detail, gameBase }) {
  const frame = host.querySelector('[data-workbench-preview]');
  const status = host.querySelector('[data-preview-status]');
  const close = host.querySelector('[data-preview-close]');
  function open(kind) {
    const row = host.querySelector('[data-preview-row]')?.value;
    const entry = detail.rows.find(item => item.row === row);
    if (kind === 'motion' && !entry?.clipUrl) return;
    const url = new URL(kind === 'motion' ? '/animation-lab.html' : '/testbed.html', gameBase);
    if (kind === 'motion') { url.searchParams.set('embed', '1'); url.searchParams.set('clip', entry.clipUrl); }
    else url.searchParams.set('id', detail.id);
    frame.src = url.href; frame.hidden = false; if (close) close.hidden = false;
    status.textContent = kind === 'motion' ? `Reviewing ${row.replaceAll('_', ' ')} from this draft.` : 'Live testbed · keyboard and touch controls · draft data';
    frame.title = kind === 'motion' ? 'Current character motion preview' : 'Current character playable testbed';
  }
  host.querySelector('[data-preview-motion]')?.addEventListener('click', () => open('motion'));
  host.querySelector('[data-preview-row]')?.addEventListener('change', () => { if (!frame.hidden) open('motion'); });
  host.querySelector('[data-preview-testbed]')?.addEventListener('click', () => open('testbed'));
  close?.addEventListener('click', () => { frame.removeAttribute('src'); frame.hidden = true; close.hidden = true; status.textContent = 'Preview closed.'; });
  return { open };
}
