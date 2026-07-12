import { FileCmsStorage } from '../cms/storage/FileCmsStorage.js';
import { SupabaseCmsStorage } from '../cms/storage/SupabaseCmsStorage.js';

const source = new FileCmsStorage({
  rootDir: process.env.CMS_FILE_STORAGE_ROOT ?? 'cms-data',
});
const target = new SupabaseCmsStorage({
  url: process.env.SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  bucket: process.env.SUPABASE_BUCKET,
  publicBaseUrl: process.env.SUPABASE_PUBLIC_BASE_URL ?? null,
});

await target.healthCheck();
console.log(`Supabase bucket is ready: ${target.bucket}.`);

const keys = await source.list('');
console.log(`Found ${keys.length} local CMS object(s) in ${source.rootDir}.`);
let copied = 0;

for (const key of keys) {
  if (copied < 10) {
    console.log(`Migrating ${copied + 1}/${keys.length}: ${key}`);
  }
  const [bytes, metadata] = await Promise.all([
    source.getBytes(key),
    source.getMetadata(key),
  ]);
  await target.putBytes(key, bytes, metadata);
  copied += 1;
  if (copied % 100 === 0 || copied === keys.length) {
    console.log(`Migrated ${copied}/${keys.length} CMS object(s) to Supabase...`);
  }
}

console.log(`Migrated ${copied} CMS object(s) from ${source.rootDir} to Supabase bucket ${target.bucket}.`);
