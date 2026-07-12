import assert from 'node:assert/strict';
import { CharacterContentRepository } from '../cms/repositories/CharacterContentRepository.js';
import { SupabaseCmsStorage } from '../cms/storage/SupabaseCmsStorage.js';

class FakeSupabaseStorageClient {
  constructor() {
    this.buckets = new Set();
    this.objects = new Map();
  }

  get storage() {
    return {
      getBucket: async (bucket) => {
        if (!this.buckets.has(bucket)) return { data: null, error: notFoundError('Bucket not found') };
        return { data: { name: bucket }, error: null };
      },
      createBucket: async (bucket) => {
        this.buckets.add(bucket);
        return { data: { name: bucket }, error: null };
      },
      from: (bucket) => this.bucketClient(bucket),
    };
  }

  bucketClient(bucket) {
    return {
      upload: async (key, body, options = {}) => {
        this.buckets.add(bucket);
        this.objects.set(`${bucket}/${key}`, {
          body: Buffer.from(body),
          contentType: options.contentType,
        });
        return { data: { path: key }, error: null };
      },
      download: async (key) => {
        const object = this.objects.get(`${bucket}/${key}`);
        if (!object) return { data: null, error: notFoundError('Object not found') };
        return { data: new Blob([object.body], { type: object.contentType }), error: null };
      },
      list: async (prefix = '', options = {}) => {
        const normalizedPrefix = prefix ? `${prefix.replace(/\/$/, '')}/` : '';
        const children = new Map();
        for (const objectKey of this.objects.keys()) {
          if (!objectKey.startsWith(`${bucket}/${normalizedPrefix}`)) continue;
          const relativeKey = objectKey.slice(`${bucket}/${normalizedPrefix}`.length);
          if (!relativeKey) continue;
          const [name, ...rest] = relativeKey.split('/');
          if (rest.length === 0) {
            children.set(name, {
              id: objectKey,
              name,
              metadata: {},
              updated_at: new Date('2026-05-17T12:00:00.000Z').toISOString(),
            });
          } else if (!children.has(name)) {
            children.set(name, {
              id: null,
              name,
              metadata: null,
            });
          }
        }
        const allEntries = [...children.values()].sort((left, right) => left.name.localeCompare(right.name));
        const offset = options.offset ?? 0;
        const limit = options.limit ?? allEntries.length;
        return { data: allEntries.slice(offset, offset + limit), error: null };
      },
      remove: async (keys) => {
        for (const key of keys) {
          this.objects.delete(`${bucket}/${key}`);
        }
        return { data: keys.map((name) => ({ name })), error: null };
      },
    };
  }
}

function notFoundError(message) {
  const error = new Error(message);
  error.statusCode = '404';
  return error;
}

const client = new FakeSupabaseStorageClient();
const storage = new SupabaseCmsStorage({
  url: 'https://example.supabase.co',
  serviceRoleKey: 'test-service-role-key',
  bucket: 'test-bucket',
  publicBaseUrl: 'https://assets.example.test/storage',
  client,
});
const repository = new CharacterContentRepository(storage, {
  clock: () => new Date('2026-05-17T12:00:00.000Z'),
});

await storage.healthCheck();

const draft = await repository.saveDraft('supabase_test_fighter', {
  displayName: 'Supabase Test Fighter',
  stats: {
    maxHealth: 1000,
  },
  moves: [],
});
assert.equal(draft.id, 'supabase_test_fighter');

const asset = await repository.writeAsset('supabase_test_fighter', 'sprites/base/base_001.png', Buffer.from('fake png bytes'), {
  contentType: 'image/png',
});
assert.equal(asset.key, 'characters/supabase_test_fighter/assets/sprites/base/base_001.png');
assert.equal(asset.url, 'https://assets.example.test/storage/characters/supabase_test_fighter/assets/sprites/base/base_001.png');
assert.equal(await storage.exists(asset.key), true);
assert.equal((await storage.getMetadata(asset.key)).contentType, 'image/png');
assert.equal((await storage.getBytes(asset.key)).toString('utf8'), 'fake png bytes');

const keys = await storage.list('characters/supabase_test_fighter');
assert.deepEqual(keys, [
  'characters/supabase_test_fighter/assets/sprites/base/base_001.png',
  'characters/supabase_test_fighter/draft/content.json',
]);

await storage.delete(asset.key);
assert.equal(await storage.exists(asset.key), false);

console.log('Supabase CMS storage smoke test passed.');
