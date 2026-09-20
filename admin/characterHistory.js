const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const assetUrl = artifact => `/api/assets/${encodeURIComponent(artifact.key)}`;

export function mountCharacterHistory({ host, characterId, getJson, postJson, onRestore }) {
  host.innerHTML = `<summary>History & versions <span>Checkpoints · source videos · generation lineage</span></summary>
    <div class="history-content"><p class="history-storage">Loading storage status…</p>
    <div class="history-actions"><input aria-label="Checkpoint name" placeholder="Name this checkpoint" maxlength="160"><button type="button" data-history="checkpoint">Save checkpoint</button><button type="button" data-history="refresh">Refresh history</button></div>
    <p role="status" class="history-status"></p><div class="history-versions"></div><div class="history-compare"></div><div class="history-comparison"></div>
    <h3>Generation & processing history</h3><p>Inputs and outputs stay archived even when a working asset changes. Opening an artifact never generates anything.</p><label><input type="checkbox" data-history-unassigned> Show unassigned / legacy job files instead</label>
    <div class="history-events"></div><button type="button" data-history="older" hidden>Load older events</button></div>`;
  let loaded = false, cursor = null, busy = false;
  const status = host.querySelector('[role=status]');
  const base = `/api/characters/${encodeURIComponent(characterId)}/history`;

  async function load(older = false) {
    const params = new URLSearchParams();
    if (older && cursor) params.set('before', cursor);
    if (host.querySelector('[data-history-unassigned]').checked) params.set('scope', 'unassigned');
    const data = await getJson(`${base}?${params}`);
    if (!host.isConnected) return;
    loaded = true; cursor = data.nextCursor;
    host.querySelector('.history-storage').textContent = data.storage.remote
      ? `Archive backend: ${data.storage.provider}. No automatic deletion. Provider backups must be configured separately.`
      : 'Local archive only — immutable history is enabled, but this is not an off-machine backup.';
    host.querySelector('.history-versions').innerHTML = `<h3>Character checkpoints</h3>${data.versions.length ? data.versions.map(version => `<article class="history-card"><div><strong>${escape(version.label)}</strong><small>${escape(version.at)} · ${version.restorable ? `${version.assetCount} frozen assets` : 'Legacy JSON only — exact restore unavailable'}</small></div><button type="button" data-history="restore" data-version="${escape(version.versionId)}" ${version.restorable ? '' : 'disabled'}>Restore as working copy</button></article>`).join('') : '<p>No checkpoints yet. Save one before experimenting.</p>'}`;
    const comparable = data.versions.filter(version => version.restorable);
    host.querySelector('.history-compare').innerHTML = comparable.length > 1 ? `<div class="history-actions"><label>Checkpoint A <select data-compare-left>${comparable.map(v => `<option value="${escape(v.versionId)}">${escape(v.label)} · ${escape(v.at)}</option>`).join('')}</select></label><label>Checkpoint B <select data-compare-right>${comparable.map((v, i) => `<option ${i === 1 ? 'selected' : ''} value="${escape(v.versionId)}">${escape(v.label)} · ${escape(v.at)}</option>`).join('')}</select></label><button type="button" data-history="compare">Compare checkpoints</button></div>` : '';
    const events = data.events.filter(event => (event.type !== 'artifact-written' || /source\/|sources\/|concept\/|draft\//.test(event.logicalKey ?? '')) && !(event.type === 'legacy-import' && /\/(frames|compiled[^/]*\/frames)\//.test(event.logicalKey ?? '')));
    const html = events.map(event => {
      const artifact = event.output ?? event.artifact;
      const video = artifact?.contentType === 'video/mp4';
      const preview = artifact ? `<a href="${assetUrl(artifact)}" target="_blank" rel="noreferrer">Open ${video ? 'source video' : artifact.contentType.startsWith('image/') ? 'image' : 'artifact'} ↗</a>${video || artifact.contentType.startsWith('image/') ? `<details><summary>Preview</summary>${video ? `<video controls preload="none" src="${assetUrl(artifact)}"></video>` : `<img loading="lazy" alt="Archived generation" src="${assetUrl(artifact)}">`}</details>` : ''}` : '';
      return `<article class="history-card history-event"><div><strong>${escape(event.moveId ? `${event.stage ?? event.type} · ${event.moveId}` : event.stage ?? event.type)}</strong><small>${escape(event.at)} · ${escape(event.type)}${event.durationMs != null ? ` · ${(event.durationMs / 1000).toFixed(2)}s` : ''}</small><small>${escape(event.logicalKey ?? event.model ?? event.label ?? '')}</small>
        <details><summary>Provenance & settings</summary><pre>${escape(JSON.stringify(event, null, 2))}</pre></details></div>
        <div class="history-event-actions">${preview}${event.type === 'video-checkpoint' ? `<button type="button" data-history="resume" data-event="${escape(event.id)}">Recover / resume existing job</button>` : ''}${['artifact-written', 'generation-output', 'legacy-import'].includes(event.type) && artifact ? `<button type="button" data-history="branch" data-event="${escape(event.id)}">Branch source</button>` : ''}
        ${video ? `<details><summary>Re-extract without generation</summary><label>Action <input data-action value="${escape(event.moveId ?? 'idle')}" pattern="[a-z][a-z0-9_-]*"></label><label>Frames <input data-frames type="number" min="8" max="48" value="20"></label><label><input data-loop type="checkbox"> Loop</label><p>Uses this row’s body or summon reference and art style. Creates an isolated draft working copy and before/after checkpoints. For interval, paint cleanup and grab timing controls, use “Reprocess saved video” on the move card.</p><button type="button" data-history="reprocess" data-event="${escape(event.id)}">Re-extract candidate</button></details>` : ''}</div></article>`;
    }).join('');
    const container = host.querySelector('.history-events');
    if (older) container.insertAdjacentHTML('beforeend', html);
    else container.innerHTML = html || '<p>No recorded events yet. Older files can be imported with the archive migration script.</p>';
    host.querySelector('[data-history=older]').hidden = !cursor;
  }
  host.addEventListener('toggle', () => { if (host.open && !loaded) load().catch(error => status.textContent = error.message); });
  host.querySelector('[data-history-unassigned]').addEventListener('change', () => load().catch(error => status.textContent = error.message));
  host.addEventListener('click', async event => {
    const button = event.target.closest('button[data-history]');
    if (!button || busy) return;
    const action = button.dataset.history;
    if (action === 'restore' && !confirm('Restore this checkpoint into a separate working copy? The current draft will be saved as a safety checkpoint. Published gameplay will not change.')) return;
    busy = true; button.disabled = true; status.textContent = 'Working…';
    try {
      if (action === 'resume') {
        const { result } = await postJson(`${base}/resume`, { eventId: button.dataset.event });
        await load(); status.textContent = `Existing job recovered: ${result.transportStatus}. No new generation submitted.`; return;
      }
      if (action === 'compare') {
        const data = await getJson(`${base}/compare?left=${encodeURIComponent(host.querySelector('[data-compare-left]').value)}&right=${encodeURIComponent(host.querySelector('[data-compare-right]').value)}`);
        host.querySelector('.history-comparison').innerHTML = `<p>${data.changes.length} changed assets · ${data.unchanged} unchanged. Changed character fields: ${escape(data.configFields.join(', ') || 'none')}.</p>${data.changes.map(change => `<details><summary>${escape(change.kind)} · ${escape(change.path)}</summary><div class="history-compare-media">${[change.left, change.right].map((artifact, i) => `<div><strong>${i ? 'B' : 'A'}</strong>${!artifact ? '<p>Not present</p>' : `<a href="${assetUrl(artifact)}" target="_blank" rel="noreferrer">Open artifact</a>${artifact.contentType.startsWith('image/') ? `<img loading="lazy" alt="Checkpoint ${i ? 'B' : 'A'}" src="${assetUrl(artifact)}">` : artifact.contentType === 'video/mp4' ? `<video controls preload="none" src="${assetUrl(artifact)}"></video>` : ''}`}</div>`).join('')}</div></details>`).join('')}`;
        status.textContent = 'Comparison loaded. Neither checkpoint was changed.'; return;
      }
      if (action === 'checkpoint') await postJson(`${base}/checkpoint`, { label: host.querySelector('[aria-label="Checkpoint name"]').value || 'Manual checkpoint' });
      if (action === 'restore') {
        await postJson(`${base}/restore`, { versionId: button.dataset.version });
        await onRestore(); return;
      }
      if (action === 'branch') {
        const { result } = await postJson(`${base}/branch`, { eventId: button.dataset.event });
        status.textContent = `Source branch saved: ${result.key}. Use this asset as an input; no generation was submitted.`;
        await load(); return;
      }
      if (action === 'reprocess') {
        const controls = button.closest('details');
        await postJson(`${base}/reprocess`, { eventId: button.dataset.event, action: controls.querySelector('[data-action]').value, frames: Number(controls.querySelector('[data-frames]').value), loop: controls.querySelector('[data-loop]').checked });
        await onRestore(); return;
      }
      await load(action === 'older'); status.textContent = action === 'checkpoint' ? 'Checkpoint saved with frozen assets.' : 'History refreshed.';
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; button.disabled = false; }
  });
}
