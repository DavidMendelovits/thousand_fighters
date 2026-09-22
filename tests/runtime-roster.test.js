import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileCmsStorage } from '../cms/storage/FileCmsStorage.js';
import { CharacterContentRepository } from '../cms/repositories/CharacterContentRepository.js';
import { syncRuntimeRoster } from '../cms/export/syncRuntimeRoster.js';
import { updateWorkbench } from '../cms/authoring/workbenchLibrary.js';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'runtime-roster-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const publicDir = path.join(root, 'public');
  const repository = new CharacterContentRepository(new FileCmsStorage({ rootDir: path.join(root, 'cms') }));
  const writeConfig = async (id, extra = {}) => {
    const directory = path.join(publicDir, 'fighters', id);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'config.json'), `${JSON.stringify({ id, displayName: id, moves: [], ...extra })}\n`);
  };
  await repository.saveDraft('active', { displayName: 'Active', moves: [] });
  await repository.saveDraft('archived', { displayName: 'Archived', moves: [], workbench: { archived: true } });
  await repository.saveDraft('hidden_form', { displayName: 'Hidden form', moves: [], parentId: 'active' });
  await repository.saveDraft('unpublished', { displayName: 'Unpublished', moves: [] });
  await writeConfig('active');
  await writeConfig('archived');
  await writeConfig('hidden_form');
  return { publicDir, repository, writeConfig };
}

test('runtime roster is stable, versioned, and includes only active published top-level fighters', async t => {
  const { publicDir, repository, writeConfig } = await fixture(t);
  const first = await syncRuntimeRoster({ repository, publicDir });
  assert.equal(first.changed, true);
  assert.deepEqual(first.manifest.fighters.map(fighter => fighter.id), ['active']);
  assert.match(first.manifest.version, /^[a-f0-9]{64}$/);
  assert.match(first.manifest.fighters[0].configVersion, /^[a-f0-9]{64}$/);
  const bytes = await readFile(path.join(publicDir, 'runtime-roster.json'), 'utf8');

  const unchanged = await syncRuntimeRoster({ repository, publicDir });
  assert.equal(unchanged.changed, false);
  assert.equal(await readFile(path.join(publicDir, 'runtime-roster.json'), 'utf8'), bytes);

  const sync = () => syncRuntimeRoster({ repository, publicDir });
  await updateWorkbench(repository, 'archived', { archived: false }, { syncRuntimeRoster: sync });
  const restored = JSON.parse(await readFile(path.join(publicDir, 'runtime-roster.json'), 'utf8'));
  assert.deepEqual(restored.fighters.map(fighter => fighter.id), ['active', 'archived']);
  assert.notEqual(restored.version, first.manifest.version);

  const oldConfigVersion = restored.fighters.find(fighter => fighter.id === 'active').configVersion;
  await writeConfig('active', { speed: 2 });
  const changed = await sync();
  assert.notEqual(changed.manifest.fighters.find(fighter => fighter.id === 'active').configVersion, oldConfigVersion);
  assert.notEqual(changed.manifest.version, restored.version);
});

test('archive is rolled back when the playable manifest cannot be published', async t => {
  const { repository } = await fixture(t);
  await assert.rejects(
    updateWorkbench(repository, 'active', { archived: true }, { syncRuntimeRoster: async () => { throw new Error('disk unavailable'); } }),
    /disk unavailable/,
  );
  assert.notEqual((await repository.getDraft('active')).workbench?.archived, true);
});
