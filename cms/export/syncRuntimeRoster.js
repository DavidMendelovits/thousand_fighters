import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const idPattern = /^[a-z0-9_-]+$/i;
const syncQueues = new Map();

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function publishedEntry(publicDir, id) {
  if (!idPattern.test(id)) return null;
  const configPath = path.join(publicDir, 'fighters', id, 'config.json');
  try {
    const bytes = await readFile(configPath);
    const config = JSON.parse(bytes.toString('utf8'));
    if (config?.id !== id || config.selectable === false || config.parentId) return null;
    return { id, configVersion: sha256(bytes) };
  } catch {
    // Drafts do not become playable until their runtime export exists.
    return null;
  }
}

/**
 * Publish the tiny source-of-truth roster consumed by web and mobile.
 *
 * The file is deliberately timestamp-free: identical CMS/runtime state produces
 * identical bytes, so static hosting can return 304 and clients can reuse every
 * unchanged config. Archived drafts and hidden forms remain on disk for lineage,
 * but never enter the playable manifest.
 */
async function performRuntimeRosterSync({ repository, publicDir }) {
  if (!repository || !publicDir) throw new Error('Runtime roster sync requires a repository and public directory.');
  const entries = await repository.listCharacters();
  const fighters = [];
  for (const entry of entries) {
    const id = entry?.id;
    if (typeof id !== 'string' || !idPattern.test(id)) continue;
    try {
      const draft = await repository.getDraft(id);
      if (draft.workbench?.archived === true || draft.parentId) continue;
      const published = await publishedEntry(publicDir, id);
      if (published) fighters.push(published);
    } catch {
      // One damaged draft cannot make the existing playable roster unavailable.
    }
  }
  fighters.sort((a, b) => a.id.localeCompare(b.id));
  const version = sha256(JSON.stringify({ schemaVersion: 1, fighters }));
  const contents = `${JSON.stringify({ schemaVersion: 1, version, fighters }, null, 2)}\n`;
  const target = path.join(publicDir, 'runtime-roster.json');
  let previous = null;
  try { previous = await readFile(target, 'utf8'); } catch { /* first publish */ }
  if (previous === contents) return { changed: false, path: target, manifest: { schemaVersion: 1, version, fighters } };

  await mkdir(publicDir, { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, contents, 'utf8');
  await rename(temporary, target);
  return { changed: true, path: target, manifest: { schemaVersion: 1, version, fighters } };
}

export function syncRuntimeRoster(input) {
  const key = path.resolve(input.publicDir);
  const prior = syncQueues.get(key) ?? Promise.resolve();
  const pending = prior.catch(() => {}).then(() => performRuntimeRosterSync(input));
  syncQueues.set(key, pending);
  return pending.finally(() => {
    if (syncQueues.get(key) === pending) syncQueues.delete(key);
  });
}
