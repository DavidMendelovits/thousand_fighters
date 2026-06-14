const MOVE_ORDER = ['base', 'punch', 'kick', 'special_1', 'special_2', 'projectiles'];

// Where the Vite-served game (and the single-player testbed) lives. The testbed
// reads this character's draft + assets back through the admin API via a Vite
// proxy, so the game dev server (npm run dev) must be running alongside the CMS
// admin server. Override with window.TESTBED_BASE_URL if your ports differ.
const TESTBED_BASE_URL = window.TESTBED_BASE_URL || 'http://127.0.0.1:5173';

function openTestbed(characterId) {
  if (!characterId) return;
  const url = `${TESTBED_BASE_URL}/testbed.html?id=${encodeURIComponent(characterId)}`;
  window.open(url, `testbed-${characterId}`);
}

// The Character Gym is a sibling Vite route (src/gym), reached the same way as
// the testbed — admin is static JS and can't host Phaser itself.
function openGym(characterId) {
  if (!characterId) return;
  const url = `${TESTBED_BASE_URL}/gym.html?id=${encodeURIComponent(characterId)}`;
  window.open(url, `gym-${characterId}`);
}

// ---------------------------------------------------------------------------
// Client-side router
// ---------------------------------------------------------------------------

function getCurrentRoute() {
  const pathname = location.pathname;
  if (pathname === '/pipeline') return { page: 'pipeline' };
  if (pathname === '/roster') return { page: 'roster' };
  if (pathname === '/roster/new') return { page: 'roster', isNew: true };
  const rosterMatch = pathname.match(/^\/roster\/([a-z][a-z0-9_]{2,})$/);
  if (rosterMatch) return { page: 'roster', characterId: rosterMatch[1] };
  return { page: 'roster' };
}

function navigateTo(path) {
  history.pushState(null, '', path);
  handleRouteChange();
}

function handleRouteChange() {
  const route = getCurrentRoute();
  if (route.page === 'pipeline') {
    // Legacy route: pipeline now lives in the ops column, no workbench detour.
    renderEmptyWorkbench('Select a fighter to inspect moves, frames, animation, stats, and assets.');
    setOpsTab('pipeline');
  } else if (route.isNew) {
    renderNewFighterWorkbench();
  } else if (route.characterId) {
    selectCharacter(route.characterId, { pushState: false });
  } else {
    renderEmptyWorkbench('Select a fighter to inspect moves, frames, animation, stats, and assets.');
  }
}

window.addEventListener('popstate', () => {
  handleRouteChange();
});

const state = {
  currentCharacterId: '',
  openActivityMove: null,
  characters: [],
  sourceAssetKey: '',
  normalizedKey: '',
  animationTimers: [],
  previewFrames: new Map(),
  animationStates: new Map(),
  chatMessages: [],
  generatingMoves: new Set(),
  moveActivity: {},
  currentAssets: [],
  qaReports: {},
  selectSeq: 0,
  movePrompts: {},
  assetCacheBust: 0,
};

// Regenerated rows overwrite assets at the same key, so the apiUrl is identical
// and the browser reuses the in-memory image (the route's no-store header does
// not stop <img> reuse within a session). Bump this on every post-mutation
// refresh so the URL changes and the new sprite is actually fetched.
function bustAssetCache() {
  state.assetCacheBust = Date.now();
}

function withCacheBust(apiUrl) {
  if (!apiUrl || !state.assetCacheBust) return apiUrl;
  return `${apiUrl}${apiUrl.includes('?') ? '&' : '?'}v=${state.assetCacheBust}`;
}

const elements = {
  systemStatus: document.querySelector('#system-status'),
  adapterCount: document.querySelector('#adapter-count'),
  adapterList: document.querySelector('#adapter-list'),
  gapList: document.querySelector('#gap-list'),
  characterList: document.querySelector('#character-list'),
  selectedCharacter: document.querySelector('#selected-character'),
  characterWorkbench: document.querySelector('#character-workbench'),
  characterId: document.querySelector('#character-id'),
  characterBrief: document.querySelector('#character-brief'),
  draftForm: document.querySelector('#draft-form'),
  createDraft: document.querySelector('#create-draft'),
  runChain: document.querySelector('#run-chain'),
  generateSheet: document.querySelector('#generate-sheet'),
  normalizePack: document.querySelector('#normalize-pack'),
  validatePack: document.querySelector('#validate-pack'),
  publishCharacter: document.querySelector('#publish-character'),
  assetUploadForm: document.querySelector('#asset-upload-form'),
  assetKind: document.querySelector('#asset-kind'),
  assetMove: document.querySelector('#asset-move'),
  assetActor: document.querySelector('#asset-actor'),
  assetFrame: document.querySelector('#asset-frame'),
  assetPath: document.querySelector('#asset-path'),
  assetFile: document.querySelector('#asset-file'),
  uploadAsset: document.querySelector('#upload-asset'),
  assetLabel: document.querySelector('#asset-label'),
  assetPreview: document.querySelector('#asset-preview'),
  chatStatus: document.querySelector('#chat-status'),
  chatThread: document.querySelector('#chat-thread'),
  chatForm: document.querySelector('#chat-form'),
  chatMessage: document.querySelector('#chat-message'),
  sendChat: document.querySelector('#send-chat'),
  refreshRoster: document.querySelector('#refresh-roster'),
  errorModal: document.querySelector('#error-modal'),
  opsPanel: document.querySelector('.ops-panel'),
  opsTabs: document.querySelector('.ops-tabs'),
  pipelineSummary: document.querySelector('#pipeline-summary'),
  adapterHealthStrip: document.querySelector('#adapter-health-strip'),
  moveActivityPanel: document.querySelector('#move-activity-panel'),
};

function setOpsTab(name) {
  if (!elements.opsPanel) return;
  if (name === 'activity') {
    elements.opsPanel.querySelector('[data-ops-tab="activity"]')?.classList.remove('has-unread', 'has-error');
  }
  for (const tab of elements.opsPanel.querySelectorAll('[data-ops-tab]')) {
    const active = tab.dataset.opsTab === name;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  for (const pane of elements.opsPanel.querySelectorAll('[data-ops-pane]')) {
    pane.hidden = pane.dataset.opsPane !== name;
  }
}

elements.draftForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await createDraft();
});
elements.runChain.addEventListener('click', runLocalE2E);
elements.generateSheet.addEventListener('click', generateSheet);
elements.normalizePack.addEventListener('click', normalizePack);
elements.validatePack.addEventListener('click', validatePack);
elements.publishCharacter.addEventListener('click', publishCharacter);
elements.assetUploadForm.addEventListener('submit', uploadSpriteAsset);
elements.assetKind.addEventListener('change', syncAssetPath);
elements.assetMove.addEventListener('change', syncAssetPath);
elements.assetActor.addEventListener('input', syncAssetPath);
elements.assetFrame.addEventListener('input', syncAssetPath);
elements.assetPath.addEventListener('input', () => {
  if (elements.assetKind.value === 'custom') return;
  syncAssetPath();
});
elements.assetFile.addEventListener('change', syncAssetPath);
elements.characterWorkbench.addEventListener('click', handleAnimationControl);
elements.characterWorkbench.addEventListener('click', handleWorkbenchClick);
// Per-row prompt edits live in state so workbench re-renders (e.g. while other
// rows finish generating) don't wipe them.
elements.characterWorkbench.addEventListener('input', (event) => {
  const promptInput = event.target.closest('[data-move-prompt]');
  if (!promptInput) return;
  state.movePrompts[`${state.currentCharacterId}:${promptInput.dataset.movePrompt}`] = promptInput.value;
});

const WORKBENCH_CTA_HANDLERS = {
  'cta-generate-concept': () => generateConcept(),
  'cta-generate-sheet': () => generateSheet(),
  'cta-normalize-pack': () => normalizePack(),
  'cta-validate-pack': () => validatePack(),
  'cta-publish-character': () => publishCharacter(),
};

function handleWorkbenchClick(event) {
  const cta = event.target.closest('[id^="cta-"]');
  if (cta && WORKBENCH_CTA_HANDLERS[cta.id]) {
    WORKBENCH_CTA_HANDLERS[cta.id]();
    return;
  }

  const gymButton = event.target.closest('[data-gym]');
  if (gymButton) {
    openGym(gymButton.dataset.gym);
    return;
  }

  const playtestButton = event.target.closest('[data-playtest]');
  if (playtestButton) {
    openTestbed(playtestButton.dataset.playtest);
    return;
  }

  const conceptButton = event.target.closest('[data-gen-concept]');
  if (conceptButton) {
    generateConcept();
    return;
  }

  const genButton = event.target.closest('[data-gen-move]');
  if (genButton) {
    generateMoveRow(genButton.dataset.genMove);
    return;
  }

  const activityButton = event.target.closest('[data-move-activity]');
  if (activityButton) {
    openMoveActivityPanel(activityButton.dataset.moveActivity);
    return;
  }

  const tabButton = event.target.closest('[data-move-tab]');
  if (tabButton) {
    const card = tabButton.closest('.move-card');
    if (!card) return;
    for (const tab of card.querySelectorAll('[data-move-tab]')) {
      tab.classList.toggle('active', tab === tabButton);
    }
    for (const pane of card.querySelectorAll('[data-move-pane]')) {
      pane.hidden = pane.dataset.movePane !== tabButton.dataset.moveTab;
    }
  }
}
elements.chatForm.addEventListener('submit', sendChatMessage);
elements.refreshRoster.addEventListener('click', async () => {
  await loadCharacters();
  handleRouteChange();
});
document.querySelector('.new-fighter-link')?.addEventListener('click', (event) => {
  event.preventDefault();
  navigateTo('/roster/new');
});
elements.opsTabs?.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-ops-tab]');
  if (tab) setOpsTab(tab.dataset.opsTab);
});
elements.adapterHealthStrip?.addEventListener('click', () => setOpsTab('pipeline'));

// Delegated click on chat thread: open error modal when an error tool call summary is clicked
elements.chatThread.addEventListener('click', (event) => {
  const details = event.target.closest('details[data-error-message-index]');
  if (!details) return;

  const messageIndex = Number(details.dataset.errorMessageIndex);
  const toolIndex = Number(details.dataset.errorToolIndex);
  const message = state.chatMessages[messageIndex];
  const toolCall = message?.toolCalls?.[toolIndex];
  if (!toolCall) return;

  // Prevent the details toggle when clicking for the modal
  event.preventDefault();
  openErrorModal(toolCall);
});

