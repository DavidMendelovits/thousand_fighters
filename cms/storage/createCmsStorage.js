import path from 'node:path';
import { CachedCmsStorage } from './CachedCmsStorage.js';
import { FileCmsStorage } from './FileCmsStorage.js';
import { R2CmsStorage } from './R2CmsStorage.js';
import { SupabaseCmsStorage } from './SupabaseCmsStorage.js';

export function createCmsStorage(options = {}) {
  const provider = options.provider ?? process.env.CMS_STORAGE_PROVIDER ?? 'file';

  if (provider === 'file') {
    return new FileCmsStorage({
      rootDir: options.rootDir ?? process.env.CMS_FILE_STORAGE_ROOT ?? path.join(process.cwd(), 'cms-data'),
      publicBaseUrl: options.publicBaseUrl ?? process.env.CMS_FILE_PUBLIC_BASE_URL ?? null,
    });
  }

  if (provider === 'r2') {
    return new R2CmsStorage(options);
  }

  if (provider === 'supabase') {
    return new SupabaseCmsStorage(options);
  }

  if (provider === 'cached') {
    const remoteProvider = options.remoteProvider ?? process.env.CMS_REMOTE_STORAGE_PROVIDER ?? 'supabase';
    if (remoteProvider === 'cached') {
      throw new Error('CMS_REMOTE_STORAGE_PROVIDER cannot be cached.');
    }

    const cache = options.cache ?? new FileCmsStorage({
      rootDir: options.cacheRootDir ?? process.env.CMS_CACHE_ROOT ?? path.join(process.cwd(), '.cache', 'cms-data'),
      publicBaseUrl: options.cachePublicBaseUrl ?? process.env.CMS_CACHE_PUBLIC_BASE_URL ?? null,
    });
    const remote = options.remote ?? createCmsStorage({
      ...(options.remoteOptions ?? {}),
      provider: remoteProvider,
    });

    return new CachedCmsStorage({
      cache,
      remote,
      writeThrough: options.writeThrough ?? process.env.CMS_CACHE_WRITE_THROUGH !== 'false',
    });
  }

  throw new Error(`Unsupported CMS storage provider: ${provider}`);
}
