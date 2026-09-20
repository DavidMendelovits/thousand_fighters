import { defineConfig } from 'vite';
import { cleanRoutes } from './vite.cleanRoutes';

// The CMS admin server (npm run cms:admin) owns character drafts + assets.
// Proxy /api to it so the testbed page can read a character same-origin
// (no CORS) while the game engine itself keeps loading from /public.
const CMS_ADMIN_TARGET = process.env.CMS_ADMIN_URL ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [cleanRoutes()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    allowedHosts: ['macbook-pro-4', 'macbook-pro-4.tail08f993.ts.net'],
    proxy: {
      '/cms-admin': { target: CMS_ADMIN_TARGET, changeOrigin: true },
      '/styles.css': { target: CMS_ADMIN_TARGET, changeOrigin: true },
      '/app.js': { target: CMS_ADMIN_TARGET, changeOrigin: true },
      '/moveInspector.js': { target: CMS_ADMIN_TARGET, changeOrigin: true },
      '/characterHistory.js': { target: CMS_ADMIN_TARGET, changeOrigin: true },
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
        fight: 'fight.html',
        testbed: 'testbed.html',
        gym: 'gym.html',
        animationLab: 'animation-lab.html',
        roster: 'roster.html',
      },
    },
  },
});
