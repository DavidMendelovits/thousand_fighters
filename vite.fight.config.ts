import { defineConfig } from 'vite';
import { cleanRoutes } from './vite.cleanRoutes';
import { phaserAlias, phaserFeatures, phaserBudget } from './vite.phaser';

// Independently deployable fight client. No CMS routes, proxy or workbench.
export default defineConfig({
  plugins: [cleanRoutes(), phaserFeatures(), phaserBudget()],
  resolve: { alias: [phaserAlias] },
  optimizeDeps: { rolldownOptions: { plugins: [phaserFeatures()] } },
  publicDir: false,
  server: {
    host: '0.0.0.0',
    port: 5174,
    allowedHosts: ['macbook-pro-4', 'macbook-pro-4.tail08f993.ts.net'],
  },
  build: { outDir: 'dist-fight', rollupOptions: { input: 'fight.html' } },
});
