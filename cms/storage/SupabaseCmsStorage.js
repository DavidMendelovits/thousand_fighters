import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { normalizeStorageKey } from './FileCmsStorage.js';

export class SupabaseCmsStorage {
  constructor(options = {}) {
    this.url = requiredOption(options.url ?? process.env.SUPABASE_URL, 'SUPABASE_URL');
    this.serviceRoleKey = requiredOption(options.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY');
    this.bucket = requiredOption(options.bucket ?? process.env.SUPABASE_BUCKET, 'SUPABASE_BUCKET');
    this.publicBaseUrl = options.publicBaseUrl ?? process.env.SUPABASE_PUBLIC_BASE_URL ?? null;
    this.client = options.client ?? createClient(this.url, this.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    this.id = 'supabase-cms-storage';
    this.provider = 'supabase';
    this.capabilities = ['json', 'bytes', 'metadata', 'object-storage', 'supabase-storage'];
  }

  async healthCheck() {
    await this.ensureBucket();
    return {
      status: 'ok',
      message: `Supabase Storage bucket is available: ${this.bucket}`,
      details: {
        url: this.url,
        bucket: this.bucket,
        publicBaseUrl: this.publicBaseUrl,
      },
    };
  }

  async getJson(key) {
    const bytes = await this.getBytes(key);
    return JSON.parse(bytes.toString('utf8'));
  }

  async putJson(key, value, metadata = {}) {
    await this.putBytes(key, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'), {
      contentType: 'application/json',
      ...metadata,
    });
  }

  async getBytes(key) {
    const normalizedKey = normalizeStorageKey(key);
    const { data, error } = await storageRequest(
      () => this.bucketClient().download(normalizedKey),
      `download ${normalizedKey}`,
    );
    if (error) throwStorageError(error, `download ${normalizedKey}`);

    if (Buffer.isBuffer(data)) return data;
    if (data instanceof Uint8Array) return Buffer.from(data);
    if (typeof data?.arrayBuffer === 'function') {
      return Buffer.from(await data.arrayBuffer());
    }

    throw new Error(`Supabase download returned unsupported body for ${normalizedKey}.`);
  }

  async putBytes(key, bytes, metadata = {}) {
    const normalizedKey = normalizeStorageKey(key);
    const contentType = metadata.contentType ?? 'application/octet-stream';
    const { error } = await storageRequest(
      () => this.bucketClient().upload(normalizedKey, Buffer.from(bytes), {
        contentType,
        upsert: true,
      }),
      `upload ${normalizedKey}`,
    );
    if (error) throwStorageError(error, `upload ${normalizedKey}`);

    await this.writeMetadata(normalizedKey, {
      contentType,
      ...metadata,
    });
  }

  async getMetadata(key) {
    try {
      return await this.getJson(this.metadataKey(key));
    } catch (error) {
      if (isMissingObjectError(error)) return {};
      throw error;
    }
  }

  async exists(key) {
    const normalizedKey = normalizeStorageKey(key);
    const directory = path.posix.dirname(normalizedKey);
    const fileName = path.posix.basename(normalizedKey);
    const listPrefix = directory === '.' ? '' : directory;
    const { data, error } = await storageRequest(
      () => this.bucketClient().list(listPrefix, {
        limit: 1000,
        offset: 0,
      }),
      `list ${listPrefix}`,
    );
    if (error) {
      if (isMissingObjectError(error)) return false;
      throwStorageError(error, `list ${listPrefix}`);
    }

    return (data ?? []).some((entry) => entry.name === fileName && isFileEntry(entry));
  }

  async list(prefix = '') {
    const normalizedPrefix = prefix ? normalizeStorageKey(prefix).replace(/\/$/, '') : '';
    const keys = [];
    await this.collectKeys(normalizedPrefix, keys);
    return keys
      .filter((key) => !key.endsWith('.metadata.json'))
      .filter((key) => !normalizedPrefix || key === normalizedPrefix || key.startsWith(`${normalizedPrefix}/`))
      .sort();
  }

  async delete(key) {
    const normalizedKey = normalizeStorageKey(key);
    const { error } = await storageRequest(
      () => this.bucketClient().remove([
        normalizedKey,
        this.metadataKey(normalizedKey),
      ]),
      `delete ${normalizedKey}`,
    );
    if (error && !isMissingObjectError(error)) throwStorageError(error, `delete ${normalizedKey}`);
  }

  urlFor(key) {
    const normalizedKey = normalizeStorageKey(key);
    if (!this.publicBaseUrl) return `supabase://${this.bucket}/${normalizedKey}`;
    return `${this.publicBaseUrl.replace(/\/$/, '')}/${encodeURI(normalizedKey)}`;
  }

  async ensureBucket() {
    const { error } = await storageRequest(
      () => this.client.storage.getBucket(this.bucket),
      `get bucket ${this.bucket}`,
    );
    if (!error) return;

    if (!isMissingObjectError(error)) {
      throwStorageError(error, `get bucket ${this.bucket}`);
    }

    const createResult = await storageRequest(
      () => this.client.storage.createBucket(this.bucket, {
        public: false,
        fileSizeLimit: '25MB',
      }),
      `create bucket ${this.bucket}`,
    );
    if (createResult.error && !isAlreadyExistsError(createResult.error)) {
      throwStorageError(createResult.error, `create bucket ${this.bucket}`);
    }
  }

  async writeMetadata(key, metadata) {
    if (!metadata || Object.keys(metadata).length === 0) return;
    const metadataKey = this.metadataKey(key);
    const { error } = await storageRequest(
      () => this.bucketClient().upload(metadataKey, Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8'), {
        contentType: 'application/json',
        upsert: true,
      }),
      `upload ${metadataKey}`,
    );
    if (error) throwStorageError(error, `upload ${metadataKey}`);
  }

