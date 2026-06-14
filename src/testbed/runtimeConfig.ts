import { SHEET_IDS } from '../../shared/animationRows.js';
import type { CharacterConfig, SpriteSheetId } from '../schema/types';

/**
 * Loads a CMS character as a runtime CharacterConfig for the testbed.
 *
 * The config itself comes from the admin server's /runtime-config endpoint,
 * which runs the same draft -> runtime transform that `cms:export` ships
 * (convertDraftToCharacterConfig). That keeps the testbed in lockstep with the
 * real game: no second, drifting copy of the schema conversion lives here.
 *
 * This module's only job on the client is resolving each sprite frame to an
 * actual image URL. A draft's frames live in CMS storage (served via
 * /api/assets/...), not under /public/fighters, so config.sprite.basePath is
 * not directly fetchable — we map each frame to its asset apiUrl instead.
 */

type AssetRecord = {
  key: string;
  relativePath: string;
  apiUrl: string;
};

export type TestbedConfig = {
  config: CharacterConfig;
  /** Frame image URLs keyed by sheet, frame-indexed (0-based). */
  frameUrls: Partial<Record<SpriteSheetId, string[]>>;
  warnings: string[];
};

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return (await response.json()) as T;
}

export async function loadTestbedConfig(characterId: string): Promise<TestbedConfig> {
  const warnings: string[] = [];
  const id = encodeURIComponent(characterId);

  const [{ config }, { assets }] = await Promise.all([
    getJson<{ config: CharacterConfig }>(`/api/characters/${id}/runtime-config`),
    getJson<{ assets: AssetRecord[] }>(`/api/characters/${id}/assets`),
  ]);

  if (!config?.sprite) throw new Error(`runtime-config for "${characterId}" has no sprite`);

  const byRelativePath = new Map<string, AssetRecord>();
  for (const asset of assets ?? []) byRelativePath.set(asset.relativePath, asset);

  const frameUrls: Partial<Record<SpriteSheetId, string[]>> = {};
  const frameCounts = config.sprite.frameCounts ?? {};
  let resolvedCount = 0;
  for (const sheet of SHEET_IDS) {
    const count = frameCounts[sheet] ?? 0;
    if (!count) continue;

    const frameMetas = config.sprite.frames?.[sheet];
    const urls: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const asset = findFrameAsset(byRelativePath, frameMetas?.[index]?.file, sheet, index);
      if (asset) urls[index] = asset.apiUrl;
    }

    const found = urls.filter(Boolean).length;
    resolvedCount += found;
    const missing = count - found;
    if (missing > 0) warnings.push(`${sheet}: ${missing}/${count} frame image(s) not found in assets.`);
    frameUrls[sheet] = urls;
  }

  if (resolvedCount === 0) {
    // No extracted per-frame sprites exist (e.g. only source sheets so far).
    // Drop the sprite so the engine renders a clean placeholder box instead of
    // missing-texture artifacts — moves and hitboxes stay fully measurable.
    config.sprite = undefined;
    warnings.length = 0;
    warnings.push('No extracted sprite frames — rendering a placeholder box. Run frame extraction to see sprites.');
    return { config, frameUrls: {}, warnings };
  }

  if (config.moves.length === 0) warnings.push('Draft has no moves defined.');
  warnings.push('Hurtboxes are engine-default boxes derived from frame data (drafts do not author hurtboxes yet).');

  return { config, frameUrls, warnings };
}

/**
 * Map a frame to its stored asset. Prefer the exact frameData `file` suffix
 * (e.g. "sprites/base/base_001.png" → "fighter-pack/sprites/base/base_001.png");
 * fall back to the conventional sheet/index naming.
 */
function findFrameAsset(
  byRelativePath: Map<string, AssetRecord>,
  file: string | undefined,
  sheet: SpriteSheetId,
  index: number,
): AssetRecord | undefined {
  if (file) {
    for (const [relativePath, asset] of byRelativePath) {
      if (relativePath === file || relativePath.endsWith(`/${file}`)) return asset;
    }
  }
  const suffix = `sprites/${sheet}/${sheet}_${String(index + 1).padStart(3, '0')}.png`;
  for (const [relativePath, asset] of byRelativePath) {
    if (relativePath.endsWith(suffix)) return asset;
  }
  return undefined;
}
