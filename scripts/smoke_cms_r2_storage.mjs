import assert from 'node:assert/strict';
import { CharacterContentRepository } from '../cms/repositories/CharacterContentRepository.js';
import { R2CmsStorage } from '../cms/storage/R2CmsStorage.js';

class FakeR2Client {
  constructor() {
    this.objects = new Map();
  }

  async send(command) {
    const name = command.constructor.name;
    const input = command.input;

    if (name === 'HeadBucketCommand') return {};

    if (name === 'PutObjectCommand') {
      this.objects.set(input.Key, {
        body: Buffer.from(input.Body),
        contentType: input.ContentType,
      });
      return {};
    }

    if (name === 'GetObjectCommand') {
      const object = this.objects.get(input.Key);
      if (!object) throw notFoundError();
      return { Body: object.body };
    }

    if (name === 'HeadObjectCommand') {
      if (!this.objects.has(input.Key)) throw notFoundError();
      return {};
    }

    if (name === 'ListObjectsV2Command') {
      return {
        Contents: [...this.objects.keys()]
          .filter((key) => !input.Prefix || key.startsWith(input.Prefix))
          .sort()
          .map((Key) => ({ Key })),
      };
    }

    if (name === 'DeleteObjectCommand') {
      this.objects.delete(input.Key);
      return {};
    }

    throw new Error(`Unsupported fake R2 command: ${name}`);
  }
}

function notFoundError() {
  const error = new Error('Not found');
  error.name = 'NotFound';
  error.$metadata = { httpStatusCode: 404 };
  return error;
}

const client = new FakeR2Client();
const storage = new R2CmsStorage({
  accountId: 'test-account',
  accessKeyId: 'test-key',
  secretAccessKey: 'test-secret',
  bucket: 'test-bucket',
  publicBaseUrl: 'https://assets.example.test',
  client,
});
const repository = new CharacterContentRepository(storage, {
  clock: () => new Date('2026-05-17T12:00:00.000Z'),
});

await storage.healthCheck();

const draft = await repository.saveDraft('r2_test_fighter', {
  displayName: 'R2 Test Fighter',
  stats: {
    maxHealth: 1000,
  },
  moves: [],
});
assert.equal(draft.id, 'r2_test_fighter');

const asset = await repository.writeAsset('r2_test_fighter', 'sprites/base/base_001.png', Buffer.from('fake png bytes'), {
  contentType: 'image/png',
});
assert.equal(asset.key, 'characters/r2_test_fighter/assets/sprites/base/base_001.png');
assert.equal(asset.url, 'https://assets.example.test/characters/r2_test_fighter/assets/sprites/base/base_001.png');
assert.equal(await storage.exists(asset.key), true);
assert.equal((await storage.getMetadata(asset.key)).contentType, 'image/png');
assert.equal((await storage.getBytes(asset.key)).toString('utf8'), 'fake png bytes');

const keys = await storage.list('characters/r2_test_fighter');
assert.deepEqual(keys, [
  'characters/r2_test_fighter/assets/sprites/base/base_001.png',
  'characters/r2_test_fighter/draft/content.json',
]);

await storage.delete(asset.key);
assert.equal(await storage.exists(asset.key), false);

console.log('R2 CMS storage smoke test passed.');
