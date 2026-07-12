export class CachedCmsStorage {
  constructor(options = {}) {
    if (!options.cache) throw new Error('CachedCmsStorage requires a cache storage adapter.');
    if (!options.remote) throw new Error('CachedCmsStorage requires a remote storage adapter.');

    this.cache = options.cache;
    this.remote = options.remote;
    this.writeThrough = options.writeThrough ?? true;
    this.id = `cached-${this.remote.id ?? 'cms-storage'}`;
    this.provider = 'cached';
    this.capabilities = [
      'json',
      'bytes',
      'metadata',
      'read-through-cache',
      'write-through-cache',
      ...(this.remote.capabilities ?? []),
    ];
  }

  async healthCheck() {
    const [cache, remote] = await Promise.all([
      this.cache.healthCheck(),
      this.remote.healthCheck(),
    ]);
    return {
      status: remote.status === 'error' ? 'error' : remote.status === 'warning' ? 'warning' : 'ok',
      message: `Cached CMS storage is using ${this.remote.provider} remote storage.`,
      details: {
        cache,
        remote,
      },
    };
  }

  async getJson(key) {
    const bytes = await this.getBytes(key);
    return JSON.parse(bytes.toString('utf8'));
  }

  async putJson(key, value, metadata = {}) {
    if (this.writeThrough) {
      await this.remote.putJson(key, value, metadata);
    }
    await this.cache.putJson(key, value, metadata);
  }

  async getBytes(key) {
    if (await this.cache.exists(key)) {
      return this.cache.getBytes(key);
    }

    const [bytes, metadata] = await Promise.all([
      this.remote.getBytes(key),
      this.remote.getMetadata(key).catch(() => ({})),
    ]);
    await this.cache.putBytes(key, bytes, metadata);
    return bytes;
  }

  async putBytes(key, bytes, metadata = {}) {
    if (this.writeThrough) {
      await this.remote.putBytes(key, bytes, metadata);
    }
    await this.cache.putBytes(key, bytes, metadata);
  }

  async getMetadata(key) {
    if (await this.cache.exists(key)) {
      const cachedMetadata = await this.cache.getMetadata(key);
      if (Object.keys(cachedMetadata).length > 0) return cachedMetadata;
    }

    const metadata = await this.remote.getMetadata(key);
    if (Object.keys(metadata).length > 0 && await this.cache.exists(key)) {
      await this.cache.writeMetadata(key, metadata);
    }
    return metadata;
  }

  async exists(key) {
    return await this.cache.exists(key) || await this.remote.exists(key);
  }

  async list(prefix = '') {
    return this.remote.list(prefix);
  }

  async delete(key) {
    if (this.writeThrough) {
      await this.remote.delete(key);
    }
    await this.cache.delete(key);
  }

  urlFor(key) {
    return this.remote.urlFor(key);
  }

  async syncPrefix(prefix = '', options = {}) {
    const listedKeys = await this.remote.list(prefix);
    const keys = listedKeys.length > 0 || !prefix || !(await this.remote.exists(prefix))
      ? listedKeys
      : [prefix];
    const copied = [];
    let skipped = 0;

    for (const key of keys) {
      if (!options.force && await this.cache.exists(key)) {
        skipped += 1;
        continue;
      }

      const [bytes, metadata] = await Promise.all([
        this.remote.getBytes(key),
        this.remote.getMetadata(key).catch(() => ({})),
      ]);
      await this.cache.putBytes(key, bytes, metadata);
      copied.push(key);

      if (typeof options.onProgress === 'function') {
        options.onProgress({
          copied: copied.length,
          skipped,
          total: keys.length,
          key,
        });
      }
    }

    return {
      prefix,
      total: keys.length,
      copied: copied.length,
      skipped,
      keys: copied,
    };
  }
}
