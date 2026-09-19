import { normalizeStorageKey } from '../storage/FileCmsStorage.js';
import { withLineage, digest } from '../storage/LineageStore.js';
import { snapshotAssets, listVersions, restoreVersion, restoreArtifact } from './characterHistory.js';
import { randomUUID } from 'node:crypto';

const CHARACTER_INDEX_KEY = 'characters/index.json';

export class CharacterContentRepository {
  constructor(storage, options = {}) {
    this.storage = withLineage(storage);
    this.clock = options.clock ?? (() => new Date());
    this.recoverIndexFromDrafts = options.recoverIndexFromDrafts ?? storage.provider === 'file';
    this.id = 'file-character-repository';
    this.provider = 'file';
    this.capabilities = ['drafts', 'versions', 'assets', 'qa-reports'];
    this.mutations = new Map();
  }

  // One writer per character in this CMS process; different characters remain
  // parallel. Prevent a restore from racing a long-running generation install.
  async withMutation(characterId, operation) {
    const prior = this.mutations.get(characterId) ?? Promise.resolve();
    const pending = prior.catch(() => {}).then(operation);
    this.mutations.set(characterId, pending);
    try { return await pending; }
    finally { if (this.mutations.get(characterId) === pending) this.mutations.delete(characterId); }
  }

  async healthCheck() {
    const characters = await this.listCharacters();
    return {
      status: 'ok',
      message: `Character repository loaded ${characters.length} character(s).`,
      details: {
        characterCount: characters.length,
      },
    };
  }

