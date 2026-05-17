import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { normalizeStorageKey } from './FileCmsStorage.js';

export class R2CmsStorage {
  constructor(options = {}) {
    this.accountId = requiredOption(options.accountId ?? process.env.R2_ACCOUNT_ID, 'R2_ACCOUNT_ID');
    this.bucket = requiredOption(options.bucket ?? process.env.R2_BUCKET, 'R2_BUCKET');
    this.publicBaseUrl = options.publicBaseUrl ?? process.env.R2_PUBLIC_BASE_URL ?? null;
    this.client = options.client ?? new S3Client({
      region: 'auto',
      endpoint: options.endpoint ?? process.env.R2_ENDPOINT ?? `https://${this.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: requiredOption(options.accessKeyId ?? process.env.R2_ACCESS_KEY_ID, 'R2_ACCESS_KEY_ID'),
        secretAccessKey: requiredOption(options.secretAccessKey ?? process.env.R2_SECRET_ACCESS_KEY, 'R2_SECRET_ACCESS_KEY'),
      },
    });
    this.id = 'r2-cms-storage';
    this.provider = 'r2';
    this.capabilities = ['json', 'bytes', 'metadata', 'object-storage', 'r2'];
  }

  async healthCheck() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    return {
      status: 'ok',
      message: `R2 bucket is available: ${this.bucket}`,
      details: {
        accountId: this.accountId,
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
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: normalizedKey,
    }));
    return bodyToBuffer(response.Body);
  }

  async putBytes(key, bytes, metadata = {}) {
    const normalizedKey = normalizeStorageKey(key);
    const contentType = metadata.contentType ?? 'application/octet-stream';
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: normalizedKey,
      Body: bytes,
      ContentType: contentType,
    }));
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
    try {
      await this.client.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: normalizeStorageKey(key),
      }));
      return true;
    } catch (error) {
      if (isMissingObjectError(error)) return false;
      throw error;
    }
  }

  async list(prefix = '') {
    const normalizedPrefix = prefix ? normalizeStorageKey(prefix) : '';
    const keys = [];
    let continuationToken;

    do {
      const response = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: normalizedPrefix ? `${normalizedPrefix.replace(/\/$/, '')}/` : undefined,
        ContinuationToken: continuationToken,
      }));
      for (const entry of response.Contents ?? []) {
        if (entry.Key && !entry.Key.endsWith('.metadata.json')) {
          keys.push(entry.Key);
        }
      }
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return keys.sort();
  }

  async delete(key) {
    const normalizedKey = normalizeStorageKey(key);
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: normalizedKey,
    }));
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: this.metadataKey(normalizedKey),
    }));
  }

  urlFor(key) {
    const normalizedKey = normalizeStorageKey(key);
    if (!this.publicBaseUrl) return `r2://${this.bucket}/${normalizedKey}`;
    return `${this.publicBaseUrl.replace(/\/$/, '')}/${encodeURI(normalizedKey)}`;
  }

  async writeMetadata(key, metadata) {
    if (!metadata || Object.keys(metadata).length === 0) return;
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.metadataKey(key),
      Body: Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8'),
      ContentType: 'application/json',
    }));
  }

  metadataKey(key) {
    return `${normalizeStorageKey(key)}.metadata.json`;
  }
}

async function bodyToBuffer(body) {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body.transformToByteArray === 'function') {
    return Buffer.from(await body.transformToByteArray());
  }

  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function requiredOption(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required for CMS_STORAGE_PROVIDER=r2.`);
  }
  return value.trim();
}

function isMissingObjectError(error) {
  return error?.name === 'NotFound'
    || error?.name === 'NoSuchKey'
    || error?.$metadata?.httpStatusCode === 404;
}
