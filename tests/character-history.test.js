import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileCmsStorage } from '../cms/storage/FileCmsStorage.js';
import { withLineage, safeProvenance } from '../cms/storage/LineageStore.js';
import { CharacterContentRepository } from '../cms/repositories/CharacterContentRepository.js';
import { compareVersions } from '../cms/repositories/characterHistory.js';
import { runVideoJob } from '../scripts/generate_animation_video.mjs';
import { resumeArchivedVideo } from '../cms/pipeline/resumeArchivedVideo.js';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tf-history-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const raw = new FileCmsStorage({ rootDir: root }), storage = withLineage(raw), repository = new CharacterContentRepository(storage);
  const pack = 'characters/tester/assets/fighter-pack';
  const draft = { id: 'tester', displayName: 'Tester', assets: { rootKey: pack, frameDataKey: `${pack}/frameData.json`, manifestKey: `${pack}/manifest.json` }, moves: [], sprite: { frames: {} } };
  await storage.putJson(`${pack}/manifest.json`, { sprites: { idle: ['sprites/idle/idle_001.png'] }, sheets: {} });
  await storage.putJson(`${pack}/frameData.json`, { frames: {} });
  await storage.putBytes(`${pack}/sprites/idle/idle_001.png`, Buffer.from('original-image'), { contentType: 'image/png' });
  await repository.saveDraft('tester', draft);
  return { raw, storage, repository, draft, pack };
}

