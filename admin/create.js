const STEPS = [
  { id: 'concept', label: 'Concept' },
  { id: 'draft', label: 'Draft' },
  { id: 'sprites', label: 'Sprites' },
  { id: 'frames', label: 'Frames' },
  { id: 'qa', label: 'QA' },
  { id: 'done', label: 'Done' },
];

const ROW_IDS = ['base', 'punch', 'kick', 'special_1', 'special_2'];
const ROW_LABELS = { base: 'Base / Idle', punch: 'Punch', kick: 'Kick', special_1: 'Special 1', special_2: 'Special 2' };
const ROW_CHROMA = { base: '#ff00ff', punch: '#00ff00', kick: '#0000ff', special_1: '#00ffff', special_2: '#ffff00' };

const ctx = {
  highestUnlockedStep: 0,
  characterId: '',
  draft: null,
  conceptAssetUrl: '',
  conceptPrompt: '',
  sourceAssetKey: '',
  sourceAssetUrl: '',
  normalizedKey: '',
  qaReport: null,
  rowApprovals: { base: false, punch: false, kick: false, special_1: false, special_2: false },
};

// Track whether the user has manually edited the generation prompt
let promptManuallyEdited = false;

const $log = document.getElementById('create-log');
const $stepNav = document.getElementById('step-nav');

renderStepNav();
syncStepVisibility();

// --- Event listeners ---

document.getElementById('concept-form').addEventListener('submit', onGenerateConcept);
document.getElementById('btn-approve-concept').addEventListener('click', onApproveConcept);
document.getElementById('btn-regen-concept').addEventListener('click', onRegenConcept);
document.getElementById('btn-accept-draft').addEventListener('click', onAcceptDraft);
document.getElementById('btn-regen-draft').addEventListener('click', onRegenDraft);
document.getElementById('btn-gen-all').addEventListener('click', onGenerateAll);
document.getElementById('btn-accept-all').addEventListener('click', onAcceptAllRows);
document.getElementById('btn-normalize').addEventListener('click', onNormalize);
document.getElementById('custom-sheet').addEventListener('change', onUploadCustomSheet);
document.getElementById('btn-validate').addEventListener('click', onValidate);
document.getElementById('btn-publish').addEventListener('click', onPublish);
document.getElementById('btn-back-to-frames').addEventListener('click', () => scrollToStep(3));
document.getElementById('btn-create-another').addEventListener('click', onCreateAnother);

// Auto-populate generation prompt when brief or art style changes
document.getElementById('fighter-brief').addEventListener('input', onBriefOrStyleChange);
document.getElementById('art-style').addEventListener('change', onBriefOrStyleChange);

// Track manual edits to the gen-prompt textarea
document.getElementById('gen-prompt').addEventListener('input', () => {
  promptManuallyEdited = true;
});

// Reference image upload
document.getElementById('ref-image').addEventListener('change', onRefImageUpload);

// --- Step nav ---

function renderStepNav() {
  $stepNav.innerHTML = STEPS.map((step, i) =>
    `<li data-num="${i + 1}" data-step="${step.id}" data-index="${i}">${esc(step.label)}</li>`
  ).join('');

  $stepNav.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-index]');
    if (!li) return;
    const i = parseInt(li.dataset.index, 10);
    if (i <= ctx.highestUnlockedStep) scrollToStep(i);
  });
}

function unlockUpTo(index) {
  if (index > ctx.highestUnlockedStep) ctx.highestUnlockedStep = index;
  syncStepVisibility();
  scrollToStep(index);
}

function syncStepVisibility() {
  document.querySelectorAll('.step-pane').forEach((el) => {
    const stepId = el.dataset.step;
    const stepIndex = STEPS.findIndex((s) => s.id === stepId);
    if (stepIndex <= ctx.highestUnlockedStep) {
      el.classList.add('unlocked');
    } else {
      el.classList.remove('unlocked');
    }
  });

  $stepNav.querySelectorAll('li').forEach((li, i) => {
    const unlocked = i <= ctx.highestUnlockedStep;
    li.className = unlocked ? 'completed clickable' : '';
  });
}

