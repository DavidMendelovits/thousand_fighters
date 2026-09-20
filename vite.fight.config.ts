import { defineConfig } from 'vite';
import { cleanRoutes } from './vite.cleanRoutes';

// Independently deployable fight client. No CMS routes, proxy or workbench.
export default defineConfig({
  plugins: [cleanRoutes()],
  publicDir: false,
  server: {
    host: '0.0.0.0',
    port: 5174,
    allowedHosts: ['macbook-pro-4', 'macbook-pro-4.tail08f993.ts.net'],
  },
  build: { outDir: 'dist-fight', rollupOptions: { input: 'fight.html' } },
});
