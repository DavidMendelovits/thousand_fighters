import { SHEET_IDS } from '../../shared/animationRows.js';
import type { CharacterConfig, SpriteSheetId } from '../schema/types';

/**
 * Character Gym data loader.
 *
 * Unlike the testbed (which only needs render-ready config + frame URLs), the
 * gym also needs the *editable* frameData: per-frame anchors and the measured,
 * anchor-relative hurtbox/attackBox the convert pipeline derives collision from
 * (see docs/CHARACTER_GYM_DESIGN.md §3). It fetches:
 *
 *   GET /api/characters/:id/runtime-config  -> CharacterConfig (render scale, moves)
 *   GET /api/characters/:id/assets          -> asset records (relativePath, apiUrl, key)
 *   GET <frameData.json apiUrl>             -> the editable frame metadata
 *
 * `frameDataKey` is the storage key the save path (T4) writes back to.
 */

export { SHEET_IDS };

export type Box = { x: number; y: number; width: number; height: number };

export type GymFrame = {
  file: string;
  width: number;
  height: number;
  anchor: { x: number; y: number };
  reachX?: number;
  silhouetteHeight?: number;
  hurtbox?: Box | null;
  attackBox?: Box | null;
  /** Set by the gym when the anchor was hand-tuned, so re-extraction preserves it (A6). */
  anchorEdited?: boolean;
};

export type FrameData = {
  anchorConvention?: string;
  frames: Partial<Record<string, GymFrame[]>>;
};

type AssetRecord = { key: string; relativePath: string; apiUrl: string };

/** A box in frame-px, anchor-relative space — the override/measured space (§3, T10). */
export type OverrideBox = { x: number; y: number; width: number; height: number };

/** The gym-authored collision override layer carried on the draft (D2/T10). */
export type DraftOverrides = {
  hurtboxes?: Record<string, OverrideBox>;
  hitboxes?: Record<string, Record<string, OverrideBox>>;
  /** Per-state guard boxes authored in the gym (T17). Override-only — no measured pass. */
  guardboxes?: Record<string, OverrideBox>;
};

/** Minimal shape of a draft hitbox_active event the gym reads numbers from. */
export type DraftHitbox = {
  x?: number; y?: number; width?: number; height?: number;
  damage?: number; hitstun?: number; stun?: number; blockstun?: number;
  knockbackX?: number; knockbackY?: number; knockback?: { x?: number; y?: number };
  level?: string;
};
export type DraftEvent = { type?: string; id?: string; hitbox?: DraftHitbox | null };
export type DraftPhase = { name?: string; frames?: number; events?: { frame?: number; onFrame?: number; event?: DraftEvent }[] };
export type DraftMove = { id: string; displayName?: string; animation?: SpriteSheetId; phases?: DraftPhase[] };
export type GymDraft = { id?: string; overrides?: DraftOverrides; moves?: DraftMove[] } & Record<string, unknown>;

export type GymData = {
  config: CharacterConfig;
  /** Raw, unconverted draft — source of truth for overrides + hitbox numbers (Phase 2). */
  draft: GymDraft | null;
  frameData: FrameData | null;
  /** Frame image URLs keyed by sheet, frame-indexed (0-based) — for Phaser textures. */
  frameUrls: Partial<Record<SpriteSheetId, string[]>>;
  /** Storage key of frameData.json, for write-back. Null if none exists yet. */
  frameDataKey: string | null;
  warnings: string[];
  /** Extractor warnings keyed by frame `file` → messages (survives reorder). */
  frameWarnings: Record<string, string[]>;
};

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return (await response.json()) as T;
}

export async function loadGymData(characterId: string): Promise<GymData> {
  const warnings: string[] = [];
  const id = encodeURIComponent(characterId);

  const [{ config }, { assets }, draftResult] = await Promise.all([
    getJson<{ config: CharacterConfig }>(`/api/characters/${id}/runtime-config`),
    getJson<{ assets: AssetRecord[] }>(`/api/characters/${id}/assets`),
    // The draft carries the editable overrides + hitbox numbers (Phase 2). It is
    // advisory for the gym's render (runtime-config already folds it in), so a
    // failure here is non-fatal — collision editing just stays unavailable.
    getJson<{ draft: GymDraft | null }>(`/api/characters/${id}/draft`).catch(() => ({ draft: null })),
  ]);

  if (!config) throw new Error(`runtime-config for "${characterId}" returned no config`);
  const draft = draftResult?.draft ?? null;

  const byRelativePath = new Map<string, AssetRecord>();
  for (const asset of assets ?? []) byRelativePath.set(asset.relativePath, asset);

  // Locate + load the editable frameData.json (before warnings, so warnings can
  // be keyed by the frame's stable `file` — they then travel through reorder).
  const frameDataAsset = (assets ?? []).find((a) => a.relativePath.endsWith('frameData.json'));
  let frameData: FrameData | null = null;
  if (frameDataAsset) {
    try {
      frameData = await getJson<FrameData>(frameDataAsset.apiUrl);
    } catch (error) {
      warnings.push(`Could not load frameData.json: ${(error as Error).message}`);
    }
  } else {
    warnings.push('No frameData.json yet — anchors cannot be edited until frames are extracted.');
  }

  // Surface extractor/normalizer warnings (edge-touch, magenta residue, empty
  // cells, dropped anchors) so the author can act on bad frames. Keyed by the
  // frame `file` so a badge stays on the right frame after a reorder.
  const frameWarnings: Record<string, string[]> = {};
  const reportAsset = (assets ?? []).find((a) => a.relativePath.endsWith('normalization-report.json'));
  if (reportAsset) {
    try {
      const report = await getJson<{ warnings?: string[] }>(reportAsset.apiUrl);
      for (const line of report.warnings ?? []) {
        warnings.push(line);
        // Lines look like "base: frame 3: silhouette touches the sheet border".
        const m = /^(\w+):\s*frame\s+(\d+):\s*(.+)$/i.exec(line);
        if (m) {
          const [, sheet, num, msg] = m;
          const file = frameData?.frames?.[sheet]?.[Number(num) - 1]?.file;
          if (file) frameWarnings[file] = [...(frameWarnings[file] ?? []), msg];
        }
      }
    } catch {
      // Non-fatal — warnings are advisory.
    }
  }

  // Resolve each sheet's frame image URLs from the asset list, preferring the
  // frameData `file` suffix, falling back to the conventional sprites/ naming.
  const frameUrls: Partial<Record<SpriteSheetId, string[]>> = {};
  const frameCounts = config.sprite?.frameCounts ?? {};
  for (const sheet of SHEET_IDS) {
    const count = frameCounts[sheet] ?? frameData?.frames?.[sheet]?.length ?? 0;
    if (!count) continue;
    const metas = frameData?.frames?.[sheet];
    const urls: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const asset = findFrameAsset(byRelativePath, metas?.[index]?.file, sheet, index);
      if (asset) urls[index] = asset.apiUrl;
    }
    frameUrls[sheet] = urls;
  }

  return { config, draft, frameData, frameUrls, frameDataKey: frameDataAsset?.key ?? null, warnings, frameWarnings };
}

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
