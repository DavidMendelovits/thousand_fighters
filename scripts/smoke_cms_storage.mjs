import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CharacterContentRepository } from '../cms/repositories/CharacterContentRepository.js';
import { FileCmsStorage } from '../cms/storage/FileCmsStorage.js';

const rootDir = await mkdtemp(path.join(os.tmpdir(), 'thousand-fighters-cms-'));

try {
  const storage = new FileCmsStorage({ rootDir });
  const repository = new CharacterContentRepository(storage, {
    clock: () => new Date('2026-05-17T12:00:00.000Z'),
  });

  const draft = await repository.saveDraft('test_fighter', {
    displayName: 'Test Fighter',
    stats: {
      walkForwardSpeed: 3,
      walkBackSpeed: 2,
      maxHealth: 1000,
    },
    sprite: {
      basePath: '/fighters/test_fighter',
      frameCounts: { base: 6 },
    },
    moves: [],
  });

  assert.equal(draft.id, 'test_fighter');
  assert.equal(draft.lifecycle, 'draft');
  assert.equal(draft.updatedAt, '2026-05-17T12:00:00.000Z');

  const loadedDraft = await repository.getDraft('test_fighter');
  assert.equal(loadedDraft.displayName, 'Test Fighter');

  const version = await repository.createVersion('test_fighter', loadedDraft, {
    versionId: 'v1',
  });
  assert.equal(version.versionId, 'v1');

  const asset = await repository.writeAsset('test_fighter', 'sprites/base/base_001.png', Buffer.from('fake png bytes'), {
    contentType: 'image/png',
  });
  assert.equal(asset.key, 'characters/test_fighter/assets/sprites/base/base_001.png');
  assert.equal(await storage.exists(asset.key), true);

  const qaReport = await repository.writeQaReport('test_fighter', 'run-001', {
    status: 'pass',
    checks: [],
  });
  assert.equal(qaReport.key, 'characters/test_fighter/qa/run-001/report.json');

  const index = await repository.listCharacters();
  assert.deepEqual(index.map((character) => character.id), ['test_fighter']);

  const keys = await storage.list('characters/test_fighter');
  assert.deepEqual(keys, [
    'characters/test_fighter/assets/sprites/base/base_001.png',
    'characters/test_fighter/draft/content.json',
    'characters/test_fighter/qa/run-001/report.json',
    'characters/test_fighter/versions/v1/content.json',
  ]);

  console.log(`CMS storage smoke test passed: ${rootDir}`);
} finally {
  await rm(rootDir, { force: true, recursive: true });
}
