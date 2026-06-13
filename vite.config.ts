import { defineConfig } from 'vite';

// The CMS admin server (npm run cms:admin) owns character drafts + assets.
// Proxy /api to it so the testbed page can read a character same-origin
// (no CORS) while the game engine itself keeps loading from /public.
const CMS_ADMIN_TARGET = process.env.CMS_ADMIN_URL ?? 'http://127.0.0.1:8787';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: CMS_ADMIN_TARGET,
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        testbed: 'testbed.html',
      },
    },
  },
});
