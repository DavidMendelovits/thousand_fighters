import { createCmsServer } from '../cms/server/createCmsServer.js';

const server = createCmsServer();

export const config = {
  api: {
    bodyParser: false,
  },
};

export default function handler(request, response) {
  restoreRewrittenApiPath(request);
  server.emit('request', request, response);
}

function restoreRewrittenApiPath(request) {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
  if (url.pathname !== '/api/cms') return;

  const pathValue = request.query?.path ?? url.searchParams.get('path');
  if (!pathValue) return;

  const restoredPath = Array.isArray(pathValue) ? pathValue.join('/') : pathValue;
  url.pathname = `/api/${restoredPath.replace(/^\/+/, '')}`;
  url.searchParams.delete('path');
  request.url = `${url.pathname}${url.search}`;
}
