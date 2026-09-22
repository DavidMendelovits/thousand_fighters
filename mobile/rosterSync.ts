import { File, Paths } from 'expo-file-system';
import { isRosterCache, syncRosterCore, type RosterCache } from './rosterSyncCore';

export { rosterSelectionKey, type Fighter } from './rosterSyncCore';

const cacheFile = new File(Paths.document, 'thousand-fighters-roster-v1.json');

export async function loadRosterCache(origin: string, selectionKey: string): Promise<RosterCache | null> {
  try {
    if (!cacheFile.exists) return null;
    const value: unknown = JSON.parse(await cacheFile.text());
    return isRosterCache(value, origin, selectionKey) ? value : null;
  } catch {
    return null;
  }
}

function saveRosterCache(cache: RosterCache) {
  cacheFile.write(`${JSON.stringify(cache)}\n`);
}

export async function syncRoster({
  origin,
  selectionKey,
  activeFighterIds,
  cached,
  signal,
}: {
  origin: string;
  selectionKey: string;
  activeFighterIds: ReadonlySet<string>;
  cached: RosterCache | null;
  signal: AbortSignal;
}): Promise<{ cache: RosterCache; networkChanged: boolean; status: 'not-modified' | 'version-match' | 'updated' }> {
  const result = await syncRosterCore({ origin, selectionKey, activeFighterIds, cached, signal });
  if (result.cache !== cached) saveRosterCache(result.cache);
  return result;
}
