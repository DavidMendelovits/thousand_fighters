// Where the roster comes from. The dev server reads fighters/*.json live through /api (and can save);
// a production build ships the same files as one static fighters.json, read-only.
import type { FighterDef } from './kit'

export async function loadFighters(): Promise<FighterDef[]> {
  const url = import.meta.env.DEV ? '/api/fighters' : '/fighters.json'
  const r = await fetch(url)
  if (!r.ok) throw new Error(`GET ${url}: ${r.status}`)
  return r.json()
}

/** Painted sprite sheet for a fighter with `atlas: true`. Same path in dev and production. */
export const sheetUrl = (id: string) => `/fighters/${id}.png`
