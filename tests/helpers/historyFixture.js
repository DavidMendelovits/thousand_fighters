import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCmsStorage } from '../../cms/storage/createCmsStorage.js';
import { createLocalCmsRuntime } from '../../cms/runtime/createLocalCmsRuntime.js';
import { createCmsServer } from '../../cms/server/createCmsServer.js';

export async function historyFixture({ port = 0, useDavid = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tf-history-ui-'));
  const storage = createCmsStorage({ provider: 'file', rootDir: root });
  const runtime = createLocalCmsRuntime({ storage, chatAgent: { healthCheck: async () => ({ status: 'ok', provider: 'fixture' }) } });
  // Tests never invoke a model. Avoid provider health/network calls as well.
  runtime.registry.health = async () => [];
  const characterId = 'history_probe', pack = `characters/${characterId}/assets/fighter-pack`;
  let draft = { id: characterId, displayName: 'History QA fighter', description: 'Isolated history verification fixture', stats: { maxHealth: 1000 }, assets: { rootKey: pack, frameDataKey: `${pack}/frameData.json`, manifestKey: `${pack}/manifest.json` }, moves: [], sprite: { frameCounts: { base: 1 }, frames: { base: [{ file: 'sprites/base/base_001.png', width: 1, height: 1, anchor: { x: 0, y: 1 } }] } } };
  if (useDavid) {
    const original = createCmsStorage({ provider: 'file' });
    const sourceDraft = await original.getJson('characters/david/draft/content.json');
    const sourceRoot = sourceDraft.assets.rootKey;
    draft = JSON.parse(JSON.stringify(sourceDraft).replaceAll(sourceRoot, pack));
    draft.id = characterId; draft.displayName = 'History QA fighter';
    for (const key of await original.list(sourceRoot)) await storage.putBytes(pack + key.slice(sourceRoot.length), await original.getBytes(key), await original.getMetadata(key));
    const video = await storage.lineage.artifact(await readFile('generated/david-watercolor/pruna-walk-endlock-v1/source.mp4'), { contentType: 'video/mp4' });
    await storage.lineage.event(characterId, { type: 'legacy-import', stage: 'QA source video', moveId: 'walk_forward', logicalKey: 'walk_forward/source.mp4', artifact: video });
  } else {
    await storage.putBytes(`${pack}/sprites/base/base_001.png`, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHWQAAAAASUVORK5CYII=', 'base64'), { contentType: 'image/png' });
    await storage.putJson(`${pack}/manifest.json`, { sprites: { base: ['sprites/base/base_001.png'] }, sheets: {}, frameCounts: { base: 1 } });
    await storage.putJson(`${pack}/frameData.json`, { frames: draft.sprite.frames });
  }
  await runtime.repository.saveDraft(characterId, draft);
  const server = createCmsServer({ runtime });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { root, runtime, characterId, pack, url: `http://127.0.0.1:${server.address().port}`, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await Promise.allSettled([...runtime.repository.mutations.values()]); await rm(root, { recursive: true, force: true, maxRetries:5, retryDelay:100 }); } };
}
