import { FileCmsStorage } from '../cms/storage/FileCmsStorage.js';
import { R2CmsStorage } from '../cms/storage/R2CmsStorage.js';

const source = new FileCmsStorage({
  rootDir: process.env.CMS_FILE_STORAGE_ROOT ?? 'cms-data',
});
const target = new R2CmsStorage({
  accountId: process.env.R2_ACCOUNT_ID,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  bucket: process.env.R2_BUCKET,
  publicBaseUrl: process.env.R2_PUBLIC_BASE_URL ?? null,
});

await target.healthCheck();

const keys = await source.list('');
let copied = 0;

for (const key of keys) {
  const [bytes, metadata] = await Promise.all([
    source.getBytes(key),
    source.getMetadata(key),
  ]);
  await target.putBytes(key, bytes, metadata);
  copied += 1;
}

console.log(`Migrated ${copied} CMS object(s) from ${source.rootDir} to R2 bucket ${target.bucket}.`);
