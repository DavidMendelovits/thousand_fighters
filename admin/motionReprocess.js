import { motionMarkers } from './motionTiming.js';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function renderMotionReprocess(draft, action) {
  const row = draft.motionRows?.[action];
  if (!/^[a-f0-9]{64}$/.test(row?.sourceSha256 ?? '')) return '';
  const move = draft.moves?.find(m => m.animation === action);
  const markers = move ? motionMarkers(move) : {};
  const input = (key, label, value, min, max) => `<label>${label}<input aria-label="${escape(action)} ${label}" data-reprocess-field="${key}" type="number" min="${min}" max="${max}" step="1" value="${value}"></label>`;
  const source = `lineage/blobs/sha256/${row.sourceSha256.slice(0,2)}/${row.sourceSha256}`;
  return `<details class="motion-reprocess" data-motion-reprocess="${escape(action)}"><summary>Reprocess saved video · no generation</summary>
    <p>Choose a continuous source interval. Keeps the actor’s reference, one scale and full canvas. Creates a separate draft working copy with before/after checkpoints. Published gameplay is unchanged.</p>
    <a target="_blank" rel="noreferrer" href="/api/assets/${encodeURIComponent(source)}">Open retained source video ↗</a>
    <div class="motion-reprocess-fields">
      ${input('start','Source start (0-based)',row.sourceRange?.[0] ?? 0,0,359)}
      ${input('end','Source end (inclusive)',row.sourceRange?.[1] ?? (row.sourceFrameCount ?? 120)-1,1,359)}
      ${input('frames','Output poses',row.frameCount ?? 20,8,48)}
      ${move ? input('contact','Contact pose (1-based)',(markers.contactFrame ?? row.suggestedContactFrame ?? 8)+1,2,47)+input('recovery','Recovery pose (1-based)',(markers.recoveryFrame ?? 12)+1,3,48) : ''}
    </div>
    <label><input data-reprocess-loop type="checkbox" ${row.loop?'checked':''}> Loop interval (omit end pose at seam)</label>
    ${draft.artStyle==='paint'?'<label><input data-reprocess-matte type="checkbox" checked> Remove background color from soft paint edges</label>':''}
    ${draft.artStyle==='paint'?`<label><input data-reprocess-refine type="checkbox" ${row.provenance?.options?.refineEdges?'checked':''}> Refine pale boundary pixels using nearby paint colors</label><p>Local-color refinement adjusts compatible edge opacity. Inspect thin props and intentional pale outlines before accepting it.</p>`:''}
    <p>Contact/recovery also delimit held-grab poses. Inspect them after changing the interval. Verify paint colors and thin props after cleanup; it does not invent missing motion.</p>
    <button type="button" data-reprocess-video="${escape(action)}">Create reprocessed candidate</button>
    <p role="status" data-reprocess-status></p>
  </details>`;
}

export function readReprocessControls(host) {
  const number = key => Number(host.querySelector(`[data-reprocess-field="${key}"]`).value);
  const frames = number('frames'), start = number('start'), end = number('end'), loop=host.querySelector('[data-reprocess-loop]').checked;
  if (![frames,start,end].every(Number.isInteger) || frames<8 || frames>48 || start<0 || end>359 || end-start+(loop?0:1)<frames) throw new Error('Choose 8–48 poses and a source interval containing at least that many frames (loops omit the endpoint).');
  const hasContact = Boolean(host.querySelector('[data-reprocess-field="contact"]'));
  const contactFrame = hasContact ? number('contact')-1 : undefined, recoveryFrame = hasContact ? number('recovery')-1 : undefined;
  if (hasContact && (![contactFrame,recoveryFrame].every(Number.isInteger) || contactFrame<1 || recoveryFrame<=contactFrame || recoveryFrame>=frames)) throw new Error('Contact must precede recovery, and both poses must fit the output row.');
  return { frames, start, end, loop, matteCleanup:Boolean(host.querySelector('[data-reprocess-matte]')?.checked), refineEdges:Boolean(host.querySelector('[data-reprocess-refine]')?.checked), ...(hasContact?{contactFrame,recoveryFrame}:{}) };
}
