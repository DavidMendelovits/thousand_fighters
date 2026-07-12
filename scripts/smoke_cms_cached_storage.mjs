import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CharacterContentRepository } from '../cms/repositories/CharacterContentRepository.js';
import { CachedCmsStorage } from '../cms/storage/CachedCmsStorage.js';
import { FileCmsStorage } from '../cms/storage/FileCmsStorage.js';
import { createCmsStorage } from '../cms/storage/createCmsStorage.js';

const rootDir = await mkdtemp(path.join(os.tmpdir(), 'thousand-fighters-cached-cms-'));
const remoteRoot = path.join(rootDir, 'remote');
const cacheRoot = path.join(rootDir, 'cache');

try {
  const remote = new FileCmsStorage({ rootDir: remoteRoot });
  const cache = new FileCmsStorage({ rootDir: cacheRoot });
  const storage = new CachedCmsStorage({ cache, remote });
  const repository = new CharacterContentRepository(storage, {
    clock: () => new Date('2026-05-17T12:00:00.000Z'),
  });

  await storage.healthCheck();

  await repository.saveDraft('cached_fighter', {
    displayName: 'Cached Fighter',
    stats: { maxHealth: 1000 },
    moves: [],
  });

  const asset = await repository.writeAsset('cached_fighter', 'sprites/base/base_001.png', Buffer.from('remote bytes'), {
    contentType: 'image/png',
  });
  assert.equal(await remote.exists(asset.key), true);
  assert.equal(await cache.exists(asset.key), true);

  await cache.delete(asset.key);
  assert.equal(await cache.exists(asset.key), false);
  assert.equal((await storage.getBytes(asset.key)).toString('utf8'), 'remote bytes');
  assert.equal(await cache.exists(asset.key), true);
  assert.equal((await storage.getMetadata(asset.key)).contentType, 'image/png');

  await cache.delete(asset.key);
  const syncResult = await storage.syncPrefix('characters/cached_fighter');
  assert.ok(syncResult.copied > 0);
  assert.equal(await cache.exists(asset.key), true);

  const keys = await storage.list('characters/cached_fighter');
  assert.ok(keys.includes('characters/cached_fighter/assets/sprites/base/base_001.png'));

  const factoryCacheRoot = path.join(rootDir, 'factory-cache');
  const factoryStorage = createCmsStorage({
    provider: 'cached',
    remoteProvider: 'file',
    remoteOptions: {
      rootDir: remoteRoot,
    },
    cacheRootDir: factoryCacheRoot,
  });
  assert.equal(factoryStorage.provider, 'cached');
  assert.equal((await factoryStorage.getBytes(asset.key)).toString('utf8'), 'remote bytes');
  const factoryCache = new FileCmsStorage({ rootDir: factoryCacheRoot });
  assert.equal(await factoryCache.exists(asset.key), true);

  console.log(`Cached CMS storage smoke test passed: ${rootDir}`);
} finally {
  await rm(rootDir, { force: true, recursive: true });
}