  async collectKeys(prefix, keys) {
    let offset = 0;
    const limit = 1000;

    while (true) {
      const { data, error } = await storageRequest(
        () => this.bucketClient().list(prefix, {
          limit,
          offset,
          sortBy: {
            column: 'name',
            order: 'asc',
          },
        }),
        `list ${prefix}`,
      );
      if (error) throwStorageError(error, `list ${prefix}`);

      const entries = data ?? [];
      for (const entry of entries) {
        const childKey = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (isFileEntry(entry)) {
          keys.push(childKey);
        } else {
          await this.collectKeys(childKey, keys);
        }
      }

      if (entries.length < limit) return;
      offset += limit;
    }
  }

  bucketClient() {
    return this.client.storage.from(this.bucket);
  }

  metadataKey(key) {
    return `${normalizeStorageKey(key)}.metadata.json`;
  }
}

function requiredOption(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required for CMS_STORAGE_PROVIDER=supabase.`);
  }
  return value.trim();
}

function isFileEntry(entry) {
  return Boolean(entry?.id || entry?.metadata || entry?.created_at || entry?.updated_at);
}

function isMissingObjectError(error) {
  return error?.statusCode === '404'
    || error?.status === 404
    || error?.code === '404'
    || error?.name === 'NotFound'
    || /not found/i.test(error?.message ?? '');
}

function isAlreadyExistsError(error) {
  return error?.statusCode === '409'
    || error?.status === 409
    || error?.code === '409'
    || /already exists/i.test(error?.message ?? '');
}

async function storageRequest(operation, action) {
  let attempt = 0;
  let lastError;

  while (attempt < 4) {
    try {
      const result = await operation();
      if (!result?.error || !isTransientStorageError(result.error)) return result;
      lastError = result.error;
    } catch (error) {
      if (!isTransientStorageError(error)) throw error;
      lastError = error;
    }

    attempt += 1;
    if (attempt >= 4) break;
    await delay(250 * 2 ** (attempt - 1));
  }

  return {
    data: null,
    error: lastError ?? new Error(`Supabase Storage failed to ${action}.`),
  };
}

function isTransientStorageError(error) {
  const status = Number(error?.statusCode ?? error?.status ?? error?.code ?? 0);
  return status === 429 || status >= 500 || /network|fetch|timeout|bad gateway/i.test(error?.message ?? '');
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function throwStorageError(error, action) {
  const wrapped = new Error(`Supabase Storage failed to ${action}: ${error.message ?? String(error)}`);
  wrapped.cause = error;
  wrapped.statusCode = isMissingObjectError(error) ? 404 : undefined;
  throw wrapped;
}
