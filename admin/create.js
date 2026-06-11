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
  rowAssets: { base: null, punch: null, kick: null, special_1: null, special_2: null },
  normalizedKey: '',
  qaReport: null,
  rowApprovals: { base: false, punch: false, kick: false, special_1: false, special_2: false },
  refImageUrl: '',
};

// Track whether the user has manually edited the generation prompt
let promptManuallyEdited = false;

// --- localStorage persistence ---

// Tracks the current storage key so we can migrate on id change and clean up on publish/reset
let currentStorageKey = '';
let _saveDebounceTimer = null;

function getStorageKey(characterId) {
  return characterId ? `tf-wizard-${characterId}` : '';
}

const WIZARD_STATE_PATH = 'wizard/state.json';

function buildWizardPayload(characterId) {
  return {
    savedAt: Date.now(),
    ctx: {
      highestUnlockedStep: ctx.highestUnlockedStep,
      characterId: ctx.characterId,
      draft: ctx.draft,
      conceptAssetUrl: ctx.conceptAssetUrl,
      conceptPrompt: ctx.conceptPrompt,
      rowAssets: { ...ctx.rowAssets },
      normalizedKey: ctx.normalizedKey,
      qaReport: ctx.qaReport,
      rowApprovals: { ...ctx.rowApprovals },
      refImageUrl: ctx.refImageUrl,
    },
    form: {
      fighterId: characterId,
      brief: document.getElementById('fighter-brief').value,
      artStyle: document.getElementById('art-style').value,
      genPrompt: document.getElementById('gen-prompt').value,
      promptManuallyEdited,
    },
  };
}