function scrollToStep(index) {
  const pane = document.getElementById(`step-${STEPS[index].id}`);
  if (pane) pane.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// --- Step 0: Concept ---

function buildConceptPrompt() {
  const brief = document.getElementById('fighter-brief').value.trim();
  const artStyle = document.getElementById('art-style').value;
  return [brief, artStyle ? `Art style: ${artStyle}.` : ''].filter(Boolean).join(' ');
}

function onBriefOrStyleChange() {
  if (promptManuallyEdited) return;
  document.getElementById('gen-prompt').value = buildConceptPrompt();
}

async function onRefImageUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const characterId = document.getElementById('fighter-id').value.trim();
  if (!characterId) {
    log('Set a Character ID before uploading a reference image.', 'error');
    return;
  }

  setBusy(true);
  log('Analyzing reference image...');
  try {
    const imageBase64 = await fileToBase64(file);
    const result = await invokeToolStreaming('describe_character_image', {
      characterId,
      imageBase64,
      contentType: file.type || 'image/png',
    });
    const description = result.description ?? '';
    if (description) {
      document.getElementById('fighter-brief').value = description;
      promptManuallyEdited = false;
      document.getElementById('gen-prompt').value = buildConceptPrompt();
      document.getElementById('prompt-details').open = true;
      log('Reference image analyzed — brief and prompt updated.');
    } else {
      log('No description returned from image analysis.', 'error');
    }
  } catch (err) {
    log(`Error analyzing image: ${err.message}`, 'error');
  } finally {
    setBusy(false);
  }
}

async function onGenerateConcept(event) {
  event.preventDefault();
  const characterId = document.getElementById('fighter-id').value.trim();
  const brief = document.getElementById('fighter-brief').value.trim();

  if (!characterId || !brief) return;

  // If gen-prompt textarea is empty, populate it now
  const $genPrompt = document.getElementById('gen-prompt');
  if (!$genPrompt.value.trim()) {
    $genPrompt.value = buildConceptPrompt();
  }

  const prompt = $genPrompt.value.trim();

  ctx.characterId = characterId;
  ctx.conceptPrompt = prompt;

  setBusy(true);
  log(`Generating concept art for ${characterId}...`);
  document.getElementById('concept-preview').innerHTML = '<div class="spinner-text">Generating concept art&hellip;</div>';
  document.getElementById('concept-actions').style.display = 'none';

  try {
    const result = await invokeToolStreaming('generate_character_concept', { characterId, prompt });
    const assetUrl = result.asset?.apiUrl ?? result.asset?.url ?? '';
    ctx.conceptAssetUrl = assetUrl;
    log(`Concept art generated: ${result.asset?.key ?? 'unknown'}`);

    renderConceptPanels(assetUrl, result.asset?.key);
    document.getElementById('concept-actions').style.display = '';
  } catch (err) {
    log(`Error: ${err.message}`, 'error');
    document.getElementById('concept-preview').innerHTML = '';
  } finally {
    setBusy(false);
  }
}

async function onRegenConcept() {
  const characterId = document.getElementById('fighter-id').value.trim();
  const brief = document.getElementById('fighter-brief').value.trim();
  if (!characterId || !brief) return;

  const prompt = document.getElementById('gen-prompt').value.trim() || buildConceptPrompt();

  ctx.conceptPrompt = prompt;

  setBusy(true);
  log('Regenerating concept art...');
  document.getElementById('concept-preview').innerHTML = '<div class="spinner-text">Generating concept art&hellip;</div>';
  document.getElementById('concept-actions').style.display = 'none';

  try {
    const result = await invokeToolStreaming('generate_character_concept', { characterId, prompt });
    const assetUrl = result.asset?.apiUrl ?? result.asset?.url ?? '';
    ctx.conceptAssetUrl = assetUrl;
    log(`Concept art regenerated: ${result.asset?.key ?? 'unknown'}`);

    renderConceptPanels(assetUrl, result.asset?.key);
    document.getElementById('concept-actions').style.display = '';
  } catch (err) {
    log(`Error: ${err.message}`, 'error');
    document.getElementById('concept-preview').innerHTML = '';
  } finally {
    setBusy(false);
  }
}

