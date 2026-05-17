import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function normalizeStorageKey(key) {
  if (typeof key !== 'string') {
    throw new TypeError('CMS storage key must be a string.');
  }

  const normalized = path.posix.normalize(key.replaceAll('\\', '/')).replace(/^\/+/, '');
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`Unsafe CMS storage key: ${key}`);
  }

  return normalized;
}

export class FileCmsStorage {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir ?? path.join(process.cwd(), 'cms-data'));
    this.publicBaseUrl = options.publicBaseUrl ?? null;
    this.id = 'file-cms-storage';
    this.provider = 'file';
    this.capabilities = ['json', 'bytes', 'metadata', 'local-file-storage'];
  }

  async healthCheck() {
    await mkdir(this.rootDir, { recursive: true });
    await stat(this.rootDir);
    return {
      status: 'ok',
      message: `File storage root is available: ${this.rootDir}`,
      details: {
        rootDir: this.rootDir,
        publicBaseUrl: this.publicBaseUrl,
      },
    };
  }

  async getJson(key) {
    const content = await readFile(this.absolutePath(key), 'utf8');
    return JSON.parse(content);
  }

  async putJson(key, value, metadata = {}) {
    const body = `${JSON.stringify(value, null, 2)}\n`;
    await this.writeObject(key, body);
    await this.writeMetadata(key, {
      contentType: 'application/json',
      ...metadata,
    });
  }

  async getBytes(key) {
    return readFile(this.absolutePath(key));
  }

  async putBytes(key, bytes, metadata = {}) {
    await this.writeObject(key, bytes);
    await this.writeMetadata(key, metadata);
  }

  async getMetadata(key) {
    try {
      return JSON.parse(await readFile(this.metadataPath(key), 'utf8'));
    } catch (error) {
      if (error && error.code === 'ENOENT') return {};
      throw error;
    }
  }

  async exists(key) {
    try {
      await stat(this.absolutePath(key));
      return true;
    } catch (error) {
      if (error && error.code === 'ENOENT') return false;
      throw error;
    }
  }

  async list(prefix = '') {
    const normalizedPrefix = prefix ? normalizeStorageKey(prefix) : '';
    const basePath = normalizedPrefix ? this.absolutePath(normalizedPrefix) : this.rootDir;
    const entries = [];

    if (!(await this.pathExists(basePath))) return entries;
    await this.collectKeys(basePath, entries);
    return entries
      .map((entry) => path.relative(this.rootDir, entry).split(path.sep).join('/'))
      .filter((key) => !key.endsWith('.metadata.json'))
      .filter((key) => !normalizedPrefix || key === normalizedPrefix || key.startsWith(`${normalizedPrefix}/`))
      .sort();
  }

  async delete(key) {
    const absolutePath = this.absolutePath(key);
    await rm(absolutePath, { force: true, recursive: true });
    await rm(this.metadataPath(key), { force: true });
  }

  urlFor(key) {
    const normalizedKey = normalizeStorageKey(key);
    if (this.publicBaseUrl) {
      return `${this.publicBaseUrl.replace(/\/$/, '')}/${encodeURI(normalizedKey)}`;
    }

    return pathToFileURL(this.absolutePath(normalizedKey)).toString();
  }

  absolutePath(key) {
    const normalizedKey = normalizeStorageKey(key);
    const absolutePath = path.resolve(this.rootDir, normalizedKey);
    if (absolutePath !== this.rootDir && !absolutePath.startsWith(`${this.rootDir}${path.sep}`)) {
      throw new Error(`CMS storage key escapes root: ${key}`);
    }
    return absolutePath;
  }

  metadataPath(key) {
    return `${this.absolutePath(key)}.metadata.json`;
  }

  async writeObject(key, value) {
    const absolutePath = this.absolutePath(key);
    await mkdir(path.dirname(absolutePath), { recursive: true });

    const tempPath = path.join(path.dirname(absolutePath), `.${path.basename(absolutePath)}.${randomUUID()}.tmp`);
    await writeFile(tempPath, value);
    await rename(tempPath, absolutePath);
  }

  async writeMetadata(key, metadata) {
    if (!metadata || Object.keys(metadata).length === 0) return;

    const metadataPath = this.metadataPath(key);
    await mkdir(path.dirname(metadataPath), { recursive: true });
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  }

  async collectKeys(currentPath, entries) {
    const currentStat = await stat(currentPath);
    if (currentStat.isFile()) {
      entries.push(currentPath);
      return;
    }

    const children = await readdir(currentPath);
    for (const child of children) {
      await this.collectKeys(path.join(currentPath, child), entries);
    }
  }

  async pathExists(absolutePath) {
    try {
      await stat(absolutePath);
      return true;
    } catch (error) {
      if (error && error.code === 'ENOENT') return false;
      throw error;
    }
  }
}