  async listCharacters() {
    const characters = new Map();

    if (await this.storage.exists(CHARACTER_INDEX_KEY)) {
      const index = await this.storage.getJson(CHARACTER_INDEX_KEY);
      for (const character of index.characters ?? []) {
        if (character?.id) characters.set(character.id, character);
      }
    }

    if (this.recoverIndexFromDrafts || characters.size === 0) {
      for (const character of await this.discoverCharactersFromDrafts()) {
        characters.set(character.id, {
          ...characters.get(character.id),
          ...character,
        });
      }
    }

    return [...characters.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  async getDraft(characterId) {
    return this.storage.getJson(this.draftKey(characterId));
  }

  async saveDraft(characterId, content, metadata = {}) {
    const now = this.clock().toISOString();
    const draft = {
      ...content,
      id: characterId,
      lifecycle: 'draft',
      updatedAt: now,
    };

    await this.storage.putJson(this.draftKey(characterId), draft, {
      contentType: 'application/vnd.thousand-fighters.character+json',
      lifecycle: 'draft',
      ...metadata,
    });
    await this.upsertCharacterIndex(characterId, {
      id: characterId,
      displayName: draft.displayName ?? characterId,
      status: 'draft',
      draftKey: this.draftKey(characterId),
      updatedAt: now,
    });

    return draft;
  }

  async createVersion(characterId, content, options = {}) {
    const now = this.clock().toISOString();
    const versionId = options.versionId ?? `${now.replaceAll(':', '-').replaceAll('.', '-')}-${randomUUID()}`;
    if (await this.storage.exists(this.versionKey(characterId, versionId))) throw new Error('Version already exists; immutable versions cannot be replaced.');
    const { content: pinned, manifest } = await snapshotAssets(this, characterId, content, versionId);
    const manifestKey = this.versionKey(characterId, versionId).replace(/content.json$/, 'assets.json');
    await this.storage.putJson(manifestKey, manifest);
    const version = {
      ...pinned,
      id: characterId,
      lifecycle: 'version',
      versionId,
      createdAt: content.createdAt ?? now,
      updatedAt: now,
      history: { schemaVersion: 1, label: options.label ?? options.metadata?.releaseId ?? 'Character checkpoint', manifestKey, assetCount: manifest.assets.length, parentVersionId: content.history?.parentVersionId ?? content.history?.restoredFromVersionId ?? null },
    };
    const key = this.versionKey(characterId, versionId);

    const contentArtifact = await this.storage.lineage.artifact(Buffer.from(`${JSON.stringify(version, null, 2)}\n`), { contentType: 'application/json' });
    const manifestArtifact = await this.storage.lineage.artifact(await this.storage.getBytes(manifestKey), { contentType: 'application/json' });
    await this.storage.putJson(key.replace(/content.json$/, 'integrity.json'), { schemaVersion: 1, content: contentArtifact, manifest: manifestArtifact });

    await this.storage.putJson(key, version, {
      contentType: 'application/vnd.thousand-fighters.character+json',
      lifecycle: 'version',
      versionId,
      ...options.metadata,
    });
    await this.upsertCharacterIndex(characterId, {
      id: characterId,
      displayName: version.displayName ?? characterId,
      status: 'versioned',
      latestVersionId: versionId,
      latestVersionKey: key,
      updatedAt: now,
    });

    await this.storage.lineage.event(characterId, { type: 'version-created', versionId, manifestKey, label: version.history.label, assetCount: manifest.assets.length });

    return version;
  }

  async listVersions(characterId) { return listVersions(this, characterId); }
  async restoreVersion(characterId, versionId) { return restoreVersion(this, characterId, versionId); }
  async branchArtifact(characterId, eventId) { return restoreArtifact(this, characterId, eventId); }

  async getVersion(characterId, versionId) {
    const key = this.versionKey(characterId, versionId);
    const bytes = await this.storage.getBytes(key);
    const sealKey = key.replace(/content.json$/, 'integrity.json');
    if (await this.storage.exists(sealKey)) {
      const seal = await this.storage.getJson(sealKey);
      if (digest(bytes) !== seal.content.sha256) throw new Error('Version configuration integrity check failed.');
      const version = JSON.parse(bytes);
      if (digest(await this.storage.getBytes(version.history.manifestKey)) !== seal.manifest.sha256) throw new Error('Version manifest integrity check failed.');
    }
    return JSON.parse(bytes);
  }

  async listCharacterAssets(characterId) {
    return this.storage.list(await this.workingAssetRoot(characterId));
  }

  async workingAssetRoot(characterId) {
    const base = `characters/${this.safeCharacterId(characterId)}/assets`;
    if (!(await this.storage.exists(this.draftKey(characterId)))) return base;
    const root = (await this.getDraft(characterId)).history?.workingRoot;
    if (!root) return base;
    if (!root.startsWith(`${base}/revisions/`) || normalizeStorageKey(root) !== root) throw new Error('Invalid restored working root.');
    return root;
  }

  async writeAsset(characterId, relativePath, bytes, metadata = {}) {
    const key = `${await this.workingAssetRoot(characterId)}/${normalizeStorageKey(relativePath)}`;
    await this.storage.putBytes(key, bytes, metadata);
    return {
      key,
      url: this.storage.urlFor(key),
    };
  }

  async writeQaReport(characterId, runId, report) {
    const key = `characters/${this.safeCharacterId(characterId)}/qa/${normalizeStorageKey(runId)}/report.json`;
    await this.storage.putJson(key, report, {
      contentType: 'application/json',
      reportType: 'fighter-pack-qa',
    });
    // Maintain a stable pointer to the most recent report so publish gates
    // can check QA status without listing runs.
    await this.storage.putJson(this.latestQaReportKey(characterId), { ...report, runId, reportKey: key }, {
      contentType: 'application/json',
      reportType: 'fighter-pack-qa',
      alias: 'latest',
    });
    return {
      key,
      url: this.storage.urlFor(key),
    };
  }

  async getLatestQaReport(characterId) {
    const key = this.latestQaReportKey(characterId);
    if (!(await this.storage.exists(key))) return null;
    return this.storage.getJson(key);
  }

  latestQaReportKey(characterId) {
    return `characters/${this.safeCharacterId(characterId)}/qa/latest.json`;
  }

  draftKey(characterId) {
    return `characters/${this.safeCharacterId(characterId)}/draft/content.json`;
  }

  versionKey(characterId, versionId) {
    return `characters/${this.safeCharacterId(characterId)}/versions/${normalizeStorageKey(versionId)}/content.json`;
  }

  assetKey(characterId, relativePath) {
    return `characters/${this.safeCharacterId(characterId)}/assets/${normalizeStorageKey(relativePath)}`;
  }

  safeCharacterId(characterId) {
    return normalizeStorageKey(characterId);
  }

  async upsertCharacterIndex(characterId, patch) {
    const existing = await this.listCharacters();
    const next = existing.filter((character) => character.id !== characterId);
    next.push(patch);
    next.sort((left, right) => left.id.localeCompare(right.id));
    await this.storage.putJson(CHARACTER_INDEX_KEY, { characters: next }, { contentType: 'application/json' });
  }

  async discoverCharactersFromDrafts() {
    const keys = await this.storage.list('characters');
    const draftKeys = keys.filter((key) => /^characters\/[^/]+\/draft\/content\.json$/.test(key));
    const characters = [];

    for (const key of draftKeys) {
      const draft = await this.storage.getJson(key);
      const characterId = key.split('/')[1];
      characters.push({
        id: draft.id ?? characterId,
        displayName: draft.displayName ?? draft.id ?? characterId,
        status: draft.lifecycle ?? 'draft',
        draftKey: key,
        updatedAt: draft.updatedAt ?? draft.createdAt ?? null,
      });
    }

    return characters;
  }
}