boot();

async function boot() {
  setBusy(true);
  try {
    syncAssetPath();
    renderChatThread();
    await Promise.all([loadHealth(), loadPipeline(), loadChatHealth()]);
    await loadCharacters();
    handleRouteChange();
    log('Admin platform ready.');
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function loadHealth() {
  const health = await getJson('/api/health');
  elements.systemStatus.textContent = `${health.service} using ${health.storage}`;
  if (health.chatAgent) renderChatStatus(health.chatAgent);
}

async function loadChatHealth() {
  const result = await getJson('/api/chat/health');
  renderChatStatus(result.agent);
}

async function loadPipeline() {
  const pipeline = await getJson('/api/pipeline');
  elements.adapterCount.textContent = String(pipeline.adapters.length);
  const healthByPort = new Map((pipeline.adapterHealth ?? []).map((health) => [health.port, health]));
  elements.adapterList.replaceChildren(...pipeline.adapters.map((adapter) => renderAdapter(adapter, healthByPort.get(adapter.port))));
  elements.gapList.replaceChildren(...pipeline.gaps.map(renderGap));

  const statuses = pipeline.adapters.map((adapter) => healthByPort.get(adapter.port)?.status ?? 'unknown');
  const problems = statuses.filter((status) => status === 'error').length;
  const warnings = statuses.filter((status) => status === 'warning').length;
  if (elements.pipelineSummary) {
    elements.pipelineSummary.textContent = problems
      ? `${problems} adapter problem${problems > 1 ? 's' : ''}`
      : warnings
        ? `${warnings} warning${warnings > 1 ? 's' : ''}`
        : 'All adapters healthy';
  }
  if (elements.adapterHealthStrip) {
    elements.adapterHealthStrip.replaceChildren(...pipeline.adapters.map((adapter) => {
      const health = healthByPort.get(adapter.port);
      const dot = document.createElement('span');
      dot.className = `health-dot health-dot-${health?.status ?? 'unknown'}`;
      dot.title = `${adapter.port}: ${health?.status ?? 'unknown'}`;
      return dot;
    }));
  }
}

async function loadCharacters() {
  const result = await getJson('/api/characters');
  state.characters = result.characters;

  if (result.characters.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'character-row';
    empty.innerHTML = '<strong>No fighters yet</strong><span>Click "+ New Fighter" above to create your first one.</span>';
    elements.characterList.replaceChildren(empty);
    renderEmptyWorkbench('Create or import a fighter to inspect its game data.');
    return;
  }

  elements.characterList.replaceChildren(...result.characters.map(renderCharacter));
}

async function selectCharacter(characterId, options = {}) {
  state.currentCharacterId = characterId;
  setActiveCharacterRow(characterId);

  // Push URL unless caller opted out (e.g. popstate handler, initial load)
  if (options.pushState !== false) {
    const targetPath = `/roster/${characterId}`;
    if (location.pathname !== targetPath) {
      history.pushState(null, '', targetPath);
    }
  }

  // Parallel row generation refreshes the workbench as each row lands —
  // the sequence token keeps a slow, stale response from clobbering a newer one.
  const seq = ++state.selectSeq;

  const [draftResult, assetResult, qaReport] = await Promise.all([
    getJson(`/api/characters/${encodeURIComponent(characterId)}/draft`),
    getJson(`/api/characters/${encodeURIComponent(characterId)}/assets`),
    getJson(`/api/assets/${encodeURIComponent(`characters/${characterId}/qa/latest.json`)}`).catch(() => null),
  ]);
  if (seq !== state.selectSeq || state.currentCharacterId !== characterId) return;

  const draft = draftResult.draft;
  // A silent reselect is the refresh fired after a mutation (generate, normalize,
  // upload, publish, chat). Bump the cache token so regenerated images refetch;
  // plain navigation leaves it stable so unchanged images stay cached.
  if (options.silent) bustAssetCache();
  const assets = assetResult.assets.map((asset) =>
    asset.apiUrl ? { ...asset, apiUrl: withCacheBust(asset.apiUrl) } : asset);
  state.currentDraftData = draft;
  state.currentAssets = assets;
  state.qaReports[characterId] = qaReport;
  elements.characterId.value = draft.id;
  elements.characterBrief.value = draft.description ?? '';
  elements.selectedCharacter.textContent = `${draft.displayName ?? draft.id} · ${draft.lifecycle ?? 'draft'}`;
  hydratePipelineStateFromAssets(assets);
  renderCharacterWorkbench(draft, assets);

  if (!options.silent) {
    log(`Loaded ${draft.displayName ?? draft.id}.`);
  }
}

async function createDraft() {
  const characterId = elements.characterId.value.trim();
  const brief = elements.characterBrief.value.trim();
  if (!characterId || !brief) {
    log('Character ID and brief are required.', 'error');
    return null;
  }

  const result = await invokeTool('create_character_draft', { characterId, brief });
  state.currentCharacterId = result.draft.id;
  state.sourceAssetKey = '';
  state.normalizedKey = '';
  await Promise.all([loadCharacters(), loadPipeline()]);
  await selectCharacter(result.draft.id, { silent: true });
  return result.draft;
}

const MOVE_IDS = ['base', 'punch', 'kick', 'special_1', 'special_2'];

function moveSpriteProfile(moveId) {
  const moves = state.currentDraftData?.moves ?? [];
  const move = moves.find((candidate) => (candidate.animation ?? candidate.sheet) === moveId);
  return move?.spriteProfile === 'wide' ? 'wide' : 'standard';
}

function logMoveActivity(moveId, message, level = '') {
  if (!state.moveActivity[moveId]) state.moveActivity[moveId] = [];
  state.moveActivity[moveId].push({ message, level, ts: Date.now() });
  if (state.moveActivity[moveId].length > 50) state.moveActivity[moveId].shift();
  refreshMoveActivityPanel(moveId);
}

function setMoveCardLoading(moveId, loading) {
  const card = elements.characterWorkbench.querySelector(`[data-move-card="${moveId}"]`);
  if (!card) return;
  card.classList.toggle('move-card-loading', loading);
  const btn = card.querySelector('[data-gen-move]');
  if (btn) {
    btn.disabled = loading;
    btn.textContent = loading ? 'Generating…' : 'Regen';
  }
}

function spriteBrief() {
  return (state.currentDraftData?.description ?? elements.characterBrief.value ?? '').trim();
}

function buildRowPrompt() {
  return [
    spriteBrief(),
    'Side-view fighting game sprite row. Magenta background, full body visible, generous gutters, no cropping.',
  ].filter(Boolean).join(' ');
}

// Prompt shown (and used) for a row: an unsent edit wins, then the prompt the
// current sheet was actually generated with, then the auto-built default.
function rowPromptFor(moveId) {
  const key = `${state.currentCharacterId}:${moveId}`;
  if (typeof state.movePrompts[key] === 'string') return state.movePrompts[key];
  const sheetAsset = state.currentAssets.find((asset) =>
    asset.relativePath === `source/${state.currentCharacterId}_${moveId}_sheet.png`);
  const generatedWith = sheetAsset?.metadata?.prompt;
  return typeof generatedWith === 'string' && generatedWith.trim() ? generatedWith : buildRowPrompt();
}

function hasBaseSheet(characterId) {
  return state.currentAssets.some((asset) =>
    asset.relativePath === `source/${characterId}_base_sheet.png`);
}

function shortAssetKey(key) {
  return String(key ?? '').split('/').slice(-1)[0];
}

function logMoveStream(moveId, data) {
  for (const line of String(data ?? '').split('\n')) {
    const trimmed = line.trim();
    if (trimmed) logMoveActivity(moveId, trimmed.slice(0, 160));
  }
}

async function generateMoveRow(moveId) {
  const characterId = currentCharacterId();
  if (!characterId) return null;
  if (state.generatingMoves.has(moveId)) return null;

  // Every attack row references the base row, so regenerating an existing base
  // silently makes the others inconsistent. Confirm before overwriting it.
  if (moveId === 'base' && hasBaseSheet(characterId)
    && !confirm('Regenerate the base row? Every attack row references it, so they may look inconsistent until you regenerate them too.')) {
    return null;
  }

  state.generatingMoves.add(moveId);
  setMoveCardLoading(moveId, true);
  logMoveActivity(moveId, 'Generating sprite row…');
  log(`> generate_sprite_sheet (${moveId})`);

  if (moveId !== 'base' && !hasBaseSheet(characterId)) {
    logMoveActivity(moveId, 'No base sheet yet — generating without the base reference may drift from the fighter\'s look.', 'error');
  }

  try {
    const prompt = rowPromptFor(moveId);
    const spriteProfile = moveSpriteProfile(moveId);
    const result = await invokeToolStreaming('generate_sprite_sheet',
      { characterId, prompt, moveId, spriteProfile },
      (event) => {
        if (event.type === 'stdout' || event.type === 'stderr') logMoveStream(moveId, event.data);
      });
    state.sourceAssetKey = result.asset.key;
    showLatestAsset({ ...result.asset, apiUrl: result.asset.apiUrl ?? result.asset.url });
    const references = result.referencesUsed ?? [];
    logMoveActivity(moveId,
      references.length
        ? `Generated with reference(s): ${references.map(shortAssetKey).join(', ')}`
        : 'Generated without reference images',
      'pass');
    for (const warning of result.warnings ?? []) {
      logMoveActivity(moveId, warning, 'error');
      log(`${moveId}: ${warning}`, 'error');
    }
    log(`${moveId} row generated.`, 'pass');

    // Auto-extract individual frames from the row sheet
    try {
      logMoveActivity(moveId, 'Extracting individual frames...');
      const extraction = await postJson('/api/tools/extract_row_frames', {
        characterId, sourceAssetKey: result.asset.key, moveId, spriteProfile,
      });
      for (const warning of extraction.result?.warnings ?? []) {
        const severe = /fused|truncat|bleed|empty cell|near-magenta/.test(warning);
        logMoveActivity(moveId, warning, severe ? 'error' : '');
        if (severe) log(`${moveId}: ${warning}`, 'error');
      }
      logMoveActivity(moveId, 'Frames extracted.', 'pass');
    } catch (extractErr) {
      logMoveActivity(moveId, `Frame extraction failed: ${extractErr.message}`, 'error');
      // Non-fatal: the source sheet is still available
    }

    state.generatingMoves.delete(moveId);

    // The user may have navigated to another fighter while this row generated —
    // don't reselect the original out from under them. They'll see fresh assets
    // when they next open this fighter.
    if (state.currentCharacterId === characterId) {
      await selectCharacter(characterId, { silent: true, pushState: false });

      // Success flash on the move card
      const successCard = elements.characterWorkbench.querySelector(`[data-move-card="${moveId}"]`);
      if (successCard) {
        successCard.classList.add('move-card-success');
        setTimeout(() => successCard.classList.remove('move-card-success'), 2000);
      }
    }

    return result;
  } catch (error) {
    logMoveActivity(moveId, error.message, 'error');
    showError(error);
    state.generatingMoves.delete(moveId);
    setMoveCardLoading(moveId, false);
    return null;
  }
}

// The base row defines the fighter's look and scale, so it must exist before
// the other rows generate — they all attach it as a reference image. Once it
// does, the four attack rows have no ordering dependency and run in parallel.
async function generateAllRows() {
  const characterId = currentCharacterId();
  if (!characterId) return;

  if (!hasBaseSheet(characterId)) {
    log('Generating base row first — it anchors the look of every other row.');
    const base = await generateMoveRow('base');
    if (!base) {
      log('Base row failed — skipping the remaining rows. Fix the base row and try again.', 'error');
      return;
    }
  } else {
    log('Base sheet already exists — generating the four attack rows in parallel against it. Regenerate the base row from its card if you want a fresh look.');
  }

  const attackRows = MOVE_IDS.filter((id) => id !== 'base');
  const results = await Promise.all(attackRows.map((id) => generateMoveRow(id)));
  const failed = attackRows.filter((id, index) => !results[index]);
  if (failed.length) {
    log(`Some rows failed: ${failed.join(', ')} — regenerate them from their move cards.`, 'error');
  } else {
    log('All sprite rows generated.', 'pass');
  }
}

async function generateSheet() {
  await generateAllRows();
}

async function uploadSpriteAsset(event) {
  event.preventDefault();
  const characterId = currentCharacterId();
  if (!characterId) return null;

  const file = elements.assetFile.files?.[0];
  if (!file) {
    log('Choose a sprite file before adding it to the CMS.', 'error');
    return null;
  }

  try {
    const relativePath = buildAssetRelativePath(file);
    const contentBase64 = await fileToBase64(file);
    const result = await postJson(`/api/characters/${encodeURIComponent(characterId)}/assets`, {
      relativePath,
      contentBase64,
      contentType: file.type || contentTypeFromName(file.name),
      metadata: {
        originalName: file.name,
        assetKind: elements.assetKind.value,
        moveSet: elements.assetMove.value,
        prefix: normalizePathPrefix(elements.assetActor.value) || null,
      },
    });

    showLatestAsset(result.asset);
    elements.assetFile.value = '';
    syncAssetPath();
    await selectCharacter(characterId, { silent: true });
    log(`Added ${result.asset.relativePath} to ${characterId}.`, 'pass');
    return result.asset;
  } catch (error) {
    showError(error);
    return null;
  }
}

async function normalizePack() {
  const characterId = currentCharacterId();
  if (!characterId || !state.sourceAssetKey) {
    log('Generate a source sheet before normalization.', 'error');
    return null;
  }

  const result = await invokeTool('normalize_sprite_pack', {
    characterId,
    sourceAssetKey: state.sourceAssetKey,
  });
  state.normalizedKey = result.normalized.outputKey;
  const preserved = result.normalized.preservedSheets ?? [];
  const filled = result.normalized.filledSheets ?? [];
  if (preserved.length) log(`Kept generated rows: ${preserved.join(', ')}.`, 'pass');
  if (filled.length) log(`Filled placeholder sheets: ${filled.join(', ')} — generate those rows to replace them.`);
  await selectCharacter(characterId, { silent: true });
  return result;
}

async function validatePack() {
  const characterId = currentCharacterId();
  if (!characterId || !state.normalizedKey) {
    log('Normalize the pack before validation.', 'error');
    return null;
  }

  const result = await invokeTool('validate_fighter_pack', {
    characterId,
    normalizedKey: state.normalizedKey,
  });
  await selectCharacter(characterId, { silent: true });
  return result;
}

async function publishCharacter() {
  const characterId = currentCharacterId();
  if (!characterId) return null;

  const result = await invokeTool('publish_character', {
    characterId,
    releaseId: `local-${Date.now()}`,
  });
  // A5: publishing must also ship the converted runtime config to
  // public/fighters/<id>/ so the roster plays exactly what the gym authored —
  // tuned anchors (copied frameData) + collision overrides (folded into
  // config.json by convert). The release bundle alone never touches public/.
  // The bundle write already succeeded, so a failed export is logged, not fatal.
  try {
    await invokeTool('export_character_config', { characterId });
  } catch (error) {
    log(`publish: runtime config export failed — ${error.message}`, 'fail');
  }
  await Promise.all([loadCharacters(), loadPipeline()]);
  await selectCharacter(characterId, { silent: true });
  return result;
}

async function sendChatMessage(event) {
  event.preventDefault();
  const message = elements.chatMessage.value.trim();
  if (!message) return null;

  appendChatMessage({ role: 'user', text: message });
  elements.chatMessage.value = '';

  // Show thinking indicator
  const thinkingEntry = { role: 'assistant-thinking', text: 'Thinking...' };
  state.chatMessages.push(thinkingEntry);
  renderChatThread();

  elements.sendChat.textContent = 'Sending...';
  setBusy(true);

  try {
    const result = await postJson('/api/chat', {
      message,
      characterId: state.currentCharacterId || elements.characterId.value.trim(),
      sourceAssetKey: state.sourceAssetKey,
      normalizedKey: state.normalizedKey,
    });

    // Remove thinking indicator
    const thinkingIndex = state.chatMessages.indexOf(thinkingEntry);
    if (thinkingIndex !== -1) state.chatMessages.splice(thinkingIndex, 1);

    const chat = result.result;
    appendChatMessage({
      role: 'assistant',
      text: chat.message,
      toolCalls: chat.toolCalls ?? [],
      provider: chat.provider,
    });

    for (const toolCall of chat.toolCalls ?? []) {
      log(`assistant > ${toolCall.name} ${toolCall.status}`, toolCall.status === 'error' ? 'error' : 'pass');
    }

    await Promise.all([loadHealth(), loadPipeline(), loadCharacters()]);
    if (state.currentCharacterId) await selectCharacter(state.currentCharacterId, { silent: true, pushState: false });
    return chat;
  } catch (error) {
    // Remove thinking indicator
    const thinkingIndex = state.chatMessages.indexOf(thinkingEntry);
    if (thinkingIndex !== -1) state.chatMessages.splice(thinkingIndex, 1);

    appendChatMessage({ role: 'assistant', text: error.message, isError: true });
    showError(error);
    return null;
  } finally {
    elements.sendChat.textContent = 'Send';
    setBusy(false);
  }
}

async function runLocalE2E() {
  setBusy(true);
  try {
    const draft = await createDraft();
    if (!draft) return;
    await generateSheet();
    await normalizePack();
    await validatePack();
    await publishCharacter();
    log(`Local E2E completed for ${draft.id}.`, 'pass');
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function invokeTool(name, input) {
  setBusy(true);
  try {
    log(`> ${name}`);
    const result = await postJson(`/api/tools/${name}`, input);
    log(JSON.stringify(result.result, null, 2), 'pass');
    return result.result;
  } catch (error) {
    showError(error);
    throw error;
  } finally {
    setBusy(false);
  }
}

// SSE variant of invokeTool for long-running generation tools. Progress events
// (provider stdout/stderr, prompts) stream to onProgress while the call runs.
async function invokeToolStreaming(name, input, onProgress) {
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

    // SSE events are separated by blank lines
    let separatorIndex;
    while ((separatorIndex = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

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
        try { onProgress?.(parsed); } catch {}
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

function renderCharacter(character) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'character-row';
  button.dataset.characterId = character.id;
  button.innerHTML = `<strong>${escapeHtml(character.displayName ?? character.id)}</strong><span>${escapeHtml(character.id)} · ${escapeHtml(character.status ?? 'draft')}</span>`;
  button.addEventListener('click', () => selectCharacter(character.id));
  return button;
}

function findConceptAsset(assets) {
  return assets.find((asset) => /^concept\/concept_art\.(png|webp|jpg|svg)$/i.test(asset.relativePath)) ?? null;
}

function detectCharacterStage(draft, assets) {
  const lifecycle = draft.lifecycle ?? 'draft';
  if (lifecycle === 'version') return 'published';

  const hasConcept = Boolean(findConceptAsset(assets));
  const hasSource = assets.some((asset) => /^source\/.+_(?:base|punch|kick|special_1|special_2)_sheet\.(svg|png)$/i.test(asset.relativePath));
  const hasNormalized = assets.some((asset) =>
    /(?:^|\/)(fighter-pack|normalized)\/manifest\.json$/i.test(asset.relativePath)
  );
  const hasFrames = assets.some((asset) => parseSpriteAsset(asset) !== null);

  if (!hasSource && !hasFrames && !hasConcept) return 'no-concept';
  if (!hasSource) return 'no-source';
  if (!hasNormalized && !hasFrames) return 'no-frames';
  return 'ready-to-publish';
}

function renderNextStepBanner(stage) {
  if (stage === 'published') {
    return `
      <div class="next-step-banner banner-done" role="status">
        <div>
          <div class="next-step-label">Status</div>
          <p class="next-step-title"><span class="published-badge">Published</span></p>
          <p class="next-step-detail">This fighter has been published to the runtime roster.</p>
        </div>
      </div>
    `;
  }

  if (stage === 'no-concept') {
    return `
      <div class="next-step-banner">
        <div>
          <div class="next-step-label">Next Step</div>
          <p class="next-step-title">Generate Concept Art</p>
          <p class="next-step-detail">Concept art anchors the fighter's look — the base row references it, and every move row references the base row.</p>
        </div>
        <div style="display:flex;gap:8px;flex-direction:column;align-items:stretch">
          <button id="cta-generate-concept" class="next-step-action" type="button">Generate Concept</button>
          <button id="cta-generate-sheet" class="next-step-action" type="button" style="font-size:12px;padding:7px 14px;background:#26303c;border-color:var(--accent-2);color:var(--accent-2)">Skip — Generate Rows</button>
        </div>
      </div>
    `;
  }

  if (stage === 'no-source') {
    return `
      <div class="next-step-banner">
        <div>
          <div class="next-step-label">Next Step</div>
          <p class="next-step-title">Generate Sprite Rows</p>
          <p class="next-step-detail">The base row generates first to lock the look and scale, then the four attack rows generate in parallel against it.</p>
        </div>
        <button id="cta-generate-sheet" class="next-step-action" type="button">Generate All Rows</button>
      </div>
    `;
  }

  if (stage === 'no-frames') {
    return `
      <div class="next-step-banner banner-warn">
        <div>
          <div class="next-step-label">Next Step</div>
          <p class="next-step-title">Normalize &amp; Extract Frames</p>
          <p class="next-step-detail">Source art found. Normalize it to extract individual frames from the sprite sheet.</p>
        </div>
        <button id="cta-normalize-pack" class="next-step-action" type="button">Normalize Frames</button>
      </div>
    `;
  }

  // ready-to-publish
  return `
    <div class="next-step-banner banner-warn">
      <div>
        <div class="next-step-label">Next Step</div>
        <p class="next-step-title">Publish Fighter</p>
        <p class="next-step-detail">Frames are ready. Validate and publish this fighter to the runtime roster.</p>
      </div>
      <div style="display:flex;gap:8px;flex-direction:column;align-items:stretch">
        <button id="cta-validate-pack" class="next-step-action" type="button" style="font-size:12px;padding:7px 14px;background:#26303c;border-color:var(--accent-2);color:var(--accent-2)">Run QA</button>
        <button id="cta-publish-character" class="next-step-action" type="button">Publish</button>
      </div>
    </div>
  `;
}

function renderConceptSection(conceptAsset) {
  const panels = conceptAsset
    ? `
      <div class="concept-panels">
        ${['Front', 'Profile', 'Back'].map((label, index) => `
          <div class="concept-panel">
            <div class="concept-panel-img" style="background-image:url('${conceptAsset.apiUrl}');background-position:${(index / 2) * 100}% 0;background-size:300% 100%;"></div>
            <span class="concept-panel-label">${label}</span>
          </div>
        `).join('')}
      </div>
      <details class="concept-full-sheet">
        <summary>Full sheet</summary>
        <img src="${conceptAsset.apiUrl}" alt="Full concept sheet" />
      </details>
    `
    : '<span class="empty-inline">No concept art yet. The base row uses it as a reference, so generating it first keeps the whole fighter consistent.</span>';

  return `
    <section class="concept-section">
      <header class="concept-section-header">
        <div>
          <span class="eyebrow">Concept</span>
          <h3>Reference Art</h3>
        </div>
        <button type="button" class="move-gen-btn" data-gen-concept>${conceptAsset ? 'Regen' : 'Generate'}</button>
      </header>
      ${panels}
    </section>
  `;
}

function renderQaSection(report) {
  if (!report?.summary) return '';
  const summary = report.summary;
  const checks = report.checks ?? [];
  return `
    <section class="qa-section">
      <header class="concept-section-header">
        <div>
          <span class="eyebrow">QA</span>
          <h3>Fighter Pack Validation</h3>
        </div>
        <span class="soft-label">${escapeHtml(report.generatedAt ?? '')}</span>
      </header>
      <div class="qa-summary ${escapeHtml(report.status)}">
        ${report.status === 'pass' ? 'All checks passed' : report.status === 'fail' ? `Failed: ${summary.errors} error(s)` : `Warnings: ${summary.warnings}`}
        &mdash; ${summary.passed ?? 0} passed, ${summary.warnings ?? 0} warnings, ${summary.errors ?? 0} errors
      </div>
      ${checks.map((check) => `
        <div class="qa-check ${escapeHtml(check.status)}">
          <span>${escapeHtml(check.message)}</span>
        </div>
      `).join('')}
    </section>
  `;
}

async function generateConcept() {
  const characterId = currentCharacterId();
  if (!characterId) return null;

  const prompt = spriteBrief();
  if (!prompt) {
    log('Add a character description before generating concept art.', 'error');
    return null;
  }

  const button = elements.characterWorkbench.querySelector('[data-gen-concept]');
  if (button) {
    button.disabled = true;
    button.textContent = 'Generating…';
  }
  log('> generate_character_concept');

  try {
    const result = await invokeToolStreaming('generate_character_concept', { characterId, prompt });
    log('Concept art generated.', 'pass');
    await selectCharacter(characterId, { silent: true, pushState: false });
    return result;
  } catch (error) {
    showError(error);
    if (button) {
      button.disabled = false;
      button.textContent = 'Generate';
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// New fighter mode — the same workbench, before the draft exists
// ---------------------------------------------------------------------------

let newFighterRefImage = null;

function renderNewFighterWorkbench() {
  clearAnimationTimers();
  state.currentCharacterId = '';
  state.currentDraftData = null;
  state.currentAssets = [];
  setActiveCharacterRow('');
  elements.selectedCharacter.textContent = 'New fighter';
  newFighterRefImage = null;

  elements.characterWorkbench.className = 'character-workbench';
  elements.characterWorkbench.innerHTML = `
    <div class="next-step-banner">
      <div>
        <div class="next-step-label">New Fighter</div>
        <p class="next-step-title">Describe your fighter</p>
        <p class="next-step-detail">Creating the draft adds it to the roster immediately — concept art, sprite rows, QA, and publishing all happen on its page. Stop at any point and it stays a draft you can pick back up.</p>
      </div>
    </div>
    <section class="character-summary">
      <form id="new-fighter-form" class="new-fighter-form">
        <label>
          Character ID
          <input id="new-fighter-id" name="characterId" autocomplete="off" placeholder="e.g. rooftop_ronin" pattern="[a-z][a-z0-9_]{2,}" required />
          <span class="field-hint">Lowercase, underscores, no spaces. Becomes the asset folder name.</span>
        </label>
        <div class="new-fighter-row">
          <label>
            Reference Image (optional)
            <input id="new-fighter-ref" type="file" accept="image/png,image/jpeg,image/webp" />
            <span class="field-hint">AI describes it and fills in the brief.</span>
          </label>
          <label>
            Art Style
            <select id="new-fighter-style">
              <option value="">AI decides</option>
              <option value="pixel art">Pixel art</option>
              <option value="painterly">Painterly</option>
              <option value="cel-shaded">Cel-shaded</option>
              <option value="realistic">Realistic</option>
              <option value="sketch">Sketch / line art</option>
            </select>
          </label>
        </div>
        <label>
          Character Brief
          <textarea id="new-fighter-brief" rows="5" required placeholder="A rooftop samurai who fights with a broken antenna. Fast but fragile. Special moves involve throwing roof tiles and a diving slash from above."></textarea>
          <span class="field-hint">Personality, fighting style, weapon, specials.</span>
        </label>
        <button id="new-fighter-create" type="submit">Create Fighter</button>
      </form>
    </section>
  `;

  document.getElementById('new-fighter-form').addEventListener('submit', onCreateNewFighter);
  document.getElementById('new-fighter-ref').addEventListener('change', onNewFighterRefImage);
}

async function onNewFighterRefImage(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const base64 = await fileToBase64(file);
    newFighterRefImage = { base64, contentType: file.type || 'image/png' };
    log('Analyzing reference image…');
    const characterId = document.getElementById('new-fighter-id')?.value.trim() || 'new_fighter';
    const result = await postJson('/api/tools/describe_character_image', {
      characterId,
      imageBase64: base64,
      contentType: file.type || 'image/png',
    });
    const description = result.result?.description ?? '';
    if (description) {
      const brief = document.getElementById('new-fighter-brief');
      if (brief) brief.value = description;
      log('Reference image analyzed — brief filled in.', 'pass');
    } else {
      log('No description returned from image analysis.', 'error');
    }
  } catch (error) {
    showError(error);
  }
}

async function onCreateNewFighter(event) {
  event.preventDefault();
  const characterId = document.getElementById('new-fighter-id').value.trim();
  const briefText = document.getElementById('new-fighter-brief').value.trim();
  const artStyle = document.getElementById('new-fighter-style').value;
  if (!characterId || !briefText) return;

  const brief = [briefText, artStyle ? `Art style: ${artStyle}.` : ''].filter(Boolean).join(' ');
  const button = document.getElementById('new-fighter-create');
  button.disabled = true;
  button.textContent = 'Creating…';
  log(`> create_character_draft (${characterId})`);

  try {
    const result = await postJson('/api/tools/create_character_draft', { characterId, brief });
    const draft = result.result.draft;

    // Persist the uploaded reference image with the character so the look
    // survives refreshes and other sessions.
    if (newFighterRefImage) {
      const ext = newFighterRefImage.contentType === 'image/jpeg' ? 'jpg' : 'png';
      await postJson(`/api/characters/${encodeURIComponent(characterId)}/assets`, {
        relativePath: `source/reference.${ext}`,
        contentBase64: newFighterRefImage.base64,
        contentType: newFighterRefImage.contentType,
        metadata: { artifactType: 'reference-image' },
      }).catch(() => {});
      newFighterRefImage = null;
    }

    log(`Draft created: ${draft.displayName ?? characterId}.`, 'pass');
    await loadCharacters();
    navigateTo(`/roster/${draft.id}`);
  } catch (error) {
    showError(error);
    button.disabled = false;
    button.textContent = 'Create Fighter';
  }
}

function renderCharacterWorkbench(draft, assets) {
  clearAnimationTimers();
  const moveGroups = buildMoveGroups(draft, assets);
  const assetCounts = summarizeAssets(assets);
  const stats = draft.gameplay?.stats ?? draft.stats ?? {};
  const characterStatus = [
    `${draft.moves?.length ?? 0} moves`,
    `${assetCounts.frames} frames`,
    `${assetCounts.sheets} sheets`,
    `${assetCounts.projectiles} projectiles`,
  ];

  const stage = detectCharacterStage(draft, assets);
  const bannerHtml = renderNextStepBanner(stage);
  const conceptAsset = findConceptAsset(assets);
  const qaReport = state.qaReports[draft.id] ?? null;

  elements.characterWorkbench.className = 'character-workbench';
  elements.characterWorkbench.innerHTML = `
    ${bannerHtml}
    <section class="character-summary">
      <div>
        <span class="eyebrow">${escapeHtml(draft.id)}</span>
        <h2>${escapeHtml(draft.displayName ?? draft.id)}</h2>
        <p>${escapeHtml(draft.description ?? 'No character description yet.')}</p>
        <div class="summary-pills">${characterStatus.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>
        <div class="summary-actions">
          <button type="button" class="playtest-btn" data-playtest="${escapeHtml(draft.id)}" title="Open the single-player testbed for this fighter">▶ Playtest</button>
          <button type="button" class="gym-btn" data-gym="${escapeHtml(draft.id)}" title="Open the Character Gym to align frames and tune bounds">🛠 Gym</button>
        </div>
      </div>
      <div class="summary-side">
        <div class="stat-grid">${renderStatGrid(stats)}</div>
        ${renderAnimationBindings(draft.animations)}
      </div>
    </section>
    ${renderConceptSection(conceptAsset)}
    <section class="move-board">
      ${moveGroups.map(renderMoveGroup).join('')}
    </section>
    ${renderQaSection(qaReport)}
  `;

  // All workbench buttons are handled by the delegated click handler —
  // no per-render listener attachment.
  startAnimationPreviews();
}

function renderEmptyWorkbench(message) {
  clearAnimationTimers();
  elements.characterWorkbench.className = 'character-workbench empty-state';
  elements.characterWorkbench.textContent = message;
  elements.selectedCharacter.textContent = 'No draft loaded';
}

function renderStatGrid(stats) {
  const entries = [
    ['Health', stats.maxHealth],
    ['Walk Fwd', stats.walkForwardSpeed],
    ['Walk Back', stats.walkBackSpeed],
    ['Jump', stats.jumpVelocity],
    ['Jump Fwd', stats.jumpForwardVelocity],
    ['Jump Back', stats.jumpBackVelocity],
    ['Gravity', stats.gravity],
    ['Fall Cap', stats.maxFallSpeed],
  ].filter(([, value]) => value !== undefined && value !== null);

  if (entries.length === 0) {
    return '<span class="empty-inline">No runtime stats imported yet.</span>';
  }

  return entries.map(([label, value]) => `
    <div class="stat-cell">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(formatNumber(value))}</strong>
    </div>
  `).join('');
}

function renderAnimationBindings(animations = {}) {
  const entries = Object.entries(animations ?? {}).filter(([stateName, animationName]) => stateName && animationName);
  if (entries.length === 0) return '';

  return `
    <section class="animation-bindings">
      <h3>Runtime Animations</h3>
      <div class="animation-binding-grid">
        ${entries.map(([stateName, animationName]) => `
          <span><b>${escapeHtml(titleize(stateName))}</b>${escapeHtml(animationName)}</span>
        `).join('')}
      </div>
    </section>
  `;
}

function renderMoveGroup(group) {
  const primaryFrames = groupPrimaryFrames(group);
  const previewFrames = group.id === 'projectiles' && primaryFrames.length === 0
    ? group.projectiles
    : primaryFrames;
  const primarySheet = groupPrimarySheet(group);
  const animationId = `move-${group.id.replace(/[^a-z0-9_-]/gi, '-')}`;
  if (previewFrames.length > 0) {
    state.previewFrames.set(animationId, previewFrames.map((asset) => asset.apiUrl));
  }

  const canGenerate = MOVE_IDS.includes(group.id);
  const hasFrames = groupAssetCount(group) > 0;
  const isLoading = state.generatingMoves.has(group.id);
  const activityEntries = state.moveActivity[group.id] ?? [];
  const generateButton = canGenerate
    ? `<button type="button" class="move-gen-btn" data-gen-move="${escapeHtml(group.id)}" ${isLoading ? 'disabled' : ''}>${isLoading ? 'Generating…' : (hasFrames ? 'Regen' : 'Generate')}</button>`
    : '';
  const activityButton = canGenerate && activityEntries.length > 0
    ? `<button type="button" class="move-activity-btn" data-move-activity="${escapeHtml(group.id)}" title="View activity log">${activityEntries.length}</button>`
    : '';
  const loadingClass = isLoading ? ' move-card-loading' : '';

  return `
    <article class="move-card${loadingClass}" data-move-card="${escapeHtml(group.id)}">
      <header class="move-card-header">
        <div>
          <span class="eyebrow">${escapeHtml(group.id)}${isLoading ? ' <span class="move-loading-badge">generating</span>' : ''}</span>
          <h3>${escapeHtml(moveGroupTitle(group))}</h3>
        </div>
        <div class="move-card-actions">
          ${activityButton}
          ${generateButton}
          <span class="frame-count">${escapeHtml(groupAssetCount(group))} assets</span>
        </div>
      </header>

      <div class="move-card-body">
        <div class="animation-pane">
          ${renderAnimationPlayer(animationId, previewFrames, group)}
          ${primarySheet ? `<a class="sheet-link" href="${primarySheet.apiUrl}" target="_blank" rel="noreferrer">Open sheet · ${escapeHtml(primarySheet.relativePath)}</a>` : '<span class="sheet-link muted-link">No sheet asset found</span>'}
        </div>
        <div class="move-data-pane">
          ${renderMoveCardTabs(group)}
        </div>
      </div>
    </article>
  `;
}

function renderMoveCardTabs(group) {
  const frameCount = group.variants.reduce((sum, variant) => sum + variant.frames.length, 0);
  const hasFrames = frameCount > 0 || group.projectiles.length > 0;
  const sounds = collectMoveSounds(group);
  const primarySheet = groupPrimarySheet(group);
  const canGenerate = MOVE_IDS.includes(group.id);
  const defaultTab = hasFrames ? 'frames' : 'data';

  const tab = (id, label, badge) => `
    <button type="button" class="move-tab${id === defaultTab ? ' active' : ''}" data-move-tab="${id}">
      ${label}${badge ? ` <span class="move-tab-badge">${badge}</span>` : ''}
    </button>`;
  const pane = (id, content) => `
    <div class="move-tab-pane" data-move-pane="${id}" ${id === defaultTab ? '' : 'hidden'}>${content}</div>`;

  const framesPane = `
    ${group.projectiles.length > 0 ? renderProjectileAssets(group.projectiles) : ''}
    ${group.variants.map(renderVariant).join('') || (group.projectiles.length > 0 ? '' : '<span class="empty-inline">No individual frame assets found for this move.</span>')}
  `;
  const soundsPane = sounds.length > 0
    ? `<div class="sound-pill-list">${sounds.map((sound) => `<span class="sound-pill">${escapeHtml(sound)}</span>`).join('')}</div>`
    : '<span class="empty-inline">No sound bindings on this move yet.</span>';
  const sourcePane = primarySheet
    ? `<a href="${primarySheet.apiUrl}" target="_blank" rel="noreferrer" class="source-sheet-link">
         <img loading="lazy" src="${primarySheet.apiUrl}" alt="${escapeHtml(group.id)} source sheet" class="source-sheet-img" />
         <span class="soft-label">${escapeHtml(primarySheet.relativePath)}</span>
       </a>`
    : '<span class="empty-inline">No source sheet generated for this move yet.</span>';
  const promptPane = `
    <textarea class="move-prompt-input" data-move-prompt="${escapeHtml(group.id)}" rows="4" spellcheck="false">${escapeHtml(rowPromptFor(group.id))}</textarea>
    <p class="move-note">Sent to the image generator when you hit Generate/Regen on this row. Auto-built from the character brief; edit freely — your edit sticks until the page reloads, and the prompt actually used is saved with the sheet.</p>
  `;

  return `
    <div class="move-tabs">
      ${tab('frames', 'Frames', frameCount || (group.projectiles.length || ''))}
      ${tab('data', 'Data')}
      ${canGenerate ? tab('prompt', 'Prompt') : ''}
      ${tab('sounds', 'Sounds', sounds.length || '')}
      ${tab('source', 'Source')}
    </div>
    ${pane('frames', framesPane)}
    ${pane('data', renderMoveData(group))}
    ${canGenerate ? pane('prompt', promptPane) : ''}
    ${pane('sounds', soundsPane)}
    ${pane('source', sourcePane)}
  `;
}

function collectMoveSounds(group) {
  const sounds = new Set();
  for (const move of group.moves ?? []) {
    for (const phase of move.phases ?? []) {
      for (const entry of phase.events ?? []) {
        const event = entry.event ?? entry;
        if (event?.type === 'play_sound' && event.name) sounds.add(event.name);
        if (event?.hitbox?.hitSound) sounds.add(event.hitbox.hitSound);
        if (event?.grab?.grabSound) sounds.add(event.grab.grabSound);
      }
    }
  }
  return [...sounds];
}

function renderAnimationPlayer(animationId, frames, group) {
  if (frames.length === 0) {
    const primarySheet = groupPrimarySheet(group);
    if (primarySheet) {
      return `
        <section class="animation-player">
          <div class="animation-toolbar">
            <div>
              <span class="eyebrow">Source sheet</span>
              <strong>${escapeHtml(moveGroupTitle(group))}</strong>
            </div>
            <span class="soft-label">not yet normalized</span>
          </div>
          <div class="animation-preview">
            <img src="${primarySheet.apiUrl}" alt="${escapeHtml(group.id)} source sheet" />
          </div>
        </section>
      `;
    }

    const label = group.id === 'projectiles' ? 'projectile assets' : `${group.id} frames`;
    return `
      <section class="animation-player">
        <div class="animation-toolbar">
          <div>
            <span class="eyebrow">Animation</span>
            <strong>${escapeHtml(moveGroupTitle(group))}</strong>
          </div>
          <span class="soft-label">0 frames</span>
        </div>
        <div class="animation-preview empty-animation">No ${escapeHtml(label)}</div>
      </section>
    `;
  }

  const controlsDisabled = frames.length <= 1 ? 'disabled' : '';
  const frameButtons = frames.map((frame, index) => `
    <button type="button" data-animation-action="goto" data-frame-index="${index}" title="${escapeHtml(frame.relativePath ?? `Frame ${index + 1}`)}">${index + 1}</button>
  `).join('');

  return `
    <section class="animation-player" data-animation-player="${escapeHtml(animationId)}">
      <div class="animation-toolbar">
        <div>
          <span class="eyebrow">Animation</span>
          <strong>${escapeHtml(moveGroupTitle(group))}</strong>
        </div>
        <span class="soft-label">${frames.length} frame loop</span>
      </div>
      <div class="animation-preview">
        <img data-animation-id="${escapeHtml(animationId)}" src="${frames[0].apiUrl}" alt="${escapeHtml(group.id)} animation preview" />
      </div>
      <div class="animation-controls">
        <button type="button" data-animation-action="previous" ${controlsDisabled}>Prev</button>
        <button type="button" data-animation-action="toggle" ${controlsDisabled}>Pause</button>
        <button type="button" data-animation-action="next" ${controlsDisabled}>Next</button>
        <span data-animation-counter>1 / ${frames.length}</span>
      </div>
      <div class="animation-scrub">${frameButtons}</div>
    </section>
  `;
}

function renderVariant(variant) {
  return `
    <section class="variant-row">
      <div class="variant-heading">
        <strong>${escapeHtml(variant.actor)}</strong>
        <span>${variant.frames.length} frames${variant.sheet ? ' · sheet' : ''}</span>
      </div>
      <div class="frame-strip">
        ${variant.frames.map((frame, index) => `
          <a href="${frame.apiUrl}" target="_blank" rel="noreferrer" title="${escapeHtml(frame.relativePath)}">
            <img loading="lazy" src="${frame.apiUrl}" alt="${escapeHtml(`${variant.actor} ${index + 1}`)}" />
          </a>
        `).join('')}
      </div>
    </section>
  `;
}

function renderProjectileAssets(projectiles) {
  return `
    <section class="variant-row projectile-row">
      <div class="variant-heading">
        <strong>projectiles</strong>
        <span>${projectiles.length} assets</span>
      </div>
      <div class="projectile-strip">
        ${projectiles.sort(compareAssetPaths).map((asset) => `
          <a class="projectile-tile" href="${asset.apiUrl}" target="_blank" rel="noreferrer" title="${escapeHtml(asset.relativePath)}">
            <img loading="lazy" src="${asset.apiUrl}" alt="${escapeHtml(asset.name ?? asset.relativePath)}" />
            <span>${escapeHtml(projectileDisplayName(asset))}</span>
          </a>
        `).join('')}
      </div>
    </section>
  `;
}

function renderMoveData(group) {
  if (group.moves.length === 0) {
    if (group.id === 'base') return '<p class="move-note">Idle and base locomotion frames for stance, walking, crouch, hitstun, and recovery states.</p>';
    if (group.id === 'projectiles') return '<p class="move-note">Spawned projectile and effect assets. Runtime move bindings are shown on the projectile moves that spawn them.</p>';
    return '<p class="move-note">No move record is bound to this animation yet.</p>';
  }

  return group.moves.map((move) => {
    const summary = summarizeMove(move);
    return `
      <section class="move-record">
        <div class="move-record-title">
          <strong>${escapeHtml(move.displayName ?? move.name ?? move.id)}</strong>
          <span>${escapeHtml(move.animation ?? group.id)}</span>
        </div>
        ${move.description ? `<p>${escapeHtml(move.description)}</p>` : ''}
        <div class="move-stat-row">
          ${summary.map(([label, value]) => `<span><b>${escapeHtml(label)}</b>${escapeHtml(value)}</span>`).join('')}
        </div>
        ${renderPhases(move)}
      </section>
    `;
  }).join('');
}

function renderPhases(move) {
  if (!Array.isArray(move.phases) || move.phases.length === 0) {
    return '<span class="empty-inline">No phase or hitbox stats imported for this move yet.</span>';
  }

  return `
    <div class="phase-grid">
      ${move.phases.map((phase) => `
        <div class="phase-cell">
          <strong>${escapeHtml(phase.name)}</strong>
          <span>${escapeHtml(phase.frames)}f</span>
          <small>${escapeHtml(summarizePhaseEvents(phase))}</small>
        </div>
      `).join('')}
    </div>
  `;
}

function renderAdapter(adapter, health = {}) {
  const row = document.createElement('div');
  row.className = 'adapter-row';
  const status = normalizeHealthStatus(health.status);
  const capabilities = adapter.capabilities.length > 0 ? adapter.capabilities.join(', ') : 'no declared capabilities';
  row.innerHTML = `
    <div class="adapter-row-title">
      <strong>${escapeHtml(adapter.port)}</strong>
      <span class="health-badge health-${escapeHtml(status)}">${escapeHtml(status)}</span>
    </div>
    <span>${escapeHtml(adapter.provider)} · ${escapeHtml(adapter.id)} · ${escapeHtml(capabilities)}</span>
    <small>${escapeHtml(health.message ?? 'No health details reported.')}</small>
  `;
  return row;
}

function renderGap(gap) {
  const row = document.createElement('div');
  row.className = 'gap-row';
  row.innerHTML = `<strong>${escapeHtml(gap.title)}</strong><span>${escapeHtml(gap.detail)}</span>`;
  return row;
}

function renderChatStatus(agent = {}) {
  const status = normalizeHealthStatus(agent.status);
  elements.chatStatus.textContent = `${agent.provider ?? 'chat'} · ${status}`;
  elements.chatStatus.className = `soft-label chat-health chat-health-${status}`;
}

function appendChatMessage(message) {
  state.chatMessages.push(message);
  if (state.chatMessages.length > 100) state.chatMessages.shift();
  renderChatThread();
  markActivityUnread(message.isError ? 'error' : '');
}

// Operations report into the Activity pane, which is one of three ops tabs. When
// it's hidden (user is on Pipeline/Tools), flag the tab so a Publish/Normalize
// click from the center column doesn't produce zero visible feedback.
function markActivityUnread(level) {
  const tab = elements.opsPanel?.querySelector('[data-ops-tab="activity"]');
  const pane = elements.opsPanel?.querySelector('[data-ops-pane="activity"]');
  if (!tab || !pane || !pane.hidden) return;
  tab.classList.add('has-unread');
  if (level === 'error') tab.classList.add('has-error');
}

function renderChatThread() {
  if (state.chatMessages.length === 0) {
    elements.chatThread.innerHTML = '<div class="chat-empty">No activity yet.</div>';
    return;
  }

  elements.chatThread.replaceChildren(...state.chatMessages.map((message, messageIndex) => {
    if (message.role === 'system') {
      const row = document.createElement('div');
      const levelClass = message.level === 'error' ? ' status-error' : message.level === 'pass' ? ' status-pass' : '';
      row.className = `activity-system${levelClass}`;
      if (message.level === 'error') {
        row.classList.add('run-log-error-line');
        row.dataset.errorMessage = message.text;
        row.addEventListener('click', () => {
          openErrorModal({ name: 'run-log', status: 'error', input: null, result: null, error: message.text });
        });
      }
      row.textContent = message.text;
      return row;
    }

    if (message.role === 'assistant-thinking') {
      const row = document.createElement('article');
      row.className = 'chat-message chat-assistant assistant-thinking';
      row.innerHTML = `
        <header><strong>Assistant</strong></header>
        <p>${escapeHtml(message.text)}</p>
      `;
      return row;
    }

    const row = document.createElement('article');
    row.className = `chat-message chat-${message.role}${message.isError ? ' chat-error' : ''}`;
    const provider = message.provider ? `<span>${escapeHtml(message.provider)}</span>` : '';
    const toolCalls = renderChatToolCalls(message.toolCalls ?? [], messageIndex);
    row.innerHTML = `
      <header><strong>${escapeHtml(message.role === 'user' ? 'You' : 'Assistant')}</strong>${provider}</header>
      <p>${escapeHtml(message.text)}</p>
      ${toolCalls}
    `;
    return row;
  }));
  elements.chatThread.scrollTop = elements.chatThread.scrollHeight;
}

function renderChatToolCalls(toolCalls, messageIndex) {
  if (toolCalls.length === 0) return '';
  return `
    <div class="chat-tool-list">
      ${toolCalls.map((toolCall, toolCallIndex) => {
        const isError = toolCall.status === 'error';
        const errorAttr = isError
          ? `data-error-message-index="${messageIndex}" data-error-tool-index="${toolCallIndex}" title="Click to view error details"`
          : '';
        return `
          <details ${errorAttr}>
            <summary>
              <span>${escapeHtml(toolCall.name)}</span>
              <b class="${isError ? 'status-error' : 'status-pass'}">${escapeHtml(toolCall.status)}</b>
            </summary>
            <pre>${escapeHtml(JSON.stringify({
              input: toolCall.input,
              result: toolCall.result,
              error: toolCall.error,
            }, null, 2))}</pre>
          </details>
        `;
      }).join('')}
    </div>
  `;
}

function buildMoveGroups(draft, assets) {
  const groups = new Map();
  const ensureGroup = (id) => {
    if (!groups.has(id)) {
      groups.set(id, {
        id,
        moves: [],
        variantsByActor: new Map(),
        variants: [],
        projectiles: [],
      });
    }
    return groups.get(id);
  };

  ensureGroup('base');
  for (const move of draft.moves ?? []) {
    const animation = move.animation ?? inferAnimationId(move.id);
    ensureGroup(animation).moves.push(move);
  }

  for (const asset of assets) {
    const sprite = parseSpriteAsset(asset);
    if (sprite) {
      const group = ensureGroup(sprite.moveId);
      const variant = ensureVariant(group, sprite.actor);
      variant.frames.push(asset);
      continue;
    }

    const sheet = parseSheetAsset(asset);
    if (sheet) {
      const group = ensureGroup(sheet.moveId);
      const variant = ensureVariant(group, sheet.actor);
      variant.sheet = asset;
      continue;
    }

    const sourceRow = parseSourceRowSheet(asset);
    if (sourceRow && MOVE_IDS.includes(sourceRow.moveId)) {
      const group = ensureGroup(sourceRow.moveId);
      const variant = ensureVariant(group, 'source');
      variant.sheet = asset;
      continue;
    }

    const projectile = parseProjectileAsset(asset);
    if (projectile) {
      ensureGroup('projectiles').projectiles.push({
        ...asset,
        actor: projectile.actor,
        name: projectile.name,
      });
    }
  }

  for (const group of groups.values()) {
    group.variants = [...group.variantsByActor.values()]
      .map((variant) => ({
        ...variant,
        frames: variant.frames.sort(compareAssetPaths),
      }))
      .sort((left, right) => actorSortKey(left.actor).localeCompare(actorSortKey(right.actor)));
  }

  return [...groups.values()]
    .filter((group) => group.moves.length > 0 || group.variants.length > 0 || group.projectiles.length > 0 || group.id === 'base')
    .sort((left, right) => moveSortKey(left.id).localeCompare(moveSortKey(right.id)));
}

function ensureVariant(group, actor) {
  if (!group.variantsByActor.has(actor)) {
    group.variantsByActor.set(actor, { actor, frames: [], sheet: null });
  }
  return group.variantsByActor.get(actor);
}

function parseSpriteAsset(asset) {
  const match = asset.relativePath.match(/^(?:(.+)\/)?sprites\/([^/]+)\/([^/]+\.png)$/);
  if (!match) return null;
  return {
    actor: actorFromPrefix(match[1]),
    moveId: match[2],
  };
}

function parseSheetAsset(asset) {
  const match = asset.relativePath.match(/^(?:(.+)\/)?sheets\/([^/]+)\.png$/);
  if (!match) return null;
  return {
    actor: actorFromPrefix(match[1]),
    moveId: match[2],
  };
}

function parseSourceRowSheet(asset) {
  const match = asset.relativePath.match(/^source\/.+_(base|punch|kick|special_1|special_2)_sheet\.png$/);
  if (!match) return null;
  return { moveId: match[1] };
}

function parseProjectileAsset(asset) {
  const match = asset.relativePath.match(/^(?:(.+)\/)?projectiles\/([^/]+\.png)$/);
  if (!match) return null;
  return {
    actor: actorFromPrefix(match[1]),
    name: match[2],
  };
}

function actorFromPrefix(prefix = '') {
  const meaningful = prefix.split('/').filter((part) => part && part !== 'fighter-pack');
  return meaningful.length > 0 ? meaningful.join('/') : 'main';
}

function summarizeAssets(assets) {
  return assets.reduce((counts, asset) => {
    if (parseSpriteAsset(asset)) counts.frames += 1;
    if (parseSheetAsset(asset)) counts.sheets += 1;
    if (parseProjectileAsset(asset)) counts.projectiles += 1;
    return counts;
  }, { frames: 0, sheets: 0, projectiles: 0 });
}

function summarizeMove(move) {
  const phases = Array.isArray(move.phases) ? move.phases : [];
  const hitboxes = phases.flatMap((phase) => phase.events ?? [])
    .map((entry) => entry.event)
    .filter((event) => event?.type === 'hitbox_active' && event.hitbox);
  const projectiles = phases.flatMap((phase) => phase.events ?? [])
    .map((entry) => entry.event)
    .filter((event) => String(event?.type ?? '').startsWith('spawn_projectile'));
  const totalFrames = phases.reduce((sum, phase) => sum + (Number(phase.frames) || 0), 0);
  const damage = hitboxes.reduce((sum, event) => sum + (Number(event.hitbox.damage) || 0), 0);
  const trigger = move.trigger?.sequence?.join(' ') ?? 'none';

  return [
    ['Input', trigger],
    ['Frames', totalFrames > 0 ? `${totalFrames}f` : 'n/a'],
    ['Damage', damage > 0 ? String(damage) : 'n/a'],
    ['Hitboxes', String(hitboxes.length)],
    ['Projectiles', String(projectiles.length)],
  ];
}

function summarizePhaseEvents(phase) {
  const events = (phase.events ?? []).map((entry) => entry.event?.type).filter(Boolean);
  if (events.length === 0) return 'no events';
  return events.slice(0, 3).join(', ') + (events.length > 3 ? ` +${events.length - 3}` : '');
}

function hydratePipelineStateFromAssets(assets) {
  const latestSource = [...assets].reverse().find((asset) => /^source\/.+\.(svg|png)$/i.test(asset.relativePath));
  const latestManifest = [...assets].reverse().find((asset) => /(?:^|\/)(fighter-pack|normalized)\/manifest\.json$/i.test(asset.relativePath));
  if (latestSource) state.sourceAssetKey = latestSource.key;
  if (latestManifest) state.normalizedKey = latestManifest.key;
}

function setActiveCharacterRow(characterId) {
  for (const row of elements.characterList.querySelectorAll('.character-row')) {
    row.classList.toggle('active', row.dataset.characterId === characterId);
  }
}

function startAnimationPreviews() {
  stopAnimationTimers();
  for (const player of elements.characterWorkbench.querySelectorAll('[data-animation-player]')) {
    const animationId = player.dataset.animationPlayer;
    const frames = state.previewFrames.get(animationId) ?? [];
    state.animationStates.set(animationId, { frameIndex: 0, isPlaying: frames.length > 1 });
    if (frames.length <= 1) continue;

    const timer = window.setInterval(() => {
      const animation = state.animationStates.get(animationId);
      if (!animation?.isPlaying) return;
      animation.frameIndex = (animation.frameIndex + 1) % frames.length;
      updateAnimationPlayer(animationId);
    }, 180);
    state.animationTimers.push(timer);
  }

  for (const animationId of state.previewFrames.keys()) {
    updateAnimationPlayer(animationId);
  }
}

function clearAnimationTimers() {
  stopAnimationTimers();
  state.previewFrames = new Map();
}

function stopAnimationTimers() {
  for (const timer of state.animationTimers) window.clearInterval(timer);
  state.animationTimers = [];
  state.animationStates = new Map();
}

function handleAnimationControl(event) {
  const button = event.target.closest('[data-animation-action]');
  if (!button) return;

  const player = button.closest('[data-animation-player]');
  const animationId = player?.dataset.animationPlayer;
  const frames = state.previewFrames.get(animationId) ?? [];
  const animation = state.animationStates.get(animationId);
  if (!animation || frames.length === 0) return;

  const action = button.dataset.animationAction;
  if (action === 'toggle') {
    animation.isPlaying = !animation.isPlaying;
  } else if (action === 'previous') {
    animation.isPlaying = false;
    animation.frameIndex = (animation.frameIndex - 1 + frames.length) % frames.length;
  } else if (action === 'next') {
    animation.isPlaying = false;
    animation.frameIndex = (animation.frameIndex + 1) % frames.length;
  } else if (action === 'goto') {
    animation.isPlaying = false;
    animation.frameIndex = Math.max(0, Math.min(frames.length - 1, Number.parseInt(button.dataset.frameIndex, 10) || 0));
  }

  updateAnimationPlayer(animationId);
}

function updateAnimationPlayer(animationId) {
  const frames = state.previewFrames.get(animationId) ?? [];
  const animation = state.animationStates.get(animationId);
  const player = findAnimationPlayer(animationId);
  if (!animation || !player || frames.length === 0) return;

  const frameIndex = Math.max(0, Math.min(frames.length - 1, animation.frameIndex));
  const image = player.querySelector('[data-animation-id]');
  if (image) image.src = frames[frameIndex];

  const counter = player.querySelector('[data-animation-counter]');
  if (counter) counter.textContent = `${frameIndex + 1} / ${frames.length}`;

  const toggle = player.querySelector('[data-animation-action="toggle"]');
  if (toggle) {
    toggle.textContent = animation.isPlaying ? 'Pause' : 'Play';
    toggle.setAttribute('aria-pressed', String(animation.isPlaying));
  }

  for (const frameButton of player.querySelectorAll('[data-animation-action="goto"]')) {
    frameButton.classList.toggle('is-active', Number(frameButton.dataset.frameIndex) === frameIndex);
  }
}

function findAnimationPlayer(animationId) {
  return [...elements.characterWorkbench.querySelectorAll('[data-animation-player]')]
    .find((player) => player.dataset.animationPlayer === animationId);
}

function groupPrimaryFrames(group) {
  return (group.variants.find((variant) => variant.actor === 'lead')
    ?? group.variants.find((variant) => variant.actor === 'main')
    ?? group.variants[0]
    ?? { frames: [] }).frames;
}

function groupPrimarySheet(group) {
  return (group.variants.find((variant) => variant.actor === 'lead')
    ?? group.variants.find((variant) => variant.actor === 'main')
    ?? group.variants[0]
    ?? { sheet: null }).sheet;
}

function moveGroupTitle(group) {
  if (group.id === 'base') return 'Base / States';
  if (group.id === 'projectiles') return 'Projectiles / Effects';
  if (group.moves.length === 1) return group.moves[0].displayName ?? group.moves[0].name ?? titleize(group.id);
  if (group.moves.length > 1) return `${titleize(group.id)} Moves`;
  return titleize(group.id);
}

function groupAssetCount(group) {
  return group.variants.reduce((sum, variant) => sum + variant.frames.length + (variant.sheet ? 1 : 0), 0) + group.projectiles.length;
}

function inferAnimationId(moveId) {
  const value = String(moveId ?? '');
  if (value.includes('kick')) return 'kick';
  if (value.includes('punch') || value.includes('jab') || value.includes('dash')) return 'punch';
  if (value.includes('projectile') || value.includes('fireball')) return 'special_1';
  if (value.includes('uppercut')) return 'special_2';
  return value || 'base';
}

function compareAssetPaths(left, right) {
  return left.relativePath.localeCompare(right.relativePath, undefined, { numeric: true });
}

function moveSortKey(id) {
  const index = MOVE_ORDER.indexOf(id);
  return `${index === -1 ? 99 : index}-${id}`;
}

function actorSortKey(actor) {
  const actorOrder = ['main', 'lead', 'echo', 'fusion'];
  const index = actorOrder.indexOf(actor);
  return `${index === -1 ? 99 : index}-${actor}`;
}

function currentCharacterId() {
  const characterId = state.currentCharacterId || elements.characterId.value.trim();
  if (!characterId) {
    log('Choose or create a character first.', 'error');
    return '';
  }
  state.currentCharacterId = characterId;
  return characterId;
}

function syncAssetPath() {
  const file = elements.assetFile.files?.[0] ?? null;
  const kind = elements.assetKind.value;
  elements.assetMove.disabled = kind === 'custom' || kind === 'source' || kind === 'projectile';
  elements.assetFrame.disabled = kind !== 'frame';
  elements.assetPath.readOnly = kind !== 'custom';

  if (kind === 'custom') {
    if (!elements.assetPath.value) {
      elements.assetPath.placeholder = 'sprites/punch/punch_001.png';
    }
    return;
  }

  elements.assetPath.value = previewAssetRelativePath(file);
}

function previewAssetRelativePath(file) {
  const kind = elements.assetKind.value;
  const prefix = normalizePathPrefix(elements.assetActor.value);
  const prefixPath = prefix ? `${prefix}/` : '';
  const moveId = sanitizePathPart(elements.assetMove.value || 'base');
  const frameNumber = padFrame(elements.assetFrame.value);
  const fileName = file ? safeFileName(file.name) : '';
  const extension = file ? extensionFromName(file.name) : '.png';

  if (kind === 'frame') return `${prefixPath}sprites/${moveId}/${moveId}_${frameNumber}.png`;
  if (kind === 'sheet') return `${prefixPath}sheets/${moveId}.png`;
  if (kind === 'projectile') return `${prefixPath}projectiles/${fileName || 'projectile.png'}`;
  if (kind === 'source') return `${prefixPath}source/${fileName || `source${extension}`}`;
  return elements.assetPath.value.trim();
}

function buildAssetRelativePath(file) {
  const kind = elements.assetKind.value;
  const extension = extensionFromName(file.name);
  if ((kind === 'frame' || kind === 'sheet' || kind === 'projectile') && extension !== '.png') {
    throw new Error('Sprite frames, sheets, and projectiles must be PNG files.');
  }

  const relativePath = kind === 'custom'
    ? elements.assetPath.value.trim()
    : previewAssetRelativePath(file);
  if (!relativePath || relativePath.includes('..') || relativePath.startsWith('/')) {
    throw new Error('CMS path must be a relative path inside the character assets folder.');
  }
  return relativePath;
}

function showLatestAsset(asset) {
  // Always a freshly produced asset — bump so its preview never shows the
  // previous render's cached image at the same key.
  bustAssetCache();
  elements.assetLabel.textContent = asset.key;
  if (isPreviewableImage(asset)) {
    elements.assetPreview.className = 'asset-preview-frame';
    elements.assetPreview.innerHTML = `<img src="${withCacheBust(asset.apiUrl)}" alt="${escapeHtml(asset.relativePath ?? asset.key)} preview" />`;
    return;
  }

  elements.assetPreview.className = 'asset-preview-empty';
  elements.assetPreview.textContent = asset.relativePath ?? asset.key;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function normalizePathPrefix(value) {
  return String(value ?? '')
    .split('/')
    .map(sanitizePathPart)
    .filter(Boolean)
    .join('/');
}

function sanitizePathPart(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function safeFileName(value) {
  const extension = extensionFromName(value);
  const baseName = String(value ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.replace(/\.[^.]+$/, '') ?? 'asset';
  return `${sanitizePathPart(baseName) || 'asset'}${extension}`;
}

function extensionFromName(value) {
  const match = String(value ?? '').toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : '.png';
}

function contentTypeFromName(value) {
  switch (extensionFromName(value)) {
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.json':
      return 'application/json';
    case '.txt':
      return 'text/plain';
    default:
      return 'application/octet-stream';
  }
}

function isPreviewableImage(asset) {
  const contentType = asset.metadata?.contentType ?? '';
  return contentType.startsWith('image/') || /\.(png|svg|jpe?g|webp)$/i.test(asset.relativePath ?? asset.key);
}

function projectileDisplayName(asset) {
  return String(asset.name ?? asset.relativePath)
    .replace(/\.png$/i, '')
    .split('/')
    .pop();
}

function padFrame(value) {
  const number = Math.max(1, Math.min(999, Number.parseInt(value, 10) || 1));
  return String(number).padStart(3, '0');
}

async function getJson(url) {
  const response = await fetch(url);
  return parseJsonResponse(response);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseJsonResponse(response);
}

async function parseJsonResponse(response) {
  const value = await response.json();
  if (!response.ok) {
    throw new Error(value.error ?? `Request failed with ${response.status}`);
  }
  return value;
}

function setBusy(isBusy) {
  const staticButtons = [
    elements.createDraft,
    elements.runChain,
    elements.generateSheet,
    elements.normalizePack,
    elements.validatePack,
    elements.publishCharacter,
    elements.uploadAsset,
    elements.sendChat,
    elements.refreshRoster,
  ];

  // CTA banner buttons are re-rendered on every workbench update — query them live
  const ctaButtons = [
    elements.characterWorkbench.querySelector('#cta-generate-sheet'),
    elements.characterWorkbench.querySelector('#cta-normalize-pack'),
    elements.characterWorkbench.querySelector('#cta-validate-pack'),
    elements.characterWorkbench.querySelector('#cta-publish-character'),
  ];

  for (const button of [...staticButtons, ...ctaButtons]) {
    if (button) button.disabled = isBusy;
  }
}

function log(message, level = '') {
  const entry = { role: 'system', text: message, level, ts: Date.now() };
  state.chatMessages.push(entry);
  if (state.chatMessages.length > 100) state.chatMessages.shift();
  renderChatThread();
  markActivityUnread(level);
}

// ---------------------------------------------------------------------------
// Error detail modal
// ---------------------------------------------------------------------------

function openErrorModal(toolCall) {
  const { name, status, input, result, error } = toolCall;

  const statusClass = status === 'error' ? 'error-modal-status-error' : 'error-modal-status-ok';
  const errorBlock = (error != null)
    ? `<section class="error-modal-section">
        <div class="error-modal-section-label">Error</div>
        <pre class="error-modal-pre error-modal-pre-error">${escapeHtml(typeof error === 'string' ? error : JSON.stringify(error, null, 2))}</pre>
       </section>`
    : '';
  const resultBlock = (result != null)
    ? `<section class="error-modal-section">
        <div class="error-modal-section-label">Result</div>
        <pre class="error-modal-pre">${escapeHtml(JSON.stringify(result, null, 2))}</pre>
       </section>`
    : '';
  const inputBlock = (input != null)
    ? `<section class="error-modal-section">
        <div class="error-modal-section-label">Input</div>
        <pre class="error-modal-pre">${escapeHtml(JSON.stringify(input, null, 2))}</pre>
       </section>`
    : '';

  elements.errorModal.innerHTML = `
    <div class="error-modal-box" role="document">
      <div class="error-modal-header">
        <h2 id="error-modal-title" class="error-modal-title">${escapeHtml(name)}</h2>
        <span class="error-modal-status ${escapeHtml(statusClass)}">${escapeHtml(status)}</span>
        <button type="button" class="error-modal-close" aria-label="Close error details">&times;</button>
      </div>
      <div class="error-modal-body">
        ${errorBlock}
        ${inputBlock}
        ${resultBlock}
      </div>
      <div class="error-modal-footer">
        <!-- Slot reserved for future "Send to Claude" button -->
        <button type="button" class="error-modal-diagnose">Diagnose with Codex</button>
      </div>
    </div>
  `;

  // Store context on the modal element for the diagnose handler
  elements.errorModal._toolCallContext = toolCall;

  const closeButton = elements.errorModal.querySelector('.error-modal-close');
  closeButton.addEventListener('click', closeErrorModal);

  const diagnoseButton = elements.errorModal.querySelector('.error-modal-diagnose');
  diagnoseButton.addEventListener('click', diagnoseWithCodex);

  elements.errorModal.addEventListener('click', handleModalBackdropClick);

  elements.errorModal.hidden = false;
  closeButton.focus();
}

function closeErrorModal() {
  elements.errorModal.hidden = true;
  elements.errorModal.innerHTML = '';
  elements.errorModal.removeEventListener('click', handleModalBackdropClick);
  elements.errorModal._toolCallContext = null;
}

function handleModalBackdropClick(event) {
  if (event.target === elements.errorModal) {
    closeErrorModal();
  }
}

function diagnoseWithCodex() {
  const toolCall = elements.errorModal._toolCallContext;
  if (!toolCall) return;

  const { name, error, input } = toolCall;
  const errorMessage = typeof error === 'string' ? error : JSON.stringify(error);
  const diagMessage = `Diagnose this error: tool "${name}" failed with: ${errorMessage}. Input was: ${JSON.stringify(input)}`;

  closeErrorModal();

  elements.chatMessage.value = diagMessage;
  elements.chatForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

// ---------------------------------------------------------------------------
// Move activity slide-over (separate surface from the error modal)
// ---------------------------------------------------------------------------

function renderMoveActivityRows(moveId) {
  const entries = state.moveActivity[moveId] ?? [];
  return entries.map((entry) => {
    const levelClass = entry.level === 'error' ? 'status-error' : entry.level === 'pass' ? 'status-pass' : '';
    const time = new Date(entry.ts).toLocaleTimeString();
    return `<div class="activity-entry ${levelClass}"><span class="activity-ts">${escapeHtml(time)}</span>${escapeHtml(entry.message)}</div>`;
  }).join('');
}

function openMoveActivityPanel(moveId) {
  const entries = state.moveActivity[moveId] ?? [];
  if (entries.length === 0) return;
  state.openActivityMove = moveId;

  elements.moveActivityPanel.innerHTML = `
    <div class="move-activity-header">
      <h2 id="move-activity-title" class="move-activity-title">${escapeHtml(moveId)} activity</h2>
      <span class="soft-label" data-activity-count>${entries.length} events</span>
      <button type="button" class="move-activity-close" aria-label="Close activity log">&times;</button>
    </div>
    <div class="activity-log" data-activity-log>${renderMoveActivityRows(moveId)}</div>
  `;
  elements.moveActivityPanel.querySelector('.move-activity-close').addEventListener('click', closeMoveActivityPanel);
  elements.moveActivityPanel.hidden = false;
}

function closeMoveActivityPanel() {
  state.openActivityMove = null;
  elements.moveActivityPanel.hidden = true;
  elements.moveActivityPanel.innerHTML = '';
}

function refreshMoveActivityPanel(moveId) {
  if (state.openActivityMove !== moveId || elements.moveActivityPanel.hidden) return;
  const logEl = elements.moveActivityPanel.querySelector('[data-activity-log]');
  const countEl = elements.moveActivityPanel.querySelector('[data-activity-count]');
  if (logEl) {
    logEl.innerHTML = renderMoveActivityRows(moveId);
    logEl.scrollTop = logEl.scrollHeight;
  }
  if (countEl) countEl.textContent = `${(state.moveActivity[moveId] ?? []).length} events`;
}

// Close overlays on Escape: activity panel first, then the error modal
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!elements.moveActivityPanel.hidden) {
    closeMoveActivityPanel();
    return;
  }
  if (!elements.errorModal.hidden) {
    closeErrorModal();
  }
});

function showError(error) {
  log(error.message ?? String(error), 'error');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeHealthStatus(status) {
  if (status === 'ok' || status === 'warning' || status === 'error') return status;
  return 'unknown';
}

function titleize(value) {
  return String(value)
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function formatNumber(value) {
  if (typeof value !== 'number') return value;
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