async function onApproveConcept() {
  const characterId = document.getElementById('fighter-id').value.trim();
  const brief = document.getElementById('fighter-brief').value.trim();
  const artStyle = document.getElementById('art-style').value;

  if (!characterId || !brief) return;

  const fullBrief = [
    brief,
    artStyle ? `Art style: ${artStyle}.` : '',
  ].filter(Boolean).join(' ');

  setBusy(true);
  log(`Creating draft for ${characterId}...`);

  try {
    const result = await invokeToolStreaming('create_character_draft', { characterId, brief: fullBrief });
    ctx.draft = result.draft;
    log(`Draft created: ${ctx.draft.displayName ?? characterId}`);
    renderDraftPreview(ctx.draft);
    unlockUpTo(1);
  } catch (err) {
    log(`Error: ${err.message}`, 'error');
  } finally {
    setBusy(false);
  }
}

// --- Step 1: Draft review ---

async function onRegenDraft() {
  const brief = document.getElementById('fighter-brief').value.trim();
  if (!ctx.characterId || !brief) return;

  setBusy(true);
  log('Regenerating draft...');
  try {
    const result = await invokeToolStreaming('create_character_draft', { characterId: ctx.characterId, brief });
    ctx.draft = result.draft;
    log(`Draft regenerated: ${ctx.draft.displayName}`);
    renderDraftPreview(ctx.draft);
  } catch (err) {
    log(`Error: ${err.message}`, 'error');
  } finally {
    setBusy(false);
  }
}

// --- Step 2: Draft → Sprites ---

async function onAcceptDraft() {
  unlockUpTo(2);
  resetRowApprovals();
  renderSpriteRows();
  await generateSpriteSheet();
}

async function generateSpriteSheet() {
  setBusy(true);
  log('Generating sprite sheet...');
  setAllRowStatus('generating');

  try {
    const prompt = buildSpritePrompt();
    const result = await invokeToolStreaming('generate_sprite_sheet', { characterId: ctx.characterId, prompt });
    ctx.sourceAssetKey = result.asset.key;
    ctx.sourceAssetUrl = result.asset.apiUrl ?? result.asset.url;
    log(`Sprite sheet generated: ${result.asset.key}`);
    resetRowApprovals();
    renderSpriteRows();
  } catch (err) {
    log(`Error: ${err.message}`, 'error');
    setAllRowStatus('pending');
  } finally {
    setBusy(false);
  }
}

async function onGenerateAll() {
  resetRowApprovals();
  renderSpriteRows();
  await generateSpriteSheet();
}

async function onRegenRow(rowId) {
  ctx.rowApprovals[rowId] = false;
  renderSpriteRows();
  setBusy(true);
  log(`Regenerating sheet (improving ${rowId})...`);
  setAllRowStatus('generating');

  try {
    const approvedRows = ROW_IDS.filter((id) => ctx.rowApprovals[id]);
    const prompt = buildSpritePrompt() + (approvedRows.length
      ? ` Keep the ${approvedRows.join(', ')} rows as-is. Improve the ${rowId} row.`
      : '');
    const result = await invokeToolStreaming('generate_sprite_sheet', { characterId: ctx.characterId, prompt });
    ctx.sourceAssetKey = result.asset.key;
    ctx.sourceAssetUrl = result.asset.apiUrl ?? result.asset.url;
    log(`Sheet regenerated for ${rowId}.`);
    renderSpriteRows();
  } catch (err) {
    log(`Error: ${err.message}`, 'error');
  } finally {
    setBusy(false);
  }
}

function onApproveRow(rowId) {
  ctx.rowApprovals[rowId] = true;
  renderSpriteRows();
  syncNormalizeButton();
}

function onAcceptAllRows() {
  for (const id of ROW_IDS) ctx.rowApprovals[id] = true;
  renderSpriteRows();
  syncNormalizeButton();
}

