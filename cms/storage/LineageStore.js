import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { normalizeStorageKey } from './FileCmsStorage.js';

const context = new AsyncLocalStorage();
export const currentLineage = () => context.getStore()?.lineage;
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const id = () => `${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}-${randomUUID()}`;
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

// Deliberately omit credentials, signed URLs and inline uploads from run inputs.
export function safeProvenance(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { sha256: digest(value), bytes: value.length };
  if (Array.isArray(value)) return value.map(safeProvenance);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => !/secret|token|api.?key|authorization|cookie|base64|signed.?url/i.test(key) && typeof item !== 'function')
    .map(([key, item]) => [key, safeProvenance(item)]));
  if (typeof value === 'string' && /^(data:|https?:)/i.test(value)) return { redacted: true, sha256: digest(value) };
  return value;
}

export class LineageStore {
  constructor(storage) { this.storage = storage; }

  async immutable(key, bytes, metadata = {}) {
    // All supported adapters implement atomic create-only writes. Never emulate
    // with exists()+put(): that loses history when two workers race.
    if (!this.storage.putImmutable) throw new Error('Storage does not support immutable writes.');
    await this.storage.putImmutable(key, bytes, metadata);
  }

  async artifact(bytes, metadata = {}) {
    bytes = Buffer.from(bytes);
    const sha256 = digest(bytes), key = `lineage/blobs/sha256/${sha256.slice(0, 2)}/${sha256}`;
    if (await this.storage.exists(key)) {
      if (digest(await this.storage.getBytes(key)) !== sha256) throw new Error(`Corrupt archived blob: ${sha256}`);
    } else {
      try { await this.immutable(key, bytes, { contentType: metadata.contentType ?? 'application/octet-stream' }); }
      catch (error) {
        if (!(await this.storage.exists(key)) || digest(await this.storage.getBytes(key)) !== sha256) throw error;
      }
    }
    return { key, sha256, bytes: bytes.length, contentType: metadata.contentType ?? 'application/octet-stream' };
  }

  async readArtifact(artifact) {
    if (!/^lineage\/blobs\/sha256\/[a-f0-9]{2}\/[a-f0-9]{64}$/.test(artifact.key)) throw new Error('Invalid archived artifact key.');
    const bytes = await this.storage.getBytes(artifact.key);
    if (digest(bytes) !== artifact.sha256 || bytes.length !== artifact.bytes) throw new Error(`Archive integrity check failed: ${artifact.key}`);
    return bytes;
  }

  async event(characterId, details) {
    const scope = characterId ? segment(characterId) : '_global';
    const event = { schemaVersion: 1, runId: context.getStore()?.runId ?? null, ...safeProvenance(details), id: id(), characterId: characterId ?? null, at: new Date().toISOString() };
    await this.immutable(`lineage/events/${scope}/${event.id}.json`, jsonBytes(event), { contentType: 'application/json' });
    return event;
  }

  async events(characterId, { before, limit = 100 } = {}) {
    const keys = (await this.storage.list(`lineage/events/${characterId ? segment(characterId) : '_global'}`)).sort().reverse();
    const selected = keys.filter(key => !before || key.split('/').at(-1) < `${before}.json`).slice(0, Math.min(200, Math.max(1, limit)));
    const events = await Promise.all(selected.map(key => this.storage.getJson(key)));
    return { events, nextCursor: selected.length && keys.indexOf(selected.at(-1)) < keys.length - 1 ? events.at(-1).id : null };
  }

  async run(details, callback) {
    const parent = context.getStore();
    const runId = randomUUID(), started = Date.now();
    const { lineage: ignored, ...parentDetails } = parent ?? {};
    const scope = { ...parentDetails, ...details, runId, parentRunId: parent?.runId ?? null };
    await this.event(scope.characterId, { type: 'run-started', ...scope });
    return context.run({ ...scope, lineage: this }, async () => {
      let completed = false;
      try {
        const result = await callback(runId);
        completed = true;
        await this.event(scope.characterId, { type: 'run-completed', runId, parentRunId: scope.parentRunId, stage: scope.stage, durationMs: Date.now() - started });
        return result;
      } catch (error) {
        if (completed) { error.code = 'ARCHIVE_PERSISTENCE'; error.name = 'ArchivePersistenceError'; }
        await this.event(scope.characterId, { type: 'run-failed', runId, parentRunId: scope.parentRunId, stage: scope.stage, durationMs: Date.now() - started, error: { name: error.name, code: error.code ?? null, message: String(error.message).replace(/https?:\/\/\S+/g, '[URL omitted]').slice(0, 1200) } });
        throw error;
      }
    });
  }
}

export function segment(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value) || value === '..') throw new Error('Invalid lineage identifier.');
  return value;
}

/** Preserve the existing adapter surface while journaling every working-asset
 * replacement BEFORE writing it. The journal survives a failed alias update. */
export function withLineage(storage) {
  if (storage.lineage) return storage;
  const lineage = new LineageStore(storage);
  const write = async (key, bytes, metadata = {}) => {
    key = normalizeStorageKey(key);
    if (/^(lineage(?:\/|$)|characters\/[^/]+\/versions(?:\/|$))/.test(key)) {
      return lineage.immutable(key, bytes, metadata);
    }
    const match = key.match(/^characters\/([^/]+)\/(assets\/|draft\/|qa\/)/);
    if (match || key.startsWith('benchmarks/generation-attempts/')) {
      const before = await storage.exists(key)
        ? await lineage.artifact(await storage.getBytes(key), await storage.getMetadata(key)) : null;
      const artifact = await lineage.artifact(bytes, metadata);
      const scope = context.getStore();
      await lineage.event(match?.[1] ?? scope?.characterId, {
        type: 'artifact-written', logicalKey: key, artifact, previousArtifact: before,
        runId: scope?.runId ?? null, stage: scope?.stage ?? 'working-copy-write', metadata: safeProvenance(metadata),
      });
    }
    return storage.putBytes(key, bytes, metadata);
  };
  return new Proxy(storage, { get(target, property) {
    if (property === 'constructor') return target.constructor;
    if (property === 'lineage') return lineage;
    if (property === 'putBytes') return write;
    if (property === 'putJson') return (key, value, metadata = {}) => write(key, jsonBytes(value), { contentType: 'application/json', ...metadata });
    if (property === 'delete') return key => {
      if (/^(lineage(?:\/|$)|characters(?:\/[^/]+)?$|characters\/[^/]+\/versions(?:\/|$))/.test(normalizeStorageKey(key))) throw new Error('Historical artifacts cannot be deleted through the working storage API.');
      return target.delete(key);
    };
    const value = Reflect.get(target, property);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}
