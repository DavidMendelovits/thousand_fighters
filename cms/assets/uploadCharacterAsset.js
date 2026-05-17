export async function writeCharacterAssetUpload({
  repository,
  storage,
  characterId,
  input,
  source = 'admin-upload',
  now = () => new Date(),
}) {
  await ensureCharacterExists(repository, characterId);

  const relativePath = requiredString(input.relativePath, 'relativePath');
  const contentBase64 = requiredString(input.contentBase64, 'contentBase64');
  const contentType = optionalString(input.contentType) ?? 'application/octet-stream';
  const metadata = isPlainObject(input.metadata) ? input.metadata : {};
  const bytes = decodeBase64Content(contentBase64);

  const asset = await repository.writeAsset(characterId, relativePath, bytes, {
    ...metadata,
    contentType,
    uploadedAt: metadata.uploadedAt ?? now().toISOString(),
    source: metadata.source ?? source,
  });

  return assetRecordForKey({ repository, storage, characterId, key: asset.key });
}

export async function assetRecordForKey({ repository, storage, characterId, key }) {
  const prefix = `characters/${repository.safeCharacterId(characterId)}/assets/`;
  return {
    key,
    relativePath: key.startsWith(prefix) ? key.slice(prefix.length) : key,
    apiUrl: assetApiUrl(key),
    metadata: await storage.getMetadata(key),
  };
}

export function assetApiUrl(key) {
  return `/api/assets/${encodeURIComponent(key)}`;
}

async function ensureCharacterExists(repository, characterId) {
  try {
    await repository.getDraft(characterId);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw notFoundError(`Character draft not found: ${characterId}`);
    }
    throw error;
  }
}

function decodeBase64Content(value) {
  const payload = value.startsWith('data:') && value.includes(',')
    ? value.slice(value.indexOf(',') + 1)
    : value;
  const normalized = payload.replace(/\s+/g, '').replaceAll('-', '+').replaceAll('_', '/');
  if (!normalized || normalized.length % 4 === 1) {
    throw badRequestError('contentBase64 must be valid base64 content.');
  }

  const bytes = Buffer.from(normalized, 'base64');
  if (bytes.length === 0) {
    throw badRequestError('contentBase64 decoded to an empty asset.');
  }
  return bytes;
}

function requiredString(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequestError(`${fieldName} is required.`);
  }
  return value.trim();
}

function optionalString(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return value.trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function badRequestError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function notFoundError(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}