async function onUploadCustomSheet(event) {
  const file = event.target.files?.[0];
  if (!file || !ctx.characterId) return;

  setBusy(true);
  log('Uploading custom sprite sheet...');

  try {
    const base64 = await fileToBase64(file);
    const result = await invokeTool('add_character_asset', {
      characterId: ctx.characterId,
      relativePath: `source/${ctx.characterId}_custom_sheet.png`,
      contentBase64: base64,
      contentType: 'image/png',
    });
    ctx.sourceAssetKey = result.asset.key;
    ctx.sourceAssetUrl = result.asset.apiUrl ?? result.asset.url;
    log(`Custom sheet uploaded: ${result.asset.key}`);
    resetRowApprovals();
    renderSpriteRows();
  } catch (err) {
    log(`Error: ${err.message}`, 'error');
  } finally {
    setBusy(false);
  }
}

// --- Step 3: Normalize ---

async function onNormalize() {
  if (!ctx.sourceAssetKey || !ctx.characterId) return;

  setBusy(true);
  log('Normalizing sprite pack (extracting frames)...');
  document.getElementById('frames-preview').innerHTML = '<div class="spinner-text">Extracting frames&hellip;</div>';
  unlockUpTo(3);

  try {
    const result = await invokeToolStreaming('normalize_sprite_pack', {
      characterId: ctx.characterId,
      sourceAssetKey: ctx.sourceAssetKey,
    });
    ctx.normalizedKey = result.normalized.outputKey;
    log(`Normalized: ${result.normalized.copiedFileCount} files, ${result.normalized.warnings?.length ?? 0} warnings`);
    await renderFramesPreview();
  } catch (err) {
    log(`Error: ${err.message}`, 'error');
    document.getElementById('frames-preview').innerHTML = `<div class="spinner-text" style="color:var(--danger)">Normalization failed.</div>`;
  } finally {
    setBusy(false);
  }
}

// --- Step 4: QA ---

async function onValidate() {
  if (!ctx.normalizedKey || !ctx.characterId) return;

  setBusy(true);
  log('Running QA validation...');
  unlockUpTo(4);

  try {
    const result = await invokeToolStreaming('validate_fighter_pack', {
      characterId: ctx.characterId,
      normalizedKey: ctx.normalizedKey,
    });
    ctx.qaReport = result.qa;
    log(`QA: ${result.qa.status} (${result.qa.summary?.passed ?? 0} passed, ${result.qa.summary?.errors ?? 0} errors)`);
    renderQaPreview(result.qa);
  } catch (err) {
    log(`Error: ${err.message}`, 'error');
  } finally {
    setBusy(false);
  }
}

// --- Step 5: Publish ---

async function onPublish() {
  if (!ctx.characterId) return;

  setBusy(true);
  log('Publishing fighter...');

  try {
    const releaseId = `v1-${Date.now()}`;
    const result = await invokeToolStreaming('publish_character', { characterId: ctx.characterId, releaseId });
    log(`Published: ${result.published.bundleKey}`);
    renderDonePreview(result.published);
    unlockUpTo(5);
  } catch (err) {
    log(`Error: ${err.message}`, 'error');
  } finally {
    setBusy(false);
  }
}

function onCreateAnother() {
  ctx.characterId = '';
  ctx.draft = null;
  ctx.conceptAssetUrl = '';
  ctx.conceptPrompt = '';
  ctx.sourceAssetKey = '';
  ctx.sourceAssetUrl = '';
  ctx.normalizedKey = '';
  ctx.qaReport = null;
  ctx.highestUnlockedStep = 0;
  promptManuallyEdited = false;
  resetRowApprovals();
  document.getElementById('concept-form').reset();
  document.getElementById('gen-prompt').value = '';
  document.getElementById('concept-preview').innerHTML = '';
  document.getElementById('concept-actions').style.display = 'none';
  document.getElementById('draft-preview').innerHTML = '';
  document.getElementById('sprite-rows').innerHTML = '';
  document.getElementById('frames-preview').innerHTML = '';
  document.getElementById('qa-preview').innerHTML = '';
  document.getElementById('done-preview').innerHTML = '';
  clearProcessOutput();
  $processOutput.style.display = 'none';
  syncStepVisibility();
  scrollToStep(0);
}

// --- Sprite row rendering ---

function resetRowApprovals() {
  for (const id of ROW_IDS) ctx.rowApprovals[id] = false;
  syncNormalizeButton();
}

function setAllRowStatus(status) {
  document.querySelectorAll('.row-status').forEach((el) => {
    el.className = `row-status ${status}`;
    el.textContent = status;
  });
}

