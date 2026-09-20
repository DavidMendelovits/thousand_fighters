import { randomUUID } from 'node:crypto';
import { digest, segment } from '../storage/LineageStore.js';

function rewrite(value, from, to) {
  if (typeof value === 'string') return value.replaceAll(from, to).replaceAll(encodeURIComponent(from), encodeURIComponent(to));
  if (Array.isArray(value)) return value.map(item => rewrite(item, from, to));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item, from, to)]));
  return value;
}

export async function snapshotAssets(repository, characterId, content, versionId) {
  const { storage } = repository;
  const draftKey = repository.draftKey(characterId);
  const originalDraftHash = await storage.exists(draftKey) ? digest(await storage.getBytes(draftKey)) : null;
  const base = `characters/${segment(characterId)}/assets`;
  const target = `characters/${characterId}/versions/${segment(versionId)}/assets`;
  // A restored draft has its own isolated working root. Don't recursively
  // snapshot every abandoned branch under assets/revisions.
  const source = content.history?.workingRoot ?? base;
  const keys = (await storage.list(source)).filter(key => !key.startsWith(`${source}/jobs/`) && !key.startsWith(`${source}/revisions/`));
  const assets = [];
  for (const key of keys) {
    const bytes = await storage.getBytes(key), metadata = await storage.getMetadata(key);
    const original = await storage.lineage.artifact(bytes, metadata);
    let frozenBytes = bytes;
    if (key.endsWith('.json')) frozenBytes = Buffer.from(`${JSON.stringify(rewrite(JSON.parse(bytes), source, target), null, 2)}\n`);
    const artifact = await storage.lineage.artifact(frozenBytes, metadata);
    const pinnedKey = target + key.slice(source.length);
    await storage.putBytes(pinnedKey, frozenBytes, metadata);
    assets.push({ sourceKey: key, pinnedKey, artifact, original, metadata });
  }
  // Reject a mixed-time snapshot instead of declaring it restorable.
  for (const asset of assets) {
    if (digest(await storage.getBytes(asset.sourceKey)) !== asset.original.sha256) throw new Error('Assets changed during checkpoint. Retry once generation finishes.');
  }
  const finalKeys = (await storage.list(source)).filter(key => !key.startsWith(`${source}/jobs/`) && !key.startsWith(`${source}/revisions/`));
  if (JSON.stringify(keys) !== JSON.stringify(finalKeys)) throw new Error('Asset inventory changed during checkpoint. Retry once generation finishes.');
  if (originalDraftHash && digest(await storage.getBytes(draftKey)) !== originalDraftHash) throw new Error('Draft changed during checkpoint. Retry once editing finishes.');
  const pinned = rewrite(content, source, target);
  if (!pinned.assets?.rootKey && keys.some(key => key.startsWith(`${source}/fighter-pack/`))) pinned.assets = { ...pinned.assets, rootKey: `${target}/fighter-pack` };
  return { content: pinned, manifest: { schemaVersion: 1, characterId, versionId, sourceRoot: source, pinnedRoot: target, assets } };
}

export async function listVersions(repository, characterId) {
  const keys = await repository.storage.list(`characters/${segment(characterId)}/versions`);
  const versions = [];
  for (const key of keys.filter(key => /^characters\/[^/]+\/versions\/[^/]+\/content.json$/.test(key))) {
    const value = await repository.storage.getJson(key);
    versions.push({ versionId: value.versionId ?? key.split('/')[3], at: value.updatedAt, label: value.history?.label ?? 'Legacy configuration snapshot', restorable: value.history?.schemaVersion === 1, parentVersionId: value.history?.parentVersionId ?? null, assetCount: value.history?.assetCount ?? null });
  }
  return versions.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
}

