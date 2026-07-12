import { rm } from 'node:fs/promises';
import path from 'node:path';

const cacheRoot = process.env.CMS_CACHE_ROOT ?? path.join(process.cwd(), '.cache', 'cms-data');
await rm(cacheRoot, { force: true, recursive: true });
console.log(`Cleared CMS cache: ${cacheRoot}`);
