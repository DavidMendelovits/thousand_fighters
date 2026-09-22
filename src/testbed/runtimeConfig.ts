import { SHEET_IDS } from '../../shared/animationRows.js';
import type { CharacterConfig, SpriteSheetId } from '../schema/types';
import { collectProjectileAnimations } from '../core/projectileAssets';

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
  /** Projectile texture URLs keyed by `projectile.animation`. */
  projectileUrls: Record<string, string>;
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

  const [{ config, assetRoot, previewFallbacks, projectileSourceKeys }, { assets }] = await Promise.all([
    getJson<{ config: CharacterConfig; assetRoot?: string; previewFallbacks?: {row:string;source:string}[]; projectileSourceKeys?:Record<string,string> }>(`/api/characters/${id}/runtime-config?preview=1`),
    getJson<{ assets: AssetRecord[] }>(`/api/characters/${id}/assets`),
  ]);

  if (!config?.sprite) throw new Error(`runtime-config for "${characterId}" has no sprite`);
  if(previewFallbacks?.length)warnings.push(`DRAFT PROXY: ${previewFallbacks.length} unbuilt animation rows temporarily show ${previewFallbacks.map(item=>`${item.row}←${item.source}`).join(', ')}. This cannot publish; generate and review each real row.`);

  const byRelativePath = new Map<string, AssetRecord>();
  const byKey = new Map<string, AssetRecord>();
  for (const asset of assets ?? []) {
    // Archived art revisions can have identical frame suffixes. Never let the
    // first archived match replace the active outfit in a live preview.
    if(assetRoot && /\/(sprites|sheets)\//.test(asset.key) && !asset.key.startsWith(`${assetRoot}/`))continue;
    byRelativePath.set(asset.relativePath, asset);
    byKey.set(asset.key, asset);
  }

  // Projectile sprites: convert inlines `projectile.animation` into spawn events.
  // A generated projectile's sprite is stored at `source/<animation>_projectile.png`
  // — map each animation to that asset's apiUrl so the testbed can load the
  // texture (else ProjectilePool renders a fallback rectangle). Resolved up front
  // so it survives the no-frames early-return below.
  const projectileUrls: Record<string, string> = {};
  for (const animation of collectProjectileAnimations(config)) {
    // Exact draft sourceKey wins. A historical filename match can point at a
    // stale opaque attempt after the sprite has been reprocessed/versioned.
    const pinned = projectileSourceKeys?.[animation];
    const asset = pinned ? byKey.get(pinned) : findProjectileAsset(byRelativePath, animation);
    if (asset) projectileUrls[animation] = asset.apiUrl;
    else if (!config.moves.some(move => move.phases.some(phase => phase.events.some(({event}) => 'projectile' in event && event.projectile.animation === animation && event.projectile.visual)))) warnings.push(`projectile "${animation}": sprite not found in assets (renders as a box until generated).`);
  }

  const frameUrls: Partial<Record<SpriteSheetId, string[]>> = {};
  const frameCounts = config.sprite.frameCounts ?? {};
  let resolvedCount = 0;
  // Authored characters may own rows beyond the generation registry (ink,
  // cable, video_signature...). Preview the same frames the live game loads.
  for (const sheet of new Set([...SHEET_IDS, ...Object.keys(frameCounts)])) {
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
    return { config, frameUrls: {}, projectileUrls, warnings };
  }

  if (config.moves.length === 0) warnings.push('Draft has no moves defined.');
  warnings.push('Collision geometry comes from the same draft-to-runtime conversion used for publishing.');

  return { config, frameUrls, projectileUrls, warnings };
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

/**
 * Map a projectile animation key to its source sprite asset. generate_projectile
 * stores it at `source/<animation>_projectile.png`; match on that suffix.
 */
function findProjectileAsset(
  byRelativePath: Map<string, AssetRecord>,
  animation: string,
): AssetRecord | undefined {
  const suffix = `${animation}_projectile.png`;
  for (const [relativePath, asset] of byRelativePath) {
    if (relativePath === `source/${suffix}` || relativePath.endsWith(`/${suffix}`)) return asset;
  }
  return undefined;
}
