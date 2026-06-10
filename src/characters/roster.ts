import type { CharacterConfig } from '../schema/types';
import { playableCharacters, mergeRoster } from './stamptownFighters';

/**
 * The live roster: built-in fighters plus any CMS-exported fighters
 * discovered at boot. Mutated in place by loadCmsRoster() so every
 * importer sees the merged list.
 */
export const roster: CharacterConfig[] = [...playableCharacters];

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

    const merged = mergeRoster(configs.filter((c): c is CharacterConfig => c !== null));
    for (const config of merged) {
      if (!roster.some((existing) => existing.id === config.id)) {
        roster.push(config);
      }
    }
  } catch {
    // No assets index (dev without build step) — built-ins only.
  }
  return roster;
}
