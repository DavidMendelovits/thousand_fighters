import { normalizeStorageKey } from '../storage/FileCmsStorage.js';

const CHARACTER_INDEX_KEY = 'characters/index.json';

export class CharacterContentRepository {
  constructor(storage, options = {}) {
    this.storage = storage;
    this.clock = options.clock ?? (() => new Date());
    this.recoverIndexFromDrafts = options.recoverIndexFromDrafts ?? storage.provider === 'file';
    this.id = 'file-character-repository';
    this.provider = 'file';
    this.capabilities = ['drafts', 'versions', 'assets', 'qa-reports'];
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
    const versionId = options.versionId ?? now.replaceAll(':', '-').replaceAll('.', '-');
    const version = {
      ...content,
      id: characterId,
      lifecycle: 'version',
      versionId,
      createdAt: content.createdAt ?? now,
      updatedAt: now,
    };
    const key = this.versionKey(characterId, versionId);

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

    return version;
  }

  async getVersion(characterId, versionId) {
    return this.storage.getJson(this.versionKey(characterId, versionId));
  }

  async listCharacterAssets(characterId) {
    return this.storage.list(`characters/${this.safeCharacterId(characterId)}/assets`);
  }

  async writeAsset(characterId, relativePath, bytes, metadata = {}) {
    const key = this.assetKey(characterId, relativePath);
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
    return {
      key,
      url: this.storage.urlFor(key),
    };
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
