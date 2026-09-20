import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetRecordForKey, writeCharacterAssetUpload } from '../assets/uploadCharacterAsset.js';
import { createLocalCmsRuntime } from '../runtime/createLocalCmsRuntime.js';
import { convertDraftToCharacterConfig } from '../export/convertDraftToCharacterConfig.js';
import { segment } from '../storage/LineageStore.js';
import { reprocessArchivedVideo } from '../pipeline/reprocessArchivedVideo.js';
import { compareVersions } from '../repositories/characterHistory.js';
import { resumeArchivedVideo } from '../pipeline/resumeArchivedVideo.js';
import { workbenchLibrary, workbenchDetail, updateWorkbench, workbenchReviewClip } from '../authoring/workbenchLibrary.js';
import {publishReadiness} from '../authoring/publishReadiness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_ADMIN_ROOT = path.join(REPO_ROOT, 'admin');

export function createCmsServer(options = {}) {
  const runtime = options.runtime ?? createLocalCmsRuntime(options.runtimeOptions ?? {});
  const adminRoot = path.resolve(options.adminRoot ?? DEFAULT_ADMIN_ROOT);

  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);

      if (url.pathname.startsWith('/api/')) {
        await handleApiRequest({ request, response, url, runtime });
        return;
      }

      await serveAdminAsset({ response, url, adminRoot });
    } catch (error) {
      sendError(response, error);
    }
  });
}

