import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTestbedConfig } from '../src/testbed/runtimeConfig';

test('draft testbed loads the exact versioned projectile sprite, never an older filename match', async () => {
  const previousFetch = globalThis.fetch;
  const oldKey = 'characters/eventide/assets/source/eventide_bead_projectile.png';
  const currentKey = 'characters/eventide/assets/revisions/new/source/eventide_bead_projectile_abc123.png';
  const config = {
    id: 'eventide', sprite: { basePath: '/fighters/eventide', frameCounts: { base: 1 }, frames: { base: [{ file: 'sprites/base/base_001.png' }] } },
    moves: [{ id: 'bead', phases: [{ events: [{ onFrame: 0, event: { type: 'spawn_projectile', projectile: { animation: 'eventide_bead' } } }] }] }],
  };
  try {
    globalThis.fetch = async input => {
      const url = String(input);
      const value = url.includes('runtime-config')
        ? { config, assetRoot: 'characters/eventide/assets/revisions/new/fighter-pack', projectileSourceKeys: { eventide_bead: currentKey } }
        : { assets: [
          { key: oldKey, relativePath: 'source/eventide_bead_projectile.png', apiUrl: '/old-opaque.png' },
          { key: currentKey, relativePath: 'revisions/new/source/eventide_bead_projectile_abc123.png', apiUrl: '/new-transparent.png' },
          { key: 'characters/eventide/assets/revisions/new/fighter-pack/sprites/base/base_001.png', relativePath: 'revisions/new/fighter-pack/sprites/base/base_001.png', apiUrl: '/base.png' },
        ] };
      return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const loaded = await loadTestbedConfig('eventide');
    assert.equal(loaded.projectileUrls.eventide_bead, '/new-transparent.png');
    assert.ok(!loaded.warnings.some(warning => warning.includes('projectile "eventide_bead"')));
  } finally { globalThis.fetch = previousFetch; }
});