test('a version pins asset bytes and restores an isolated working copy after replacement', async t => {
  const { storage, repository, draft, pack } = await fixture(t);
  const version = await repository.createVersion('tester', draft, { label: 'Original' });
  await storage.putBytes(`${pack}/sprites/idle/idle_001.png`, Buffer.from('new-image'));
  await repository.saveDraft('tester', { ...draft, displayName: 'Changed' });
  assert.equal((await storage.getBytes(`${version.assets.rootKey}/sprites/idle/idle_001.png`)).toString(), 'original-image');
  const restored = await repository.restoreVersion('tester', version.versionId);
  assert.equal(restored.displayName, 'Tester');
  assert.match(restored.assets.rootKey, /assets\/revisions\//);
  assert.equal((await storage.getBytes(`${restored.assets.rootKey}/sprites/idle/idle_001.png`)).toString(), 'original-image');
  assert.equal((await storage.getBytes(`${pack}/sprites/idle/idle_001.png`)).toString(), 'new-image');
  assert.ok(restored.history.safetyVersionId);
  const newSource = await repository.writeAsset('tester', 'source/next.png', Buffer.from('next-source'));
  assert.ok(newSource.key.startsWith(`${restored.history.workingRoot}/`));
  const second = await repository.createVersion('tester', restored, { label: 'Restored checkpoint' });
  assert.equal(second.history.assetCount, version.history.assetCount + 1);
  await storage.putBytes(`${restored.assets.rootKey}/sprites/idle/idle_001.png`, Buffer.from('third-image'));
  assert.equal((await storage.getBytes(`${second.assets.rootKey}/sprites/idle/idle_001.png`)).toString(), 'original-image');
});

test('archive records contain before and after bytes and duplicates deduplicate', async t => {
  const { storage, pack } = await fixture(t);
  const key = `${pack}/sprites/idle/idle_001.png`;
  await storage.putBytes(key, Buffer.from('next'));
  const event = (await storage.lineage.events('tester')).events.find(e => e.logicalKey === key && e.previousArtifact);
  assert.equal((await storage.lineage.readArtifact(event.previousArtifact)).toString(), 'original-image');
  assert.equal((await storage.lineage.readArtifact(event.artifact)).toString(), 'next');
  assert.deepEqual(await storage.lineage.artifact(Buffer.from('next')), { ...event.artifact, contentType: 'application/octet-stream' });
});

test('atomic immutable write allows exactly one concurrent creator', async t => {
  const { storage } = await fixture(t);
  const results = await Promise.allSettled([storage.putBytes('lineage/test/fixed', Buffer.from('one')), storage.putBytes('lineage/test/fixed', Buffer.from('two'))]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  await assert.rejects(storage.putBytes('lineage/test/fixed', Buffer.from('three')));
  assert.throws(() => storage.delete('lineage/test/fixed'), /cannot be deleted/);
});

test('corrupted archive stops restore and leaves current draft untouched', async t => {
  const { raw, storage, repository, draft } = await fixture(t);
  const version = await repository.createVersion('tester', draft);
  const manifest = await storage.getJson(version.history.manifestKey);
  const before = await repository.getDraft('tester');
  await raw.putBytes(manifest.assets[0].artifact.key, Buffer.from('corrupt'));
  await assert.rejects(repository.restoreVersion('tester', version.versionId), /integrity check failed/);
  assert.deepEqual(await repository.getDraft('tester'), before);
  assert.equal((await repository.getDraft('tester')).assets.rootKey, draft.assets.rootKey);
});

test('legacy JSON versions are explicitly non-restorable', async t => {
  const { raw, repository, draft } = await fixture(t);
  await raw.putJson('characters/tester/versions/legacy/content.json', { ...draft, versionId: 'legacy' });
  assert.equal((await repository.listVersions('tester'))[0].restorable, false);
  await assert.rejects(repository.restoreVersion('tester', 'legacy'), /Legacy snapshot/);
});

test('version names cannot traverse paths or overwrite historical versions', async t => {
  const { repository, draft } = await fixture(t);
  await assert.rejects(repository.createVersion('tester', draft, { versionId: '../escape' }));
  await repository.createVersion('tester', draft, { versionId: 'fixed' });
  await assert.rejects(repository.createVersion('tester', draft, { versionId: 'fixed' }), /cannot be replaced/);
});

test('nested runs record parent links and failures without losing input artifacts', async t => {
  const { storage } = await fixture(t);
  await assert.rejects(storage.lineage.run({ characterId: 'tester', stage: 'generation' }, () => storage.lineage.run({ stage: 'compile' }, async () => { throw new Error('Bad geometry'); })), /Bad geometry/);
  const events = (await storage.lineage.events('tester')).events;
  const root = events.find(e => e.type === 'run-started' && e.stage === 'generation');
  assert.equal(events.find(e => e.type === 'run-started' && e.stage === 'compile').parentRunId, root.runId);
  assert.equal(events.filter(e => e.type === 'run-failed').length, 2);
});

test('provenance excludes credentials and inline media', () => {
  const sanitized = safeProvenance({ apiKey: 'secret', nested: { authorization: 'Bearer nope', prompt: 'Paint' }, image: 'data:image/png;base64,foo', url: 'https://a.test?token=secret', bytes: Buffer.from('image') });
  assert.equal(JSON.stringify(sanitized).includes('secret'), false);
  assert.equal(sanitized.nested.prompt, 'Paint');
  assert.equal(sanitized.image.redacted, true);
  assert.equal(sanitized.bytes.bytes, 5);
});

test('branching an archived source never installs it over a reviewed row', async t => {
  const { storage, repository, pack } = await fixture(t);
  const event = (await storage.lineage.events('tester')).events.find(e => e.logicalKey === `${pack}/sprites/idle/idle_001.png`);
  const result = await repository.branchArtifact('tester', event.id);
  assert.match(result.key, /sources\/branches\//);
  assert.equal((await storage.getBytes(result.key)).toString(), 'original-image');
});

test('comparison reports changed bytes and character fields', async t => {
  const { storage, repository, draft, pack } = await fixture(t);
  const a = await repository.createVersion('tester', draft);
  await storage.putBytes(`${pack}/sprites/idle/idle_001.png`, Buffer.from('changed'));
  const b = await repository.createVersion('tester', { ...draft, displayName: 'Changed' });
  const diff = await compareVersions(repository, 'tester', a.versionId, b.versionId);
  assert.equal(diff.changes.length, 1);
  assert.deepEqual(diff.configFields, ['displayName']);
});

test('archived completed video can recover after its local job directory is lost, without submission', async t => {
  const { storage, raw } = await fixture(t);
  const output = path.join(raw.rootDir, 'video-job');
  let submissions = 0;
  const video = Buffer.from('0000ftypisom00000000000000000000');
  await runVideoJob({ provider: 'pruna', mode: 'image-to-video', image: 'https://example.com/reference.png', prompt: 'Walk', duration: 5, output }, {
    storage, characterId: 'tester', log: () => {}, adapter: { submit: async () => { submissions++; return { requestId: 'fixture-task' }; }, poll: async (_, hooks) => hooks.onStatus('COMPLETED'), result: async () => ({}), download: async () => video },
  });
  const event = (await storage.lineage.events('tester')).events.find(e => e.type === 'video-checkpoint' && e.transportStatus === 'downloaded');
  await rm(output, { recursive: true, force: true });
  const recovered = await resumeArchivedVideo({ storage, characterId: 'tester', eventId: event.id, adapter: { submit: async () => { throw new Error('Must not submit'); } } });
  t.after(() => rm(recovered.directory, { recursive: true, force: true }));
  assert.equal(recovered.transportStatus, 'downloaded');
  assert.equal(submissions, 1);
  assert.deepEqual(await storage.lineage.readArtifact(recovered.output), video);
});

test('uncertain archived submission cannot create another paid job', async t => {
  const { storage } = await fixture(t);
  const artifact = await storage.lineage.artifact(Buffer.from(JSON.stringify({ transportStatus: 'submitting' })), { contentType: 'application/json' });
  const event = await storage.lineage.event('tester', { type: 'video-checkpoint', artifact });
  await assert.rejects(resumeArchivedVideo({ storage, characterId: 'tester', eventId: event.id }), /no confirmed request ID/);
});

test('configuration corruption is detected before restoration', async t => {
  const { raw, repository, draft } = await fixture(t);
  const version = await repository.createVersion('tester', draft);
  await raw.putJson(repository.versionKey('tester', version.versionId), { ...version, displayName: 'Tampered' });
  await assert.rejects(repository.restoreVersion('tester', version.versionId), /configuration integrity check failed/);
  assert.equal((await repository.getDraft('tester')).displayName, 'Tester');
});