async function handleApiRequest({ request, response, url, runtime }) {
  if (request.method === 'GET' && url.pathname === '/api/status') {
    sendJson(response, { ok: true, service: 'thousand-fighters-cms', storage: runtime.storage.constructor.name });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/health') {
    const adapterHealth = await runtime.registry.health();
      sendJson(response, {
        ok: true,
        service: 'thousand-fighters-cms',
        storage: runtime.storage.constructor.name,
        adapters: runtime.registry.describe(),
        adapterHealth,
        chatAgent: await chatAgentHealth(runtime),
      });
      return;
    }

  if (request.method === 'GET' && url.pathname === '/api/pipeline') {
    sendJson(response, {
      adapters: runtime.registry.describe(),
      adapterHealth: await runtime.registry.health(),
      gaps: runtime.gaps,
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/tools') {
    const format = url.searchParams.get('format');
    sendJson(response, {
      tools: format === 'openai' ? runtime.tools.openAiTools() : runtime.tools.list(),
    });
    return;
  }

  // SSE streaming tool invocation — must come BEFORE the non-streaming handler
  if (request.method === 'POST' && url.pathname.startsWith('/api/tools/') && url.searchParams.has('stream')) {
    const toolName = decodeURIComponent(url.pathname.slice('/api/tools/'.length));
    const input = await readJsonBody(request);

    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
    });

    let ended = false;
    request.on('close', () => { ended = true; });

    const sendEvent = (eventType, data) => {
      if (ended || response.writableEnded) return;
      try {
        response.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {}
    };

    // Inject onProgress into context — this is the server-side callback, not serialised over the wire
    input.context = input.context ?? {};
    input.context.onProgress = (event) => {
      sendEvent('progress', event);
    };

    try {
      const result = await invokeTrackedTool(runtime, toolName, input);
      sendEvent('result', { ok: true, tool: toolName, result });
    } catch (err) {
      sendEvent('error', { error: err.message });
    }

    if (!response.writableEnded) response.end();
    return;
  }

  if (request.method === 'POST' && url.pathname.startsWith('/api/tools/')) {
    const toolName = decodeURIComponent(url.pathname.slice('/api/tools/'.length));
    const input = await readJsonBody(request);
    const result = await invokeTrackedTool(runtime, toolName, input);
    sendJson(response, { ok: true, tool: toolName, result });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/chat/health') {
    sendJson(response, {
      agent: await chatAgentHealth(runtime),
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/chat') {
    const input = await readJsonBody(request);
    const result = await runtime.chatAgent.chat(input);
    sendJson(response, { ok: true, result });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/characters') {
    sendJson(response, { characters: url.searchParams.get('view') === 'workbench' ? await workbenchLibrary(runtime.repository) : await runtime.repository.listCharacters() });
    return;
  }

  const readinessMatch=url.pathname.match(/^\/api\/characters\/([^/]+)\/readiness$/);
  if(readinessMatch&&request.method==='GET'){
    sendJson(response,await publishReadiness(runtime.repository,segment(decodeURIComponent(readinessMatch[1]))));
    return;
  }
  const workbenchMatch = url.pathname.match(/^\/api\/characters\/([^/]+)\/workbench$/);
  if (workbenchMatch && ['GET', 'POST'].includes(request.method)) {
    const characterId = segment(decodeURIComponent(workbenchMatch[1]));
    sendJson(response, request.method === 'GET' ? await workbenchDetail(runtime.repository, characterId) : await updateWorkbench(runtime.repository, characterId, await readJsonBody(request)));
    return;
  }
  const reviewClipMatch = url.pathname.match(/^\/api\/characters\/([^/]+)\/review-clip\/([^/]+)$/);
  if (request.method === 'GET' && reviewClipMatch) {
    sendJson(response, await workbenchReviewClip(runtime.repository, segment(decodeURIComponent(reviewClipMatch[1])), segment(decodeURIComponent(reviewClipMatch[2])),{mode:url.searchParams.get('timing')??'game',moveId:url.searchParams.get('move')??undefined}));
    return;
  }

  const draftMatch = url.pathname.match(/^\/api\/characters\/([^/]+)\/draft$/);
  if (request.method === 'GET' && draftMatch) {
    sendJson(response, { draft: await runtime.repository.getDraft(decodeURIComponent(draftMatch[1])) });
    return;
  }

  const historyMatch = url.pathname.match(/^\/api\/characters\/([^/]+)\/history(?:\/(checkpoint|restore|branch|reprocess|compare|resume))?$/);
  if (historyMatch) {
    const characterId = segment(decodeURIComponent(historyMatch[1]));
    if (request.method === 'GET' && historyMatch[2] === 'compare') {
      sendJson(response, await compareVersions(runtime.repository, characterId, url.searchParams.get('left'), url.searchParams.get('right')));
      return;
    }
    if (request.method === 'GET' && !historyMatch[2]) {
      const [versions, history] = await Promise.all([runtime.repository.listVersions(characterId), runtime.storage.lineage.events(url.searchParams.get('scope') === 'unassigned' ? null : characterId, { before: url.searchParams.get('before'), limit: 80 })]);
      sendJson(response, { versions, ...history, storage: { provider: runtime.storage.provider, remote: runtime.storage.provider !== 'file' && (runtime.storage.provider !== 'cached' || runtime.storage.writeThrough), retention: 'No automatic deletion' } });
      return;
    }
    if (request.method === 'POST') {
      const input = await readJsonBody(request);
      const action = historyMatch[2];
      const result = await runtime.repository.withMutation(characterId, () => runtime.storage.lineage.run({ characterId, stage: `history-${action}`, inputs: input }, async () => {
        if (action === 'checkpoint') return runtime.repository.createVersion(characterId, await runtime.repository.getDraft(characterId), { label: String(input.label ?? 'Manual checkpoint').slice(0, 160) });
        if (action === 'restore') return runtime.repository.restoreVersion(characterId, input.versionId);
        if (action === 'branch') return runtime.repository.branchArtifact(characterId, input.eventId);
        if (action === 'reprocess') return reprocessArchivedVideo({ ...input, repository: runtime.repository, storage: runtime.storage, characterId });
        if (action === 'resume') return resumeArchivedVideo({ storage: runtime.storage, characterId, eventId: input.eventId });
        throw new Error('Unknown history operation.');
      }));
      sendJson(response, { ok: true, result });
      return;
    }
  }

  // Runtime CharacterConfig for the single-player testbed. Runs the same
  // draft -> runtime transform that `cms:export` ships, so the testbed plays
  // exactly what the game will, with no schema drift.
  const runtimeConfigMatch = url.pathname.match(/^\/api\/characters\/([^/]+)\/runtime-config$/);
  if (request.method === 'GET' && runtimeConfigMatch) {
    const characterId = decodeURIComponent(runtimeConfigMatch[1]);
    const draft = await runtime.repository.getDraft(characterId);
    const keys = await runtime.repository.listCharacterAssets(characterId);
    const frameDataKey = draft.assets?.frameDataKey ?? keys.find((key) => key.endsWith('frameData.json'));
    const manifestKey = draft.assets?.manifestKey ?? keys.find((key) => key.endsWith('manifest.json'));
    const frameData = frameDataKey ? await runtime.storage.getJson(frameDataKey) : null;
    const manifest = manifestKey ? await runtime.storage.getJson(manifestKey) : null;
    const config = convertDraftToCharacterConfig({ draft, frameData, manifest });
    sendJson(response, { config, assetRoot: draft.assets?.rootKey ?? null });
    return;
  }

  const assetsMatch = url.pathname.match(/^\/api\/characters\/([^/]+)\/assets$/);
  if (request.method === 'GET' && assetsMatch) {
    const characterId = decodeURIComponent(assetsMatch[1]);
    const keys = await runtime.repository.listCharacterAssets(characterId);
    const assets = await Promise.all(keys.map((key) => assetRecordForKey({
      repository: runtime.repository,
      storage: runtime.storage,
      characterId,
      key,
    })));
    sendJson(response, { characterId, assets });
    return;
  }

  if (request.method === 'POST' && assetsMatch) {
    const characterId = decodeURIComponent(assetsMatch[1]);
    const input = await readJsonBody(request);
    const asset = await runtime.repository.withMutation(characterId, () => runtime.storage.lineage.run({ characterId, stage: 'upload-asset', inputs: input }, async () => {
      await runtime.repository.createVersion(characterId, await runtime.repository.getDraft(characterId), { label: 'Before asset upload' });
      const result = await writeCharacterAssetUpload({ repository: runtime.repository, storage: runtime.storage, characterId, input, source: 'admin-dashboard' });
      await runtime.repository.createVersion(characterId, await runtime.repository.getDraft(characterId), { label: 'After asset upload' });
      return result;
    }));
    sendJson(response, { ok: true, characterId, asset }, 201);
    return;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/api/assets/')) {
    const key = decodeURIComponent(url.pathname.slice('/api/assets/'.length));
    if (!key || key.startsWith('/') || key.split('/').includes('..')) {
      sendJson(response, { error: 'Invalid asset key' }, 400);
      return;
    }
    if (typeof runtime.storage.exists === 'function' && !(await runtime.storage.exists(key))) {
      sendJson(response, { error: `Asset not found: ${key}` }, 404);
      return;
    }
    const bytes = await runtime.storage.getBytes(key);
    const metadata = await runtime.storage.getMetadata(key);
    response.writeHead(200, {
      'content-type': metadata.contentType ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    response.end(bytes);
    return;
  }

  sendJson(response, { error: 'Not found' }, 404);
}

function invokeTrackedTool(runtime, toolName, input) {
  return runtime.tools.invoke(toolName, input);
}

async function chatAgentHealth(runtime) {
  const agent = runtime.chatAgent;
  if (!agent) {
    return {
      provider: 'none',
      id: 'none',
      status: 'unknown',
      message: 'No CMS chat agent is configured.',
      capabilities: [],
    };
  }

  if (typeof agent.healthCheck !== 'function') {
    return {
      provider: agent.provider ?? 'unknown',
      id: agent.id ?? 'cms-chat-agent',
      status: 'unknown',
      message: 'Chat agent does not expose a health check yet.',
      capabilities: agent.capabilities ?? [],
    };
  }

  try {
    const health = await agent.healthCheck();
    return {
      provider: agent.provider ?? 'unknown',
      id: agent.id ?? 'cms-chat-agent',
      capabilities: agent.capabilities ?? [],
      status: health.status ?? 'unknown',
      message: health.message ?? '',
      details: health.details ?? {},
    };
  } catch (error) {
    return {
      provider: agent.provider ?? 'unknown',
      id: agent.id ?? 'cms-chat-agent',
      capabilities: agent.capabilities ?? [],
      status: 'error',
      message: error.message ?? 'Chat agent health check failed.',
      details: {},
    };
  }
}

async function serveAdminAsset({ response, url, adminRoot }) {
  const embedded=url.pathname.startsWith('/cms-admin');
  const pathname = url.pathname.replace(/^\/(?:cms-admin|admin)/, '') || '/';
  const hasStudio=Boolean(process.env.GAME_BASE_URL)||['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(hasStudio && !embedded && !url.searchParams.has('standalone') && (pathname==='/'||pathname==='/roster'||pathname.startsWith('/roster/')||pathname==='/pipeline')){
    const destination=new URL('/animation-lab.html',process.env.GAME_BASE_URL??'http://127.0.0.1:5173');
    destination.searchParams.set('workspace',pathname==='/pipeline'?'pipeline':'characters');
    if(pathname.startsWith('/roster/'))destination.searchParams.set('character',pathname.slice('/roster/'.length));
    response.writeHead(302,{Location:destination.href});response.end();return;
  }

  // 1. Hard redirects
  if (pathname === '/') {
    response.writeHead(302, { Location: embedded?'/cms-admin/roster':'/roster?standalone=1' });
    response.end();
    return;
  }
  if (pathname === '/create') {
    response.writeHead(302, { Location: '/roster/new' });
    response.end();
    return;
  }

  // 2. SPA fallback: /roster, /roster/new, /roster/:id, /pipeline → serve index.html.
  // Creation is the same single-page app as editing — a new fighter is just a
  // roster page whose draft doesn't exist yet.
  if (pathname === '/roster' || pathname.startsWith('/roster/') || pathname === '/pipeline') {
    const absolutePath = path.resolve(adminRoot, 'index.html');
    response.writeHead(200, { 'content-type': contentTypeFor(absolutePath), 'cache-control': 'no-store' });
    const html = await readFile(absolutePath, 'utf8');
    response.end(embedded ? html.replace('href="/styles.css"', 'href="/cms-admin/styles.css"').replace('src="/app.js"', 'src="/cms-admin/app.js"') : html);
    return;
  }

  // 3. Static files (css, js, images, etc.)
  const relativePath = pathname.replace(/^\/+/, '');
  const absolutePath = path.resolve(adminRoot, relativePath);

  if (absolutePath !== adminRoot && !absolutePath.startsWith(`${adminRoot}${path.sep}`)) {
    sendJson(response, { error: 'Unsafe path' }, 400);
    return;
  }

  try {
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      sendJson(response, { error: 'Not found' }, 404);
      return;
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      sendJson(response, { error: 'Not found' }, 404);
      return;
    }
    throw error;
  }

  response.writeHead(200, {
    'content-type': contentTypeFor(absolutePath),
    'cache-control': 'no-store',
  });
  createReadStream(absolutePath).pipe(response);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const body = Buffer.concat(chunks).toString('utf8');
  return body.trim() ? JSON.parse(body) : {};
}

function sendJson(response, value, statusCode = 200) {
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}

function sendError(response, error) {
  const statusCode = error.statusCode ?? 500;
  sendJson(response, {
    error: error.message ?? 'Internal server error',
  }, statusCode);
}

function contentTypeFor(filePath) {
  switch (path.extname(filePath)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.json':
      return 'application/json';
    default:
      return 'application/octet-stream';
  }
}

export async function readAdminIndex() {
  return readFile(path.join(DEFAULT_ADMIN_ROOT, 'index.html'), 'utf8');
}
