import { defineConfig } from 'vite';

// Independently deployable fight client. No CMS routes, proxy or workbench.
export default defineConfig({
  publicDir: false,
  server: { host: '0.0.0.0', port: 5174 },
  build: { outDir: 'dist-fight', rollupOptions: { input: 'fight.html' } },
});