function syncNormalizeButton() {
  const allApproved = ROW_IDS.every((id) => ctx.rowApprovals[id]);
  const btn = document.getElementById('btn-normalize');
  if (btn) btn.disabled = !allApproved;
}

function renderSpriteRows() {
  const $el = document.getElementById('sprite-rows');
  const hasSheet = !!ctx.sourceAssetUrl;
  const brief = document.getElementById('fighter-brief')?.value?.trim() ?? '';
  const promptSnippet = brief.length > 120 ? brief.slice(0, 120) + '...' : brief;

  $el.innerHTML = ROW_IDS.map((rowId, rowIndex) => {
    const approved = ctx.rowApprovals[rowId];
    const status = approved ? 'approved' : hasSheet ? 'pending' : 'waiting';
    const chroma = ROW_CHROMA[rowId];
    const label = ROW_LABELS[rowId];

    return `
      <div class="sprite-row" data-row="${rowId}">
        <div class="sprite-row-header">
          <div class="sprite-row-label">
            <span class="chroma-swatch" style="background:${chroma}"></span>
            <span>${esc(label)}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="row-status ${status}">${status}</span>
            <div class="sprite-row-actions">
              ${!hasSheet ? `<button type="button" data-action="gen-row" data-row="${rowId}">Generate</button>` : ''}
              ${hasSheet && !approved ? `<button type="button" data-action="approve" data-row="${rowId}">Approve</button>` : ''}
              ${hasSheet ? `<button type="button" data-action="regen" data-row="${rowId}" class="secondary">Regen</button>` : ''}
            </div>
          </div>
        </div>
        ${hasSheet && promptSnippet ? `<div class="sprite-row-prompt">row: ${esc(rowId)} | ${esc(promptSnippet)}</div>` : ''}
        ${hasSheet
          ? `<div class="sprite-row-frames">${renderRowFrames(rowIndex)}</div>`
          : `<div class="sprite-row-empty">Generate a sheet to preview this row.</div>`
        }
      </div>
    `;
  }).join('');

  $el.querySelectorAll('[data-action="gen-row"]').forEach((btn) => {
    btn.addEventListener('click', () => generateSpriteSheet());
  });
  $el.querySelectorAll('[data-action="approve"]').forEach((btn) => {
    btn.addEventListener('click', () => onApproveRow(btn.dataset.row));
  });
  $el.querySelectorAll('[data-action="regen"]').forEach((btn) => {
    btn.addEventListener('click', () => onRegenRow(btn.dataset.row));
  });

  syncNormalizeButton();
}

function renderRowFrames(rowIndex) {
  if (!ctx.sourceAssetUrl) return '';
  const cw = 150;
  const ch = 150;
  const sheetW = 900;
  const sheetH = 750;
  const frames = [];

  for (let col = 0; col < 6; col++) {
    const vx = col * cw;
    const vy = rowIndex * ch;
    frames.push(`<div style="width:${cw}px;height:${ch}px;flex-shrink:0;overflow:hidden;background:url('${esc(ctx.sourceAssetUrl)}') -${vx}px -${vy}px / ${sheetW}px ${sheetH}px no-repeat;image-rendering:pixelated;border-right:1px solid rgba(255,255,255,0.06);" title="frame ${col + 1}"></div>`);
  }

  return frames.join('');
}

// --- Other renderers ---

function renderConceptPanels(assetUrl, assetKey) {
  const $el = document.getElementById('concept-preview');
  if (!assetUrl) {
    $el.innerHTML = '<div class="spinner-text">No preview available.</div>';
    return;
  }
  const labels = ['Front', 'Profile', 'Back'];
  $el.innerHTML = `
    <div class="concept-panels">
      ${labels.map((label, i) => `
        <div class="concept-panel">
          <div class="concept-panel-img" style="background-image:url('${esc(assetUrl)}');background-position:${(i / 2) * 100}% 0;background-size:300% 100%;"></div>
          <span class="concept-panel-label">${label}</span>
        </div>
      `).join('')}
    </div>
    <details class="concept-full-sheet">
      <summary>Full sheet</summary>
      <img src="${esc(assetUrl)}" alt="Full concept sheet" />
    </details>
  `;
}

