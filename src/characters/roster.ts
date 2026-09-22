import type { CharacterConfig } from '../schema/types';

/**
 * The live roster: CMS-exported fighters discovered at boot. Starts empty
 * and is mutated in place by loadCmsRoster() so every importer sees the
 * merged list. Built-in stamptown fighters are intentionally excluded —
 * character select reflects only what the CMS has published.
 */
export const roster: CharacterConfig[] = [];

type RuntimeRosterManifest = {
  schemaVersion: 1;
  version: string;
  fighters: Array<{ id: string; configVersion: string }>;
};

const versionPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-z0-9_-]+$/i;

function looksLikeRuntimeRoster(value: unknown): value is RuntimeRosterManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Record<string, unknown>;
  return manifest.schemaVersion === 1 && typeof manifest.version === 'string'
    && versionPattern.test(manifest.version)
    && Array.isArray(manifest.fighters)
    && manifest.fighters.every((fighter) => Boolean(fighter) && typeof fighter === 'object'
      && idPattern.test(String((fighter as Record<string, unknown>).id ?? ''))
      && versionPattern.test(String((fighter as Record<string, unknown>).configVersion ?? '')));
}

function looksLikeCharacterConfig(value: unknown): value is CharacterConfig {
  if (!value || typeof value !== 'object') return false;
  const config = value as Record<string, unknown>;
  return (
    typeof config.id === 'string' &&
    typeof config.displayName === 'string' &&
    Array.isArray(config.moves)
  );
}

/**
 * Load only the CMS-authoritative playable manifest. `cache: no-cache` asks
 * the browser to revalidate the tiny file (normally a 304); versioned config
 * URLs remain reusable until their exact bytes change.
 */
export async function loadCmsRoster(): Promise<CharacterConfig[]> {
  try {
    const manifestResponse = await fetch('/runtime-roster.json', { cache: 'no-cache' });
    if (!manifestResponse.ok) return roster;
    const manifest: unknown = await manifestResponse.json();
    if (!looksLikeRuntimeRoster(manifest)) {
      console.warn('[roster] runtime-roster.json is invalid');
      return roster;
    }

    const configs = await Promise.all(
      manifest.fighters.map(async ({ id, configVersion }) => {
        try {
          const response = await fetch(`/fighters/${id}/config.json?v=${configVersion}`);
          if (!response.ok) return null;
          const config: unknown = await response.json();
          if (!looksLikeCharacterConfig(config)) {
            console.warn(`[roster] skipping ${id}: config.json is not a valid CharacterConfig`);
            return null;
          }
          return config;
        } catch {
          return null;
        }
      }),
    );

    // Only CMS-discovered fighters enter the roster — no built-in merge. (Use
    // mergeRoster from stamptownFighters if you ever want the built-ins back.)
    const nextRoster = configs.filter((config): config is CharacterConfig => Boolean(config && config.selectable !== false && !config.parentId));
    // Feature the new collection without deleting or hiding existing fighters.
    nextRoster.sort((a, b) => Number(b.rosterGroup === 'oddities') - Number(a.rosterGroup === 'oddities'));
    roster.splice(0, roster.length, ...nextRoster);
  } catch {
    // Keep the last verified in-memory roster during a transient revalidation failure.
  }
  return roster;
}
