import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { tsImport } from 'tsx/esm/api';

const { phaserBudget, phaserFeatures } = await tsImport('../vite.phaser.ts', import.meta.url);
const core = '/repo/node_modules/phaser/src/phaser-core.js';
function audit(modules = [core], code = 'export const core = true;') {
  const reports = [];
  phaserBudget().generateBundle.call({ error: message => { throw new Error(message); }, emitFile: item => reports.push(JSON.parse(item.source)) }, {}, {
    'engine.js': { type: 'chunk', fileName: 'engine.js', modules: Object.fromEntries(modules.map(id => [id, {}])), code },
  });
  return reports[0];
}
test('runtime budget rejects physics, full prebundles, missing engines and oversized code', () => {
  assert.equal(audit().physicsModules, 0);
  assert.throws(() => audit([core, '/repo/node_modules/phaser/src/physics/matter-js/index.js']), /physics/i);
  assert.throws(() => audit([core, '/repo/node_modules/phaser/src/physics/arcade/index.js']), /physics/i);
  assert.throws(() => audit(['/repo/node_modules/phaser/dist/phaser.js']), /core source/);
  assert.throws(() => audit([]), /No Phaser/);
  assert.throws(() => audit([core], randomBytes(300_000).toString('base64')), /budget exceeded/);
});
test('Phaser webpack feature guards are booleans, preserving sound and both renderers', () => {
  const input = 'typeof CANVAS_RENDERER;typeof WEBGL_RENDERER;typeof FEATURE_SOUND;typeof PLUGIN_CAMERA3D;typeof WEBGL_DEBUG;global.Phaser';
  assert.equal(phaserFeatures().transform(input, core), 'true;true;true;false;false;globalThis.Phaser');
  assert.equal(phaserFeatures().transform(input, '/repo/src/app.js'), undefined);
});
