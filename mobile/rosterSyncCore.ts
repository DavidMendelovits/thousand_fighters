export type Fighter = { id: string; name: string; portrait?: string; configVersion: string };

type RuntimeRosterManifest = {
  schemaVersion: 1;
  version: string;
  fighters: Array<{ id: string; configVersion: string }>;
};

export type RosterCache = {
  schemaVersion: 1;
  origin: string;
  selectionKey: string;
  manifestVersion: string;
  etag?: string;
  fighters: Fighter[];
};

const idPattern = /^[a-z0-9_-]+$/i;
const versionPattern = /^[a-f0-9]{64}$/;

export function rosterSelectionKey(activeFighterIds: ReadonlySet<string>) {
  return activeFighterIds.size ? [...activeFighterIds].sort().join(',') : '*';
}

function isFighter(value: unknown): value is Fighter {
  if (!value || typeof value !== 'object') return false;
  const fighter = value as Record<string, unknown>;
  return idPattern.test(String(fighter.id ?? ''))
    && typeof fighter.name === 'string'
    && versionPattern.test(String(fighter.configVersion ?? ''))
    && (fighter.portrait === undefined || typeof fighter.portrait === 'string');
}

export function isRosterCache(value: unknown, origin: string, selectionKey: string): value is RosterCache {
  if (!value || typeof value !== 'object') return false;
  const cache = value as Record<string, unknown>;
  return cache.schemaVersion === 1 && cache.origin === origin && cache.selectionKey === selectionKey
    && versionPattern.test(String(cache.manifestVersion ?? ''))
    && (cache.etag === undefined || typeof cache.etag === 'string')
    && Array.isArray(cache.fighters) && cache.fighters.length > 0 && cache.fighters.every(isFighter);
}

function isRuntimeRoster(value: unknown): value is RuntimeRosterManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Record<string, unknown>;
  return manifest.schemaVersion === 1 && versionPattern.test(String(manifest.version ?? ''))
    && Array.isArray(manifest.fighters)
    && manifest.fighters.every((entry) => Boolean(entry) && typeof entry === 'object'
      && idPattern.test(String((entry as Record<string, unknown>).id ?? ''))
      && versionPattern.test(String((entry as Record<string, unknown>).configVersion ?? '')));
}

function portraitFor(config: Record<string, any>, origin: string) {
  const file = config.sprite?.frames?.base?.[0]?.file;
  if (!file || typeof config.sprite?.basePath !== 'string') return undefined;
  try {
    const portrait = new URL(`${config.sprite.basePath}/${file}`, origin).href;
    return new URL(portrait).origin === origin ? portrait : undefined;
  } catch {
    return undefined;
  }
}

export async function syncRosterCore({
  origin,
  selectionKey,
  activeFighterIds,
  cached,
  signal,
  fetcher = fetch,
}: {
  origin: string;
  selectionKey: string;
  activeFighterIds: ReadonlySet<string>;
  cached: RosterCache | null;
  signal: AbortSignal;
  fetcher?: typeof fetch;
}): Promise<{ cache: RosterCache; networkChanged: boolean; status: 'not-modified' | 'version-match' | 'updated' }> {
  const headers: Record<string, string> = {};
  if (cached?.etag) headers['If-None-Match'] = cached.etag;
  const response = await fetcher(`${origin}/runtime-roster.json`, { headers, signal, cache: 'no-cache' });
  if (response.status === 304 && cached) return { cache: cached, networkChanged: false, status: 'not-modified' };
  if (!response.ok) throw new Error('Published roster is unavailable.');
  const manifest: unknown = await response.json();
  if (!isRuntimeRoster(manifest)) throw new Error('Published roster is invalid.');
  const etag = response.headers.get('etag') ?? cached?.etag;

  if (cached?.manifestVersion === manifest.version) {
    const next = etag === cached.etag ? cached : { ...cached, ...(etag ? { etag } : {}) };
    return { cache: next, networkChanged: false, status: 'version-match' };
  }

  const reusable = new Map((cached?.fighters ?? []).map((fighter) => [`${fighter.id}:${fighter.configVersion}`, fighter]));
  const selected = manifest.fighters.filter(({ id }) => !activeFighterIds.size || activeFighterIds.has(id));
  const fighters = await Promise.all(selected.map(async ({ id, configVersion }) => {
    const existing = reusable.get(`${id}:${configVersion}`);
    if (existing) return existing;
    const configResponse = await fetcher(`${origin}/fighters/${id}/config.json?v=${configVersion}`, { signal });
    if (!configResponse.ok) throw new Error(`Could not load fighter ${id}.`);
    const config: Record<string, any> = await configResponse.json();
    if (config.id !== id || typeof config.displayName !== 'string' || config.selectable === false || config.parentId) {
      throw new Error(`Fighter ${id} has an invalid runtime config.`);
    }
    return { id, name: config.displayName, portrait: portraitFor(config, origin), configVersion } satisfies Fighter;
  }));
  if (!fighters.length) throw new Error('No published fighters are available.');
  return {
    cache: {
      schemaVersion: 1,
      origin,
      selectionKey,
      manifestVersion: manifest.version,
      ...(etag ? { etag } : {}),
      fighters,
    },
    networkChanged: true,
    status: 'updated',
  };
}
