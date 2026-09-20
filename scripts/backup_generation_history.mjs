import { createCmsStorage } from '../cms/storage/createCmsStorage.js';
import { digest } from '../cms/storage/LineageStore.js';

const args = process.argv.slice(2), provider = args[args.indexOf('--provider') + 1];
if (!args.includes('--provider') || !['supabase', 'r2'].includes(provider)) throw new Error('Usage: node scripts/backup_generation_history.mjs --provider supabase|r2 [--apply]');
const source = createCmsStorage({ provider: 'file' });
const remote = createCmsStorage({ provider });
const keys = [...await source.list('lineage'), ...await source.list('benchmarks/generation-attempts'), ...(await source.list('characters')).filter(key => /\/versions\//.test(key))];
console.log(JSON.stringify({ mode: args.includes('--apply') ? 'copy-and-verify' : 'dry-run', provider, objects: keys.length }));
if (args.includes('--apply')) {
  let copied = 0;
  for (const key of keys) {
    const bytes = await source.getBytes(key), expected = digest(bytes);
    if (!(await remote.exists(key))) {
      await remote.putBytes(key, bytes, await source.getMetadata(key));
      copied++;
    }
    if (digest(await remote.getBytes(key)) !== expected) throw new Error(`Backup verification failed: ${key}. Remote object not overwritten.`);
  }
  console.log(`Verified ${keys.length} objects by SHA-256 read-back; copied ${copied}. Local originals retained.`);
}
