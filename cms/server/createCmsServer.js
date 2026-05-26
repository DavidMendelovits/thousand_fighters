import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetRecordForKey, writeCharacterAssetUpload } from '../assets/uploadCharacterAsset.js';
import { createLocalCmsRuntime } from '../runtime/createLocalCmsRuntime.js';

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
      const result = await runtime.tools.invoke(toolName, input);
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
    const result = await runtime.tools.invoke(toolName, input);
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
    sendJson(response, { characters: await runtime.repository.listCharacters() });
    return;
  }

  const draftMatch = url.pathname.match(/^\/api\/characters\/([^/]+)\/draft$/);
  if (request.method === 'GET' && draftMatch) {
    sendJson(response, { draft: await runtime.repository.getDraft(decodeURIComponent(draftMatch[1])) });
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
    const asset = await writeCharacterAssetUpload({
      repository: runtime.repository,
      storage: runtime.storage,
      characterId,
      input: await readJsonBody(request),
      source: 'admin-dashboard',
    });
    sendJson(response, { ok: true, characterId, asset }, 201);
    return;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/api/assets/')) {
    const key = decodeURIComponent(url.pathname.slice('/api/assets/'.length));
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
  const pathname = url.pathname.replace(/^\/admin/, '') || '/';

  // 1. Hard redirects
  if (pathname === '/') {
    response.writeHead(302, { Location: '/roster' });
    response.end();
    return;
  }
  if (pathname === '/create') {
    response.writeHead(302, { Location: '/roster/new' });
    response.end();
    return;
  }

  // 2. Creation wizard: /roster/new → serve create.html
  if (pathname === '/roster/new') {
    const absolutePath = path.resolve(adminRoot, 'create.html');
    response.writeHead(200, { 'content-type': contentTypeFor(absolutePath), 'cache-control': 'no-store' });
    createReadStream(absolutePath).pipe(response);
    return;
  }

  // 3. SPA fallback: /roster, /roster/:id, /pipeline → serve index.html
  if (pathname === '/roster' || pathname.startsWith('/roster/') || pathname === '/pipeline') {
    const absolutePath = path.resolve(adminRoot, 'index.html');
    response.writeHead(200, { 'content-type': contentTypeFor(absolutePath), 'cache-control': 'no-store' });
    createReadStream(absolutePath).pipe(response);
    return;
  }

  // 4. Static files (css, js, images, etc.)
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
