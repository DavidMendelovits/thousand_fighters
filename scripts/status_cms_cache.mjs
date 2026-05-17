import { stat } from 'node:fs/promises';
import path from 'node:path';
import { FileCmsStorage } from '../cms/storage/FileCmsStorage.js';

const cacheRoot = process.env.CMS_CACHE_ROOT ?? path.join(process.cwd(), '.cache', 'cms-data');
const storage = new FileCmsStorage({ rootDir: cacheRoot });
const keys = await storage.list('');
const characterIds = new Set();
let bytes = 0;

for (const key of keys) {
  const match = key.match(/^characters\/([^/]+)\//);
  if (match) characterIds.add(match[1]);
  bytes += await fileSize(storage.absolutePath(key));
}

console.log(`CMS cache root: ${cacheRoot}`);
console.log(`Objects: ${keys.length}`);
console.log(`Characters: ${characterIds.size}`);
console.log(`Approx size: ${formatBytes(bytes)}`);
if (characterIds.size > 0) {
  console.log([...characterIds].sort().join('\n'));
}

async function fileSize(filePath) {
  try {
    return (await stat(filePath)).size;
  } catch (error) {
    if (error?.code === 'ENOENT') return 0;
    throw error;
  }
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
