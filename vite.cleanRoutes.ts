import type { Plugin } from 'vite';

const routeFiles = new Map([
  ['/fight', '/fight.html'],
  ['/testbed', '/testbed.html'],
  ['/gym', '/gym.html'],
  ['/animation-lab', '/animation-lab.html'],
  ['/workbench', '/animation-lab.html'],
  ['/artifacts/studio-audit', '/artifacts/studio-audit/index.html'],
  ['/roster', '/roster.html'],
]);

function rewriteCleanRoute(requestUrl: string | undefined): string | undefined {
  if (!requestUrl) return requestUrl;
  const url = new URL(requestUrl, 'http://vite.local');
  const file = routeFiles.get(url.pathname.replace(/\/$/, ''));
  return file ? `${file}${url.search}` : requestUrl;
}

export function cleanRoutes(): Plugin {
  const install = (middlewares: { use(handler: (request: { url?: string }, response: unknown, next: () => void): void): void }) => {
    middlewares.use((request, _response, next) => {
      request.url = rewriteCleanRoute(request.url);
      next();
    });
  };

  return {
    name: 'thousand-fighters-clean-routes',
    configureServer(server) { install(server.middlewares); },
    configurePreviewServer(server) { install(server.middlewares); },
  };
}