export async function restoreVersion(repository, characterId, versionId) {
  segment(characterId); segment(versionId);
  const { storage } = repository;
  const version = await repository.getVersion(characterId, versionId);
  if (version.history?.schemaVersion !== 1) throw new Error('Legacy snapshot has no frozen assets. It cannot safely restore an exact character.');
  const manifest = await storage.getJson(version.history.manifestKey);
  if (manifest.characterId !== characterId || manifest.versionId !== versionId) throw new Error('Version manifest identity mismatch.');
  // Verify every byte before touching the current draft. Build the new working
  // tree privately; switching the draft is the final operation.
  const source = manifest.pinnedRoot;
  const destination = `characters/${characterId}/assets/revisions/${randomUUID()}`;
  for (const entry of manifest.assets) {
    if (!entry.pinnedKey.startsWith(`${source}/`)) throw new Error('Version contains an invalid asset path.');
    let bytes = await storage.lineage.readArtifact(entry.artifact);
    if (entry.pinnedKey.endsWith('.json')) bytes = Buffer.from(`${JSON.stringify(rewrite(JSON.parse(bytes), source, destination), null, 2)}\n`);
    await storage.putBytes(destination + entry.pinnedKey.slice(source.length), bytes, entry.metadata);
  }
  const current = await repository.getDraft(characterId);
  const safety = await repository.createVersion(characterId, current, { label: `Before restoring ${version.history.label ?? versionId}` });
  const restored = rewrite(version, source, destination);
  delete restored.versionId;
  restored.history = { schemaVersion: 1, restoredFromVersionId: versionId, parentVersionId: versionId, safetyVersionId: safety.versionId, workingRoot: destination };
  const result = await repository.saveDraft(characterId, restored, { operation: 'restore-version', versionId });
  await storage.lineage.event(characterId, { type: 'version-restored', versionId, safetyVersionId: safety.versionId, workingRoot: destination });
  return result;
}

export async function restoreArtifact(repository, characterId, eventId) {
  segment(characterId); segment(eventId);
  const { storage } = repository;
  const event = await getArchivedEvent(storage, characterId, eventId);
  if (!['artifact-written', 'generation-output', 'legacy-import'].includes(event.type) || !event.artifact) throw new Error('Select an archived artifact.');
  // Do not silently install a single sprite into an approved pack. Branch an
  // input into a new source asset so it can be processed and reviewed again.
  const bytes = await storage.lineage.readArtifact(event.artifact);
  const suffix = event.logicalKey?.split('/').at(-1) ?? (event.artifact.contentType === 'video/mp4' ? 'source.mp4' : 'reference.png');
  const result = await repository.writeAsset(characterId, `sources/branches/${randomUUID()}/${suffix}`, bytes, { contentType: event.artifact.contentType, parentEventId: eventId, parentArtifact: event.artifact.sha256 });
  await storage.lineage.event(characterId, { type: 'artifact-branched', parentEventId: eventId, artifact: event.artifact, logicalKey: result.key });
  return result;
}

export async function getArchivedEvent(storage, characterId, eventId) {
  segment(characterId); segment(eventId);
  const key = `lineage/events/${characterId}/${eventId}.json`;
  return storage.getJson(await storage.exists(key) ? key : `lineage/events/_global/${eventId}.json`);
}

export async function compareVersions(repository, characterId, leftId, rightId) {
  segment(characterId); segment(leftId); segment(rightId);
  const [left, right] = await Promise.all([repository.getVersion(characterId, leftId), repository.getVersion(characterId, rightId)]);
  if (!left.history?.manifestKey || !right.history?.manifestKey) throw new Error('Both checkpoints must have frozen assets to compare.');
  const [a, b] = await Promise.all([repository.storage.getJson(left.history.manifestKey), repository.storage.getJson(right.history.manifestKey)]);
  const entries = manifest => new Map(manifest.assets.map(entry => [entry.pinnedKey.slice(manifest.pinnedRoot.length + 1), entry.artifact]));
  const aa = entries(a), bb = entries(b);
  const changes = [...new Set([...aa.keys(), ...bb.keys()])].sort().filter(key => aa.get(key)?.sha256 !== bb.get(key)?.sha256).map(key => ({ path: key, kind: !aa.has(key) ? 'added' : !bb.has(key) ? 'removed' : 'changed', left: aa.get(key) ?? null, right: bb.get(key) ?? null }));
  const excluded = new Set(['history', 'versionId', 'updatedAt', 'createdAt', 'lifecycle']);
  const configFields = [...new Set([...Object.keys(left), ...Object.keys(right)])].filter(key => !excluded.has(key) && JSON.stringify(rewrite(left[key], a.pinnedRoot, '$ASSETS')) !== JSON.stringify(rewrite(right[key], b.pinnedRoot, '$ASSETS')));
  return { leftId, rightId, configFields, changes, unchanged: [...aa.keys()].filter(key => aa.get(key)?.sha256 === bb.get(key)?.sha256).length };
}