// Once the draft exists server-side, the server copy of the wizard state is
// the source of truth; localStorage is a fast pointer + offline fallback.
async function pushWizardStateToServer(payload) {
  if (!ctx.characterId) return;
  try {
    const json = JSON.stringify(payload);
    await fetch(`/api/characters/${encodeURIComponent(ctx.characterId)}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        relativePath: WIZARD_STATE_PATH,
        contentBase64: btoa(unescape(encodeURIComponent(json))),
        contentType: 'application/json',
        metadata: { artifactType: 'wizard-state' },
      }),
    });
  } catch (_) {
    // Offline or server restart — localStorage still has the state.
  }
}

async function fetchServerWizardState(characterId) {
  try {
    const key = `characters/${characterId}/assets/${WIZARD_STATE_PATH}`;
    const response = await fetch(`/api/assets/${encodeURIComponent(key)}`);
    if (!response.ok) return null;
    return await response.json();
  } catch (_) {
    return null;
  }
}

function saveWizardState() {
  const characterId = document.getElementById('fighter-id').value.trim();
  if (!characterId) return;

  const key = getStorageKey(characterId);
  const payload = buildWizardPayload(characterId);

  try {
    localStorage.setItem(key, JSON.stringify(payload));
    currentStorageKey = key;
  } catch (err) {
    // localStorage quota exceeded or unavailable — silently ignore
  }

  void pushWizardStateToServer(payload);
}

function debouncedSave() {
  clearTimeout(_saveDebounceTimer);
  _saveDebounceTimer = setTimeout(saveWizardState, 500);
}

function clearWizardState() {
  if (currentStorageKey) {
    try { localStorage.removeItem(currentStorageKey); } catch (_) {}
    currentStorageKey = '';
  }
  void pushWizardStateToServer({ savedAt: Date.now(), completed: true });
}

async function restoreWizardState() {
  // Scan localStorage for any tf-wizard-* keys, pick the most recently saved one
  let bestKey = null;
  let bestSavedAt = 0;

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('tf-wizard-')) continue;
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      let parsed;
      try { parsed = JSON.parse(raw); } catch { continue; }
      if (parsed.savedAt > bestSavedAt) {
        bestSavedAt = parsed.savedAt;
        bestKey = k;
      }
    }
  } catch (_) {
    return;
  }

  if (!bestKey) return;

  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(bestKey));
  } catch {
    return;
  }
  if (!saved || !saved.ctx || !saved.form) return;

  // The server copy wins when it is newer (another browser/session continued
  // this wizard) or when it marks the wizard completed.
  const savedCharacterId = saved.ctx.characterId || saved.form.fighterId;
  if (savedCharacterId) {
    const serverState = await fetchServerWizardState(savedCharacterId);
    if (serverState?.completed) {
      try { localStorage.removeItem(bestKey); } catch (_) {}
      return;
    }
    if (serverState?.ctx && serverState?.form && (serverState.savedAt ?? 0) > (saved.savedAt ?? 0)) {
      saved = serverState;
    }
  }

  // Restore form fields
  const { form } = saved;
  if (form.fighterId) document.getElementById('fighter-id').value = form.fighterId;
  if (form.brief) document.getElementById('fighter-brief').value = form.brief;
  if (form.artStyle) document.getElementById('art-style').value = form.artStyle;
  if (form.genPrompt) document.getElementById('gen-prompt').value = form.genPrompt;
  promptManuallyEdited = !!form.promptManuallyEdited;

  // Restore ctx
  Object.assign(ctx, saved.ctx);
  // Migrate old saved states that don't have rowAssets
  if (!ctx.rowAssets) {
    ctx.rowAssets = { base: null, punch: null, kick: null, special_1: null, special_2: null };
  }
  currentStorageKey = bestKey;

  // Re-render unlocked steps
  syncStepVisibility();

  if (ctx.conceptAssetUrl) {
    renderConceptPanels(ctx.conceptAssetUrl);
    document.getElementById('concept-actions').style.display = '';
  }

  if (ctx.draft) {
    renderDraftPreview(ctx.draft);
  }

  if (ROW_IDS.some((id) => ctx.rowAssets[id])) {
    renderSpriteRows();
  }

  if (ctx.normalizedKey) {
    renderFramesPreview();
  }

  if (ctx.qaReport) {
    renderQaPreview(ctx.qaReport);
  }

  // Show saved reference image thumbnail if available
  if (ctx.refImageUrl) {
    showRefImageThumbnail(ctx.refImageUrl);
  }

  log(`Restored in-progress wizard for "${form.fighterId}".`);
}

function showRefImageThumbnail(url) {
  // Remove any existing thumbnail first
  const existing = document.getElementById('ref-image-thumbnail');
  if (existing) existing.remove();

  const refInput = document.getElementById('ref-image');
  if (!refInput) return;

  const thumb = document.createElement('img');
  thumb.id = 'ref-image-thumbnail';
  thumb.src = url;
  thumb.alt = 'Reference image';
  thumb.style.cssText = 'display:block;max-width:80px;max-height:80px;margin-top:6px;border-radius:4px;border:1px solid rgba(255,255,255,0.15);object-fit:cover;';
  refInput.insertAdjacentElement('afterend', thumb);
}

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

// Debounced saves on form field changes
document.getElementById('fighter-brief').addEventListener('input', debouncedSave);
document.getElementById('art-style').addEventListener('change', debouncedSave);
document.getElementById('gen-prompt').addEventListener('input', debouncedSave);

// Fighter ID changes: migrate storage key if id changes
document.getElementById('fighter-id').addEventListener('input', () => {
  const newKey = getStorageKey(document.getElementById('fighter-id').value.trim());
  if (newKey && newKey !== currentStorageKey) {
    if (currentStorageKey) {
      try { localStorage.removeItem(currentStorageKey); } catch (_) {}
    }
    currentStorageKey = newKey;
  }
  debouncedSave();
});

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

    // Save the reference image as a character asset so it persists after refresh
    try {
      const ext = file.type === 'image/jpeg' ? 'jpg' : 'png';
      const saveResult = await invokeTool('add_character_asset', {
        characterId,
        relativePath: `source/reference.${ext}`,
        contentBase64: imageBase64,
        contentType: file.type || 'image/png',
      });
      ctx.refImageUrl = saveResult.asset?.apiUrl ?? saveResult.asset?.url ?? '';
      if (ctx.refImageUrl) {
        showRefImageThumbnail(ctx.refImageUrl);
        log('Reference image saved as asset.');
      }
    } catch (saveErr) {
      log(`Warning: could not save reference image as asset: ${saveErr.message}`, 'error');
    }

    saveWizardState();
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
    saveWizardState();
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
    saveWizardState();
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
    saveWizardState();
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
    saveWizardState();
  } catch (err) {
    log(`Error: ${err.message}`, 'error');
  } finally {
    setBusy(false);
  }
}

// --- Step 2: Draft → Sprites ---

async function onAcceptDraft() {
  unlockUpTo(2);
  renderSpriteRows();
  await onGenerateAll();
}

async function generateRowSheet(rowId) {
  setBusy(true);
  setRowStatus(rowId, 'generating');
  log(`Generating ${rowId} sprite row...`);

  try {
    const prompt = buildSpritePrompt();
    const result = await invokeToolStreaming('generate_sprite_sheet', {
      characterId: ctx.characterId,
      prompt,
      moveId: rowId,
    });
    ctx.rowAssets[rowId] = {
      key: result.asset.key,
      url: result.asset.apiUrl ?? result.asset.url,
    };
    ctx.rowApprovals[rowId] = false;
    log(`${rowId} row generated: ${result.asset.key}`);

    // Auto-extract individual frames from the row sheet
    try {
      log(`Extracting frames from ${rowId} row...`);
      await invokeTool('extract_row_frames', {
        characterId: ctx.characterId,
        sourceAssetKey: result.asset.key,
        moveId: rowId,
      });
      log(`${rowId} frames extracted.`);
    } catch (extractErr) {
      log(`Frame extraction failed: ${extractErr.message}`, 'error');
      // Non-fatal: the source sheet is still available
    }

    renderSpriteRows();
    saveWizardState();
  } catch (err) {
    log(`Error generating ${rowId}: ${err.message}`, 'error');
    setRowStatus(rowId, 'pending');
  } finally {
    setBusy(false);
  }
}

async function onGenerateAll() {
  for (const rowId of ROW_IDS) {
    ctx.rowApprovals[rowId] = false;
    ctx.rowAssets[rowId] = null;
  }
  renderSpriteRows();

  for (const rowId of ROW_IDS) {
    await generateRowSheet(rowId);
  }
}

async function onRegenRow(rowId) {
  ctx.rowApprovals[rowId] = false;
  ctx.rowAssets[rowId] = null;
  renderSpriteRows();
  await generateRowSheet(rowId);
}

function onApproveRow(rowId) {
  ctx.rowApprovals[rowId] = true;
  renderSpriteRows();
  syncNormalizeButton();
  saveWizardState();
}

function onAcceptAllRows() {
  for (const id of ROW_IDS) ctx.rowApprovals[id] = true;
  renderSpriteRows();
  syncNormalizeButton();
  saveWizardState();
}

// --- Step 3: Normalize ---

async function onNormalize() {
  if (!ctx.characterId) return;

  setBusy(true);
  log('Reviewing extracted frames...');
  document.getElementById('frames-preview').innerHTML = '<div class="spinner-text">Loading frames&hellip;</div>';
  unlockUpTo(3);

  try {
    // Row extraction already normalized each generated row into the fighter
    // pack (frames + anchors + frameData). This step just reviews the result.
    const packRoot = `characters/${ctx.characterId}/assets/fighter-pack`;
    ctx.normalizedKey = `${packRoot}/manifest.json`;

    const ROW_SET = ['base', 'punch', 'kick', 'special_1', 'special_2'];
    let presentSheets = [];
    try {
      const frameDataResponse = await fetch(`/api/assets/${encodeURIComponent(`${packRoot}/frameData.json`)}`);
      if (frameDataResponse.ok) {
        const frameData = await frameDataResponse.json();
        presentSheets = ROW_SET.filter((id) => (frameData.frames?.[id] ?? []).length > 0);
      }
    } catch (_) { /* pack not started yet */ }

    const missingSheets = ROW_SET.filter((id) => !presentSheets.includes(id));
    if (presentSheets.length) log(`Extracted rows in the pack: ${presentSheets.join(', ')}.`);
    if (missingSheets.length) {
      log(`Missing rows: ${missingSheets.join(', ')} — go back to Sprites and generate them before QA.`, 'error');
    } else {
      log('All five rows are extracted and anchored.', 'pass');
    }

    saveWizardState();
    await renderFramesPreview();
  } catch (err) {
    log(`Error: ${err.message}`, 'error');
    document.getElementById('frames-preview').innerHTML = `<div class="spinner-text" style="color:var(--danger)">Failed to load frames.</div>`;
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
    saveWizardState();
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
    clearWizardState();
  } catch (err) {
    log(`Error: ${err.message}`, 'error');
  } finally {
    setBusy(false);
  }
}

function onCreateAnother() {
  // Clear persisted state BEFORE resetting ctx (use currentStorageKey, not ctx.characterId)
  clearWizardState();

  ctx.characterId = '';
  ctx.draft = null;
  ctx.conceptAssetUrl = '';
  ctx.conceptPrompt = '';
  ctx.rowAssets = { base: null, punch: null, kick: null, special_1: null, special_2: null };
  ctx.normalizedKey = '';
  ctx.qaReport = null;
  ctx.highestUnlockedStep = 0;
  ctx.refImageUrl = '';
  promptManuallyEdited = false;
  resetRowApprovals();

  // Remove reference image thumbnail if present
  const thumb = document.getElementById('ref-image-thumbnail');
  if (thumb) thumb.remove();
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

function setRowStatus(rowId, status) {
  const el = document.querySelector(`.sprite-row[data-row="${rowId}"] .row-status`);
  if (el) {
    el.className = `row-status ${status}`;
    el.textContent = status;
  }
}

function syncNormalizeButton() {
  const anyGenerated = ROW_IDS.some((id) => ctx.rowAssets[id]);
  const btn = document.getElementById('btn-normalize');
  if (btn) btn.disabled = !anyGenerated;
}

function renderSpriteRows() {
  const $el = document.getElementById('sprite-rows');
  const brief = document.getElementById('fighter-brief')?.value?.trim() ?? '';
  const promptSnippet = brief.length > 120 ? brief.slice(0, 120) + '...' : brief;

  $el.innerHTML = ROW_IDS.map((rowId) => {
    const approved = ctx.rowApprovals[rowId];
    const hasSheet = !!ctx.rowAssets[rowId];
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
          ? `<div class="sprite-row-frames">${renderRowFrames(rowId)}</div>`
          : `<div class="sprite-row-empty">Generate a sheet to preview this row.</div>`
        }
      </div>
    `;
  }).join('');

  $el.querySelectorAll('[data-action="gen-row"]').forEach((btn) => {
    btn.addEventListener('click', () => generateRowSheet(btn.dataset.row));
  });
  $el.querySelectorAll('[data-action="approve"]').forEach((btn) => {
    btn.addEventListener('click', () => onApproveRow(btn.dataset.row));
  });
  $el.querySelectorAll('[data-action="regen"]').forEach((btn) => {
    btn.addEventListener('click', () => onRegenRow(btn.dataset.row));
  });

  syncNormalizeButton();
}

function renderRowFrames(rowId) {
  const rowAsset = ctx.rowAssets[rowId];
  if (!rowAsset) return '';
  const frames = [];
  for (let col = 0; col < 6; col++) {
    const xPercent = (col / 5) * 100; // 0%, 20%, 40%, 60%, 80%, 100%
    frames.push(`<div style="width:150px;height:150px;flex-shrink:0;overflow:hidden;background:url('${esc(rowAsset.url)}') ${xPercent}% 0 / 600% auto no-repeat;image-rendering:pixelated;border-right:1px solid rgba(255,255,255,0.06);" title="frame ${col + 1}"></div>`);
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

// Boot-time restore — runs after all function definitions and event listeners are set up
void restoreWizardState();