function renderDraftPreview(draft) {
  const stats = draft.stats ?? {};
  const moves = draft.moves ?? [];
  const $el = document.getElementById('draft-preview');

  $el.innerHTML = `
    <div class="draft-section">
      <h3>Identity</h3>
      <div class="stat-pills">
        <span><b>Name</b>${esc(draft.displayName ?? draft.id)}</span>
        <span><b>HP</b>${stats.maxHealth ?? '?'}</span>
      </div>
      ${draft.description ? `<p style="color:var(--muted);font-size:13px;margin:8px 0 0;line-height:1.5">${esc(draft.description)}</p>` : ''}
    </div>

    <div class="draft-section">
      <h3>Stats</h3>
      <div class="stat-pills">
        ${Object.entries(stats).map(([k, v]) => `<span><b>${esc(k)}</b>${v}</span>`).join('')}
      </div>
    </div>

    <div class="draft-section">
      <h3>Moves (${moves.length})</h3>
      <div class="move-list">
        ${moves.map((m) => {
          const phases = m.phases ?? [];
          const totalFrames = phases.reduce((s, p) => s + (p.frames ?? 0), 0);
          const hitboxes = phases.flatMap(p => (p.events ?? []).map(e => e.event)).filter(e => e?.type === 'hitbox_active').length;
          return `<div class="move-pill">
            <span><b>${esc(m.displayName ?? m.id)}</b></span>
            <span class="move-meta">${esc(m.animation ?? '?')} &middot; ${totalFrames}f &middot; ${hitboxes} hitbox${hitboxes !== 1 ? 'es' : ''}</span>
          </div>`;
        }).join('')}
      </div>
    </div>

    <div class="draft-section">
      <h3>Sprite Config</h3>
      <div class="stat-pills">
        <span><b>Scale</b>${draft.sprite?.scale ?? '?'}</span>
        ${Object.entries(draft.sprite?.frameCounts ?? {}).map(([k, v]) => `<span><b>${esc(k)}</b>${v} frames</span>`).join('')}
      </div>
    </div>
  `;
}

