import type { CharacterConfig } from '../schema/types';

/**
 * The live roster: CMS-exported fighters discovered at boot. Starts empty
 * and is mutated in place by loadCmsRoster() so every importer sees the
 * merged list. Built-in stamptown fighters are intentionally excluded —
 * character select reflects only what the CMS has published.
 */
export const roster: CharacterConfig[] = [];

type AssetsIndex = {
  fighters?: Record<string, { config?: string | boolean } | undefined>;
};

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
 * Discover CMS-exported fighters via assets-index.json and merge them
 * into the roster. Resolves quietly on any failure — the game always
 * starts with at least the built-in roster.
 */
export async function loadCmsRoster(): Promise<CharacterConfig[]> {
  try {
    const indexResponse = await fetch('/assets-index.json');
    if (!indexResponse.ok) return roster;
    const index = (await indexResponse.json()) as AssetsIndex;
    const fighterEntries = Object.entries(index.fighters ?? {});
    const cmsFighterIds = fighterEntries
      .filter(([, entry]) => Boolean(entry?.config))
      .map(([id]) => id);
    if (!cmsFighterIds.length) return roster;

    const configs = await Promise.all(
      cmsFighterIds.map(async (id) => {
        try {
          const response = await fetch(`/fighters/${id}/config.json`);
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
    for (const config of configs) {
      if (config && !roster.some((existing) => existing.id === config.id)) {
        roster.push(config);
      }
    }
  } catch {
    // No assets index (dev without build step) — built-ins only.
  }
  return roster;
}
