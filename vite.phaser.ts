import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import type { Plugin } from 'vite';

export const phaserAlias = { find: /^phaser$/, replacement: fileURLToPath(new URL('./src/runtime/phaser-core.js', import.meta.url)) };

// Phaser source uses webpack's unusual `typeof FEATURE` replacements. Replacing
// FEATURE with false is insufficient: typeof false is the truthy string boolean.
export function phaserFeatures(): Plugin {
  const enabled = new Set(['CANVAS_RENDERER', 'WEBGL_RENDERER', 'FEATURE_SOUND']);
  return {
    name: 'phaser-core-features', enforce: 'pre',
    transform(code, id) {
      if (!id.includes('/node_modules/phaser/src/')) return;
      return code.replace(/typeof (CANVAS_RENDERER|WEBGL_RENDERER|WEBGL_DEBUG|EXPERIMENTAL|PLUGIN_3D|PLUGIN_CAMERA3D|PLUGIN_FBINSTANT|FEATURE_SOUND)\b/g,
        (_, feature) => String(enabled.has(feature)))
        .replace(/\bglobal\.Phaser\b/g, 'globalThis.Phaser')
        .replace(/\bif \(DEBUG\)/g, 'if (false)');
    },
  };
}

export function phaserBudget(): Plugin {
  return {
    name: 'phaser-runtime-budget',
    generateBundle(_, bundle) {
      const engines = Object.values(bundle).filter(item => item.type === 'chunk'
        && Object.keys(item.modules).some(id => id.includes('/node_modules/phaser/')));
      if (!engines.length) this.error('No Phaser engine chunk found; cannot enforce runtime budget.');
      if (!engines.some(item => item.type === 'chunk' && Object.keys(item.modules).some(id => id.endsWith('/phaser/src/phaser-core.js')))) {
        this.error('Expected Phaser core source entry; a full or prebundled engine bypasses physics auditing.');
      }
      const chunks = engines.map(item => {
        if (item.type !== 'chunk') throw new Error('Expected engine chunk');
        const physics = Object.keys(item.modules).filter(id => /\/phaser\/src\/physics\/(arcade|matter(?:-js)?)\//.test(id));
        if (physics.length) this.error(`Unused Phaser physics included: ${physics.slice(0, 3).join(', ')}`);
        return { file: item.fileName, bytes: Buffer.byteLength(item.code), gzipBytes: gzipSync(item.code).length };
      });
      const gzipBytes = chunks.reduce((total, chunk) => total + chunk.gzipBytes, 0);
      if (gzipBytes > 250_000) this.error(`Phaser budget exceeded: ${gzipBytes} gzip bytes > 250000`);
      this.emitFile({ type: 'asset', fileName: 'runtime-bundle-report.json', source: JSON.stringify({
        budgetGzipBytes: 250_000, gzipBytes, physicsModules: 0, chunks,
      }, null, 2) });
    },
  };
}