async function renderFramesPreview() {
  const $el = document.getElementById('frames-preview');
  try {
    const assets = await getJson(`/api/characters/${encodeURIComponent(ctx.characterId)}/assets`);
    const spriteAssets = assets.assets.filter((a) => /fighter-pack\/sprites\//.test(a.relativePath));
    const sheetAssets = assets.assets.filter((a) => /fighter-pack\/sheets\//.test(a.relativePath));

    const groups = new Map();
    for (const asset of spriteAssets) {
      const match = asset.relativePath.match(/sprites\/([^/]+)\//);
      if (!match) continue;
      const sheetId = match[1];
      if (!groups.has(sheetId)) groups.set(sheetId, []);
      groups.get(sheetId).push(asset);
    }

    const order = ['base', 'punch', 'kick', 'special_1', 'special_2'];
    const html = order.filter((id) => groups.has(id)).map((id) => {
      const frames = groups.get(id).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
      const sheet = sheetAssets.find((s) => s.relativePath.includes(`sheets/${id}.`));
      return `
        <div class="sheet-group">
          <h4>${esc(id)} (${frames.length} frames)${sheet ? ` <a href="${esc(sheet.apiUrl)}" target="_blank" style="font-size:11px;color:var(--focus)">sheet</a>` : ''}</h4>
          <div class="sheet-frames">
            ${frames.map((f) => `<img src="${esc(f.apiUrl)}" alt="${esc(f.relativePath)}" title="${esc(f.relativePath)}" />`).join('')}
          </div>
        </div>
      `;
    }).join('');

    $el.innerHTML = html || '<div class="spinner-text">No frames found.</div>';
  } catch (err) {
    $el.innerHTML = `<div class="spinner-text" style="color:var(--danger)">Failed to load frames.</div>`;
    log(`Error loading frames: ${err.message}`, 'error');
  }
}

function renderQaPreview(report) {
  const $el = document.getElementById('qa-preview');
  const summary = report.summary ?? {};
  const checks = report.checks ?? [];

  $el.innerHTML = `
    <div class="qa-summary ${report.status}">
      ${report.status === 'pass' ? 'All checks passed' : report.status === 'fail' ? `Failed: ${summary.errors} error(s)` : `Warnings: ${summary.warnings}`}
      &mdash; ${summary.passed ?? 0} passed, ${summary.warnings ?? 0} warnings, ${summary.errors ?? 0} errors
    </div>
    ${checks.map((c) => `
      <div class="qa-check ${c.status}">
        <span>${esc(c.message)}</span>
      </div>
    `).join('')}
  `;
}

function renderDonePreview(published) {
  document.getElementById('done-preview').innerHTML = `
    <div class="done-icon">&#127942;</div>
    <h3>${esc(ctx.draft?.displayName ?? ctx.characterId)} is live</h3>
    <p>Release: ${esc(published.releaseId)}<br>Bundle: ${esc(published.bundleKey)}</p>
  `;
}

// --- Process output panel ---

const $processOutput = document.getElementById('process-output');
const $processInput = document.getElementById('process-input');
const $processStdout = document.getElementById('process-stdout');

document.getElementById('btn-clear-process').addEventListener('click', clearProcessOutput);

function clearProcessOutput() {
  $processInput.textContent = '';
  $processStdout.textContent = '';
}

function showProcessOutput() {
  $processOutput.style.display = '';
}

function setProcessPrompt(text) {
  $processInput.textContent = text;
  $processInput.scrollTop = $processInput.scrollHeight;
}

function appendProcessOutput(text) {
  $processStdout.textContent += text;
  $processStdout.scrollTop = $processStdout.scrollHeight;
}

function handleProgressEvent(event) {
  if (event.type === 'prompt') {
    showProcessOutput();
    clearProcessOutput();
    setProcessPrompt(event.prompt ?? '');
  } else if (event.type === 'stdout' || event.type === 'stderr') {
    showProcessOutput();
    appendProcessOutput(event.data ?? '');
  }
  // 'complete' events are informational — no UI update needed
}

async function invokeToolStreaming(name, input) {
  log(`> ${name}`);

  const response = await fetch(`/api/tools/${name}?stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Parse SSE events from buffer — events are separated by double newlines
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 2);

      let eventType = 'message';
      let eventData = '';
      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('event: ')) eventType = line.slice(7).trim();
        else if (line.startsWith('data: ')) eventData += line.slice(6);
      }
      if (!eventData) continue;

      let parsed;
      try { parsed = JSON.parse(eventData); } catch { continue; }

      if (eventType === 'progress') {
        handleProgressEvent(parsed);
      } else if (eventType === 'result') {
        result = parsed.result;
      } else if (eventType === 'error') {
        throw new Error(parsed.error ?? 'Unknown streaming error');
      }
    }
  }

  if (result === null || result === undefined) throw new Error('Stream ended without result');
  return result;
}

// --- Helpers ---

function buildSpritePrompt() {
  const brief = document.getElementById('fighter-brief').value.trim();
  const style = document.getElementById('art-style').value;
  return [brief, style ? `Art style: ${style}.` : ''].filter(Boolean).join(' ');
}

async function invokeTool(name, input) {
  log(`> ${name}`);
  const result = await postJson(`/api/tools/${name}`, input);
  return result.result;
}

async function getJson(url) {
  const response = await fetch(url);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
  return value;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
  return value;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function setBusy(busy) {
  document.querySelectorAll('button:not(.process-control)').forEach((b) => { b.disabled = busy; });
}

function log(message, level = '') {
  const line = document.createElement('div');
  line.style.cssText = 'margin-bottom:3px;';

  if (level === 'error') {
    line.style.color = 'var(--danger)';
    line.textContent = `✗ ${message}`;
  } else if (message.startsWith('> ')) {
    line.style.color = 'var(--focus)';
    line.style.fontWeight = '600';
    line.textContent = `  → ${message.slice(2)}`;
  } else if (message.includes('generated') || message.includes('created') || message.includes('updated') || message.includes('Published')) {
    line.style.color = 'var(--accent)';
    line.textContent = `✓ ${message}`;
  } else {
    line.style.color = '#8a9ab0';
    line.textContent = message;
  }

  $log.appendChild(line);
  $log.scrollTop = $log.scrollHeight;
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
